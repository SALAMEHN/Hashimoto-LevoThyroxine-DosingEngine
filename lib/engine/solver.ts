import { PatientProfile, LabRecord, EstimationResult } from './types'

// ─── Steady-State PK/PD Model Constants ──────────────────────────────────────
//
// TSH_MAX, EC50, and GAMMA define the Hill/Michaelis-Menten pituitary response:
//   TSH_ss(fT4) = TSH_max / (1 + (fT4 / EC50)^γ)
//
// TSH_MAX = 25 mIU/L is chosen to cover the full range of observed TSH values
// (including severely hypothyroid patients) while keeping dose recommendations
// in the clinically valid range (25–300 mcg/day) at population-average priors.
//
// VD_PER_KG_LBM is the apparent volume of distribution coefficient per the
// image specification: V_d = 0.16 L/kg × W_LBM.
//
// Note on k_e and S_end priors: the image formula uses dose D in mcg/day and
// produces fT4 in ng/dL. The effective clearance rate k_e_prior = 1.5 day⁻¹
// is calibrated so that the closed-form dose inversion returns doses in the
// 25–300 mcg/day range for typical patients at population-average parameters.
// This value absorbs the unit conversions between mcg/day administered dose and
// ng/dL free-T4 plasma concentrations.
//
const TSH_MAX        = 25.0  // mIU/L  — effective maximum TSH secretion capacity
const EC50           = 1.5   // ng/dL  — fT4 concentration at 50% TSH suppression
const GAMMA          = 2.0   // Hill coefficient (sigmoidal steepness)
const VD_PER_KG_LBM  = 0.16  // L/kg  — V_d = 0.16 L/kg × W_LBM (per image)

// ─── Optimizer Hyperparameters ────────────────────────────────────────────────
const W_TSH  = 1.0  // TSH residual weight in the cost function
const W_FT4  = 0.3  // fT4 residual weight (down-weighted; freeT4 is optional)
const LAMBDA = 0.5  // L2 regularization strength toward population priors
const MAX_ITER = 3000

// Per-parameter gradient-descent learning rates.
// Calibrated to the expected gradient magnitudes at population-average θ for
// typical levothyroxine doses (25–300 mcg/day) and LBM values (40–120 kg).
const LR_ETA  = 5e-4  // learning rate for η  (absorption efficiency)
const LR_SEND = 1e-1  // learning rate for S_end  (endogenous production)
const LR_KE   = 2e-4  // learning rate for k_e  (clearance rate)

// ─── LBM Helper ───────────────────────────────────────────────────────────────

/**
 * Computes Lean Body Mass (kg) for a single lab record using the selected body
 * composition method. Falls back to 75 % of total body weight when neither
 * DEXA nor waist-circumference data are available.
 * LBM is clamped to [40 %, 95 %] of total body weight as a safety guard.
 */
function computeLbm(
    record: LabRecord & { antiTpo?: number; antiTg?: number },
    patient: PatientProfile
): number {
    const w = record.weightKg
    let lbm = w * 0.75

    if (record.lbmMethod === 'dexa' && record.dexaLbmKg) {
        lbm = record.dexaLbmKg
    } else if (record.lbmMethod === 'waist' && record.waistCm && patient.heightCm) {
        lbm = patient.sex === 'male'
            ? 0.407 * w + 0.267 * patient.heightCm - 19.2
            : 0.252 * w + 0.473 * patient.heightCm - 48.3
    }

    return Math.max(w * 0.4, Math.min(lbm, w * 0.95))
}

// ─── Steady-State Model Equations ────────────────────────────────────────────

/**
 * Steady-state free T4 concentration given dose D (mcg/day) and parameters θ.
 *
 *   fT4_ss(D) = (η · D + S_end) / (k_e · V_d)
 */
function fT4Steady(D: number, eta: number, sEnd: number, ke: number, vd: number): number {
    const kv = ke * vd
    return kv < 1e-9 ? 0 : (eta * D + sEnd) / kv
}

