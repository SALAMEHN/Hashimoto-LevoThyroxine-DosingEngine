import { PatientProfile, LabRecord, EstimationResult } from './types'

// ─── Steady-State PK/PD Model Constants ──────────────────────────────────────
//
// The image formula:  fT4_ss(D) = (η · D + S_end) / (k_e · V_d)
// produces concentration in mcg/L (dose in mcg/day ÷ clearance in L/day).
// But measured fT4 is in ng/dL.  The conversion factor ALPHA accounts for:
//   • 1 mcg/L = 100 ng/dL  (unit conversion)
//   • Only ~0.02–0.03 % of plasma T4 is free  (free fraction)
// Their product gives ALPHA ≈ 0.014, empirically calibrated so that a
// thyroidectomy patient (S_end=0) on 100 mcg/day with LBM ≈ 55 kg yields
// fT4 ≈ 1.3 ng/dL — matching clinical pharmacokinetic data.
//
// With ALPHA in place, k_e takes its true pharmacokinetic value (~0.1 day⁻¹,
// corresponding to T4 half-life ≈ 7 days) and CL = k_e · V_d is a
// physiologically realistic metabolic clearance rate (≈ 0.8–1.5 L/day).
//
// TSH_MAX, EC50, and GAMMA define the Hill/Michaelis-Menten pituitary response:
//   TSH_ss(fT4) = TSH_max / (1 + (fT4 / EC50)^γ)
//
// EC50 = 0.32 ng/dL is the fT4 at which TSH is half-maximally suppressed.
// This lies in the hypothyroid range, which is physiologically correct: the
// pituitary's TSH secretion is at its midpoint when the patient is moderately
// hypothyroid, not when they are euthyroid.
//
// TSH_MAX = 100 mIU/L covers the full range of observed TSH values in
// clinical practice (severely hypothyroid patients can have TSH > 50).
//
const ALPHA          = 0.014 // fT4 unit-conversion factor (free fraction × mcg/L→ng/dL)
const TSH_MAX        = 100.0 // mIU/L  — maximum TSH secretion capacity
const EC50           = 0.32  // ng/dL  — fT4 at 50 % TSH suppression
const GAMMA          = 3.0   // Hill coefficient (sigmoidal steepness)
const VD_PER_KG_LBM  = 0.16  // L/kg  — V_d = 0.16 L/kg × W_LBM (per image)

// ─── Optimizer Hyperparameters ────────────────────────────────────────────────
const W_TSH  = 1.0   // TSH residual weight in cost function
const W_FT4  = 10.0  // fT4 residual weight (fT4 in ng/dL has smaller residuals)
const LAMBDA = 1.0   // Overall L2 regularization strength

// Per-parameter prior uncertainty (σ) for normalized regularization.
// The regularization term is:  λ · [ (η−ηp)²/σ_η² + (S−Sp)²/σ_S² + (k−kp)²/σ_k² ]
// This prevents the numerically-larger S_end from dominating the L2 penalty.
const REG_SIGMA_ETA  = 0.3   // η ranges ~[0.3, 1.0]
const REG_SIGMA_SEND = 40.0  // S_end ranges ~[0, 100]
const REG_SIGMA_KE   = 0.15  // k_e ranges ~[0.02, 0.5]

const MAX_ITER = 5000

// Per-parameter gradient-descent learning rates.
// Calibrated to the expected gradient magnitudes at population-average θ for
// typical levothyroxine doses (25–300 mcg/day) and LBM values (40–120 kg).
// k_e gradients are ~100× larger than η gradients due to the 1/k_e² dependence,
// so LR_KE is proportionally smaller.
const LR_ETA  = 5e-5  // learning rate for η  (absorption efficiency)
const LR_SEND = 5e-1  // learning rate for S_end  (endogenous production)
const LR_KE   = 5e-6  // learning rate for k_e  (clearance rate)

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
 * Steady-state free T4 concentration (ng/dL) given dose D (mcg/day) and θ.
 *
 *   fT4_ss(D) = ALPHA · (η · D + S_end) / (k_e · V_d)
 *
 * ALPHA converts from the raw PK concentration (mcg/L) to measured fT4 (ng/dL),
 * encompassing the free fraction and unit conversion.
 */
