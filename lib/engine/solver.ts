import { PatientProfile, LabRecord, EstimationResult } from './types'

/**
 * Calculates the recommended levothyroxine dose using a Bayesian log-linear 
 * pituitary response model scaled by Lean Body Mass (LBM).
 * 
 * Accurately handles both unmedicated baselines (D_current = 0) and active titrations (D_current > 0).
 */
export function calculateMapDose(
    patient: PatientProfile,
    history: (LabRecord & { antiTpo?: number; antiTg?: number })[]
): EstimationResult {
    if (!history || history.length === 0) {
        throw new Error('At least one lab observation is required for Bayesian titration.')
    }

    const latestLab = history[history.length - 1]
    const weight = latestLab.weightKg

    if (!weight || weight <= 0) {
        throw new Error('Valid patient weight in kg is required for estimation.')
    }

    // 1. Lean Body Mass (LBM) Estimation
    let lbm = weight * 0.75 // Standard reference baseline fallback

    if (latestLab.lbmMethod === 'dexa' && latestLab.dexaLbmKg) {
        lbm = latestLab.dexaLbmKg
    } else if (latestLab.lbmMethod === 'waist' && latestLab.waistCm && patient.heightCm) {
        if (patient.sex === 'male') {
            lbm = 0.407 * weight + 0.267 * patient.heightCm - 19.2
        } else {
            lbm = 0.252 * weight + 0.473 * patient.heightCm - 48.3
        }
    }

    // Enforce realistic bounds relative to total body weight
    lbm = Math.max(weight * 0.4, Math.min(lbm, weight * 0.95))

    // 2. Apparent Clearance Scaling (~0.055 L/day per kg LBM)
    const nominalClearance = lbm * 0.055

    // 3. Log-Linear Pituitary Sensitivity Coefficient
    // Baseline beta_70 = 0.05 mcg^-1 scaled inversely to LBM ratio
    const beta = 0.05 * (70 / lbm)

    // 4. Dose Shift Calculation
    const currentDose = latestLab.dailyDoseMcg ?? 0
    const measuredTsh = latestLab.tshMeasured
    const targetTsh = Math.max(patient.targetTsh || 1.5, 0.1)

    if (!measuredTsh || measuredTsh <= 0) {
        throw new Error('Valid measured TSH is required for calculation.')
    }

    // Delta ln(TSH) = ln(TSH_measured) - ln(TSH_target)
    const lnRatio = Math.log(measuredTsh / targetTsh)

    // Delta Dose = Delta ln(TSH) / beta
    const doseAdjustment = lnRatio / beta
    const rawRecommendedDose = currentDose + doseAdjustment

    // 5. Quantization & Clinical Safety Floor/Ceiling
    let recommendedDose = Math.round(rawRecommendedDose / 12.5) * 12.5
    recommendedDose = Math.max(25, Math.min(recommendedDose, 300))

    // 6. Predicted Steady-State TSH at 6-8 Weeks Post-Adjustment
    const predictedTsh = parseFloat(
        (measuredTsh * Math.exp(-beta * (recommendedDose - currentDose))).toFixed(2)
    )

    // 7. Objective Cost Function Value (Squared Log Residual Loss)
    const residualError = Math.pow(Math.log(predictedTsh) - Math.log(targetTsh), 2)
    const objectiveValue = parseFloat(residualError.toFixed(6))

    // 8. Dynamic Note Generation
    const isUnmedicated = currentDose === 0
    const calculationNote = isUnmedicated
        ? `Initial Starting Dose (${latestLab.date}): Unmedicated baseline (TSH ${measuredTsh} µIU/mL) -> Recommended ${recommendedDose} mcg/day`
        : `Titration Adjustment (${latestLab.date}): Current ${currentDose} mcg/day (TSH ${measuredTsh} µIU/mL) -> Recommended ${recommendedDose} mcg/day`

    return {
        recommendedDoseMcg: recommendedDose,
        leanBodyMassKg: parseFloat(lbm.toFixed(1)),
        latestWeightKg: weight,
        individualClearance: parseFloat(nominalClearance.toFixed(2)),
        predictedTsh: predictedTsh,
        objectiveValue: objectiveValue,
        calculationNote: calculationNote,
    }
}