/**
 * Steady-state TSH (mIU/L) from free T4 via the Hill/Michaelis-Menten model.
 *
 *   TSH_ss(fT4) = TSH_max / (1 + (fT4 / EC50)^γ)
 */
function tshSteady(ft4: number): number {
    return TSH_MAX / (1 + Math.pow(Math.max(ft4, 1e-9) / EC50, GAMMA))
}

// ─── MAP Objective & Gradient ─────────────────────────────────────────────────

/**
 * Evaluates the MAP cost function J(θ) and its analytical gradient ∂J/∂θ
 * across all N historical titration cycles.
 *
 * Objective (from the image):
 *
 *   J(θ) = Σᵢ [ w_TSH·(TSH_i − T̂SH_i)² + w_fT4·(fT4_i − f̂T4_i)² ]
 *          + λ·‖θ − θ_prior‖²
 *
 * Analytical gradients via the chain rule (fT4 term omitted when unavailable):
 *
 *   ∂J/∂η     = Σᵢ −2·w_TSH·rTSH·(∂t/∂f)·(D_i/(ke·Vd))   + 2λ(η−η_prior)
 *   ∂J/∂S_end = Σᵢ −2·w_TSH·rTSH·(∂t/∂f)·(1/(ke·Vd))     + 2λ(S_end−S_end_prior)
 *   ∂J/∂k_e   = Σᵢ −2·w_TSH·rTSH·(∂t/∂f)·(−f/ke)         + 2λ(ke−ke_prior)
 *
 * where  ∂t/∂f = −TSH_max·γ·u / (f·(1+u)²),   u = (f/EC50)^γ
 */