function fT4Steady(D: number, eta: number, sEnd: number, ke: number, vd: number): number {
    const kv = ke * vd
    return kv < 1e-9 ? 0 : ALPHA * (eta * D + sEnd) / kv
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
 *          + λ·‖θ − θ_prior‖²_normalized
 *
 * Analytical gradients via the chain rule (fT4 term omitted when unavailable):
 *
 *   ∂J/∂η     = Σᵢ −2·w_TSH·rTSH·(∂t/∂f)·(ALPHA·D/(ke·Vd))   + reg
 *   ∂J/∂S_end = Σᵢ −2·w_TSH·rTSH·(∂t/∂f)·(ALPHA/(ke·Vd))     + reg
 *   ∂J/∂k_e   = Σᵢ −2·w_TSH·rTSH·(∂t/∂f)·(−f/ke)             + reg
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

        // Partials of fT4_ss wrt each parameter (ALPHA included)
        // ∂f/∂η = ALPHA · D / (ke·Vd)
        const dfde = ALPHA * D / kvSafe
        // ∂f/∂S_end = ALPHA / (ke·Vd)
        const dfds = ALPHA     / kvSafe
        // ∂f/∂ke = −f / ke   [f already includes ALPHA, so this is correct]
        const dfdk = -fSafe    / ke

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

    // Normalized L2 regularization toward population priors:
    // λ · [ (η−ηp)²/σ_η² + (S−Sp)²/σ_S² + (k−kp)²/σ_k² ]
    const sigEta2  = REG_SIGMA_ETA  * REG_SIGMA_ETA
    const sigSend2 = REG_SIGMA_SEND * REG_SIGMA_SEND
    const sigKe2   = REG_SIGMA_KE   * REG_SIGMA_KE

    cost  += LAMBDA * (
        (eta - etaPrior) ** 2 / sigEta2 +
        (sEnd - sEndPrior) ** 2 / sigSend2 +
        (ke - kePrior) ** 2 / sigKe2
    )
    dEta  += 2 * LAMBDA * (eta  - etaPrior)  / sigEta2
    dSEnd += 2 * LAMBDA * (sEnd - sEndPrior) / sigSend2
    dKe   += 2 * LAMBDA * (ke   - kePrior)   / sigKe2

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
 *   fT4_ss(D) = ALPHA · (η · D + S_end) / (k_e · V_d)     [ng/dL]
 *   TSH_ss    = TSH_max / (1 + (fT4_ss / EC50)^γ)          [mIU/L]
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
 * Optimal Dose Solve (with ALPHA conversion):
 * Once θ̂ is updated from the latest blood test, D* is solved analytically:
 *
 *   D* = (k_e · V_d / ALPHA · EC50 · (TSH_max/TSH_target − 1)^(1/γ) − S_end) / η
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
    // residual endogenous T4 production.
    //   intact:              ~40 mcg/day (partially failing gland in Hashimoto's)
    //   partial_resection:   ~15 mcg/day (reduced remnant)
    //   total_thyroidectomy:   0 mcg/day (no native gland)
    const sEndPriorByStatus: Record<string, number> = {
        intact:              40,
        partial_resection:   15,
        total_thyroidectomy:  0,
    }
    const etaPrior  = 0.80
    const sEndPrior = sEndPriorByStatus[patient.thyroidStatus] ?? 40
    const kePrior   = 0.1    // day⁻¹  (T4 half-life ≈ 7 days → k_e = ln2/7 ≈ 0.1)

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
        eta  = Math.max(0.05, Math.min(eta,  1.00))   // absorption: 5–100 %
        sEnd = Math.max(0.00, Math.min(sEnd, 200.0))   // endogenous: 0–200 mcg/day
        ke   = Math.max(0.02, Math.min(ke,   1.00))    // k_e: t½ range ~0.7–35 days

        // Early stop when all parameter updates become negligible
        if (
            Math.abs(dEta)  * LR_ETA  < 1e-9 &&
            Math.abs(dSEnd) * LR_SEND < 1e-9 &&
            Math.abs(dKe)   * LR_KE   < 1e-9
        ) break
    }

    // ── 4. Optimal Dose Inversion ─────────────────────────────────────────────
    // Closed-form solution from inverting the steady-state system (per image),
    // with ALPHA conversion factor:
    //
    //   fT4_target = EC50 · (TSH_max/TSH_target − 1)^(1/γ)
    //   D* = (fT4_target · k_e · V_d / ALPHA − S_end) / η
    //
    const targetTsh = Math.max(patient.targetTsh || 1.5, 0.1)
    const tshRatio  = TSH_MAX / targetTsh - 1
    const rawD = tshRatio > 0
        ? (ke * latestVd / ALPHA * EC50 * Math.pow(tshRatio, 1 / GAMMA) - sEnd) / eta
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
    // individualClearance = k_e · V_d  (L/day) — now physiologically realistic
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