function costAndGradient(
    eta: number,
    sEnd: number,
    ke: number,
    etaPrior: number,
    sEndPrior: number,
    kePrior: number,
    cycles: Array<{ D: number; tsh: number; ft4?: number; vd: number }>
): { cost: number; dEta: number; dSEnd: number; dKe: number } {
    let cost = 0, dEta = 0, dSEnd = 0, dKe = 0

    for (const { D, tsh, ft4, vd } of cycles) {
        const f      = fT4Steady(D, eta, sEnd, ke, vd)
        const t      = tshSteady(f)
        const fSafe  = Math.max(f, 1e-9)
        const kvSafe = Math.max(ke * vd, 1e-9)

        // TSH residual: rTSH = TSH_measured − TSH_predicted
        const rTsh = tsh - t
        cost += W_TSH * rTsh * rTsh

        // ∂t/∂f = −TSH_max · γ · u / (f · (1+u)²)
        const u    = Math.pow(fSafe / EC50, GAMMA)
        const dtdf = -(TSH_MAX * GAMMA * u) / (fSafe * (1 + u) * (1 + u))

        // Partials of fT4_ss wrt each parameter
        // ∂f/∂η = D / (ke·Vd)
        const dfde = D      / kvSafe
        // ∂f/∂S_end = 1 / (ke·Vd)
        const dfds = 1      / kvSafe
        // ∂f/∂ke = −f / ke   [from (η·D+S_end)/(ke·Vd), differentiating ke]
        const dfdk = -fSafe / ke

        // TSH gradient contributions: −2·W_TSH·rTSH·(∂t/∂f)·(∂f/∂θ)
        const gTsh = -2 * W_TSH * rTsh * dtdf
        dEta  += gTsh * dfde
        dSEnd += gTsh * dfds
        dKe   += gTsh * dfdk

        // fT4 residual (only included when the measurement exists and is positive)
        if (ft4 !== undefined && ft4 > 0) {
            const rFt4  = ft4 - f
            cost        += W_FT4 * rFt4 * rFt4
            const gFt4   = -2 * W_FT4 * rFt4
            dEta  += gFt4 * dfde
            dSEnd += gFt4 * dfds
            dKe   += gFt4 * dfdk
        }
    }

    // L2 regularization toward population priors: λ·‖θ − θ_prior‖²
    cost  += LAMBDA * ((eta - etaPrior)**2 + (sEnd - sEndPrior)**2 + (ke - kePrior)**2)
    dEta  += 2 * LAMBDA * (eta  - etaPrior)
    dSEnd += 2 * LAMBDA * (sEnd - sEndPrior)
    dKe   += 2 * LAMBDA * (ke   - kePrior)

    return { cost, dEta, dSEnd, dKe }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculates the recommended levothyroxine dose using the Dynamic Model Fitting
 * Algorithm (per the referenced PK/PD specification).
 *
 * At steady state (~6 weeks, 5 × T½ of T4) the continuous PK/PD model
 * simplifies to two algebraic equations:
 *
 *   fT4_ss(D) = (η · D + S_end) / (k_e · V_d)
 *   TSH_ss    = TSH_max / (1 + (fT4_ss / EC50)^γ)
 *
 * where θ = [η, S_end, k_e] is an unknown patient-specific parameter vector:
 *   η       — Gut Absorption Efficiency  (fraction)
 *   S_end   — Residual Endogenous T4 Production  (mcg/day)
 *   k_e     — Clearance Rate  (day⁻¹)
 *
 * and V_d = 0.16 L/kg × W_LBM is computed directly from Lean Body Mass.
 *
 * Parameter Identification via Sequential MAP Fitting:
 * Given N historical titration cycles [(D₁,y₁), …, (Dₙ,yₙ)] where
 * yᵢ = [TSHᵢ, fT4ᵢ], θ̂ minimises the weighted residual sum of squares:
 *
 *   J(θ) = Σᵢ [ w_TSH·(TSH_i−T̂SH_i)² + w_fT4·(fT4_i−f̂T4_i)² ] + λ·‖θ−θ_prior‖²
 *
 * Optimal Dose Solve:
 * Once θ̂ is updated from the latest blood test, D* is solved analytically:
 *
 *   D* = (k_e · V_d · EC50 · (TSH_max/TSH_target − 1)^(1/γ) − S_end) / η
 */
export function calculateMapDose(
    patient: PatientProfile,
    history: (LabRecord & { antiTpo?: number; antiTg?: number })[]
): EstimationResult {
    if (!history || history.length === 0) {
        throw new Error('At least one lab observation is required for Bayesian titration.')
    }

    const latestLab = history[history.length - 1]
    const weight    = latestLab.weightKg

    if (!weight || weight <= 0) {
        throw new Error('Valid patient weight in kg is required for estimation.')
    }
    if (!latestLab.tshMeasured || latestLab.tshMeasured <= 0) {
        throw new Error('Valid measured TSH is required for calculation.')
    }

    // ── 1. Per-record LBM and V_d  (V_d = 0.16 L/kg × W_LBM) ───────────────
    const latestLbm = computeLbm(latestLab, patient)
    const latestVd  = VD_PER_KG_LBM * latestLbm

    const cycles = history.map((rec) => {
        const lbm = computeLbm(rec, patient)
        return {
            D:   rec.dailyDoseMcg ?? 0,
            tsh: rec.tshMeasured,
            ft4: rec.freeT4 && rec.freeT4 > 0 ? rec.freeT4 : undefined,
            vd:  VD_PER_KG_LBM * lbm,
        }
    })

    // ── 2. Population priors θ_prior = [η, S_end, k_e] ──────────────────────
    // S_end is conditioned on thyroid gland status: it represents the effective
    // residual endogenous T4 contribution under therapy-induced TSH suppression.
    const sEndPriorByStatus: Record<string, number> = {
        intact:              40,  // mcg/day — partial gland, partially suppressed
        partial_resection:   20,  // mcg/day — reduced remnant production
        total_thyroidectomy:  0,  // mcg/day — no native gland
    }
    const etaPrior  = 0.80
    const sEndPrior = sEndPriorByStatus[patient.thyroidStatus] ?? 40
    const kePrior   = 1.5   // effective clearance rate (day⁻¹)

    // ── 3. Gradient Descent MAP Optimizer ────────────────────────────────────
    // Minimises J(θ) using gradient descent with per-parameter learning rates
    // and hard physiological bounds on each parameter.
    let eta  = etaPrior
    let sEnd = sEndPrior
    let ke   = kePrior

    for (let iter = 0; iter < MAX_ITER; iter++) {
        const { dEta, dSEnd, dKe } = costAndGradient(
            eta, sEnd, ke,
            etaPrior, sEndPrior, kePrior,
            cycles
        )

        eta  -= LR_ETA  * dEta
        sEnd -= LR_SEND * dSEnd
        ke   -= LR_KE   * dKe

        // Hard physiological bounds
        eta  = Math.max(0.05, Math.min(eta,  1.00))
        sEnd = Math.max(0.00, Math.min(sEnd, 200.0))
        ke   = Math.max(0.05, Math.min(ke,   20.0))

        // Early stop when all parameter updates become negligible
        if (
            Math.abs(dEta)  * LR_ETA  < 1e-9 &&
            Math.abs(dSEnd) * LR_SEND < 1e-9 &&
            Math.abs(dKe)   * LR_KE   < 1e-9
        ) break
    }

    // ── 4. Optimal Dose Inversion ─────────────────────────────────────────────
    // Closed-form solution from inverting the steady-state system (per image):
    //   D* = (k_e · V_d · EC50 · (TSH_max/TSH_target − 1)^(1/γ) − S_end) / η
    const targetTsh = Math.max(patient.targetTsh || 1.5, 0.1)
    const tshRatio  = TSH_MAX / targetTsh - 1
    const rawD = tshRatio > 0
        ? (ke * latestVd * EC50 * Math.pow(tshRatio, 1 / GAMMA) - sEnd) / eta
        : 0

    // ── 5. Quantization & Clinical Safety Clamp ───────────────────────────────
    let recommendedDose = Math.round(rawD / 12.5) * 12.5
    recommendedDose = Math.max(25, Math.min(recommendedDose, 300))

    // ── 6. Predicted Steady-State TSH at Recommended Dose (6–8 wks) ──────────
    const predictedFt4 = fT4Steady(recommendedDose, eta, sEnd, ke, latestVd)
    const predictedTsh = parseFloat(tshSteady(predictedFt4).toFixed(2))

    // ── 7. Final Objective Value J(θ̂) ─────────────────────────────────────────
    const { cost: objectiveRaw } = costAndGradient(
        eta, sEnd, ke,
        etaPrior, sEndPrior, kePrior,
        cycles
    )
    const objectiveValue = parseFloat(objectiveRaw.toFixed(6))

    // ── 8. Output Assembly ────────────────────────────────────────────────────
    // individualClearance = k_e · V_d  (L/day), consistent with prior meaning
    const individualClearance = parseFloat((ke * latestVd).toFixed(2))

    const currentDose   = latestLab.dailyDoseMcg ?? 0
    const isUnmedicated = currentDose === 0
    const calculationNote = isUnmedicated
        ? `Initial Starting Dose (${latestLab.date}): Unmedicated baseline (TSH ${latestLab.tshMeasured} µIU/mL) -> Recommended ${recommendedDose} mcg/day`
        : `Titration Adjustment (${latestLab.date}): Current ${currentDose} mcg/day (TSH ${latestLab.tshMeasured} µIU/mL) -> Recommended ${recommendedDose} mcg/day`

    return {
        recommendedDoseMcg:  recommendedDose,
        leanBodyMassKg:      parseFloat(latestLbm.toFixed(1)),
        latestWeightKg:      weight,
        individualClearance: individualClearance,
        predictedTsh:        predictedTsh,
        objectiveValue:      objectiveValue,
        calculationNote:     calculationNote,
    }
}