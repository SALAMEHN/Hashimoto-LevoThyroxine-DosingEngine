import { PatientProfile, LabRecord, EstimationResult } from './types'

// Physiological LT4 Clearance Prior: ~0.016 L/day per kg LBM (~1.15 L/day for 70kg LBM)
const PRIOR_CLEARANCE_PER_LBM = 0.016
const PRIOR_CLEARANCE_SD = 0.004
const SIGMA_OBS_TSH = 0.35

/**
 * Boer Formula for Lean Body Mass (LBM)
 */
export function calculateLbm(weightKg: number, heightCm: number, sex: 'male' | 'female'): number {
    if (sex === 'male') {
        return Math.max(30, 0.407 * weightKg + 0.267 * heightCm - 19.2)
    } else {
        return Math.max(25, 0.183 * weightKg + 0.456 * heightCm - 35.27)
    }
}

/**
 * Log-linear TSH steady-state response model
 * Css = Dose / CL (mcg/L)
 * TSH_ss = TSH_0 * exp(-gamma * Css)
 */
function predictTsh(dailyDoseMcg: number, clearanceLPerDay: number): number {
    if (dailyDoseMcg === 0) return 25.0
    const css = dailyDoseMcg / clearanceLPerDay
    const tsh = 28.0 * Math.exp(-0.035 * css)
    return Math.max(0.01, tsh)
}

function objectiveFunction(
    cl: number,
    popClearance: number,
    history: LabRecord[]
): number {
    const priorPenalty = Math.pow(cl - popClearance, 2) / Math.pow(PRIOR_CLEARANCE_SD, 2)

    let likelihoodPenalty = 0
    const activeRecords = history.filter(r => r.dailyDoseMcg > 0)

    for (const record of activeRecords) {
        const tshPred = predictTsh(record.dailyDoseMcg, cl)
        likelihoodPenalty += Math.pow(Math.log(record.tshMeasured) - Math.log(tshPred), 2) / Math.pow(SIGMA_OBS_TSH, 2)
    }

    return priorPenalty + likelihoodPenalty
}

export function calculateMapDose(
    patient: PatientProfile,
    history: LabRecord[]
): EstimationResult {
    if (history.length === 0) {
        throw new Error('Please add at least one lab record with weight and TSH.')
    }

    const latestRecord = history[history.length - 1]
    const lbm = calculateLbm(latestRecord.weightKg, patient.heightCm, patient.sex)
    const popClearance = lbm * PRIOR_CLEARANCE_PER_LBM

    const activeRecords = history.filter(r => r.dailyDoseMcg > 0)

    // Fallback for treatment-naive or zero-dose patients: replacement dosing = 1.6 mcg/kg LBM
    if (activeRecords.length === 0) {
        const empiricalDose = Math.round((1.6 * lbm) / 12.5) * 12.5
        return {
            latestWeightKg: latestRecord.weightKg,
            leanBodyMassKg: Number(lbm.toFixed(1)),
            individualClearance: Number(popClearance.toFixed(4)),
            recommendedDoseMcg: empiricalDose,
            predictedTsh: Number(predictTsh(empiricalDose, popClearance).toFixed(2)),
            objectiveValue: 0,
            calculationNote: 'Zero active dosage history detected. Using baseline replacement dosing (1.6 mcg/kg LBM).'
        }
    }

    // Golden Section Search 1D Minimizer for MAP Clearance
    let a = popClearance * 0.3
    let b = popClearance * 2.5
    const phi = (1 + Math.sqrt(5)) / 2
    const resphi = 2 - phi

    let x1 = a + resphi * (b - a)
    let x2 = b - resphi * (b - a)
    let f1 = objectiveFunction(x1, popClearance, history)
    let f2 = objectiveFunction(x2, popClearance, history)

    for (let i = 0; i < 40; i++) {
        if (f1 < f2) {
            b = x2
            x2 = x1
            f2 = f1
            x1 = a + resphi * (b - a)
            f1 = objectiveFunction(x1, popClearance, history)
        } else {
            a = x1
            x1 = x2
            f1 = f2
            x2 = b - resphi * (b - a)
            f2 = objectiveFunction(x2, popClearance, history)
        }
    }

    const optimalCL = (a + b) / 2

    // Calculate recommended dose to reach target TSH
    const targetCss = -Math.log(patient.targetTsh / 28.0) / 0.035
    const targetDoseRaw = targetCss * optimalCL
    const recommendedDoseMcg = Math.max(25, Math.min(275, Math.round(targetDoseRaw / 12.5) * 12.5))

    return {
        latestWeightKg: latestRecord.weightKg,
        leanBodyMassKg: Number(lbm.toFixed(1)),
        individualClearance: Number(optimalCL.toFixed(4)),
        recommendedDoseMcg,
        predictedTsh: Number(predictTsh(recommendedDoseMcg, optimalCL).toFixed(2)),
        objectiveValue: Number(objectiveFunction(optimalCL, popClearance, history).toFixed(4)),
        calculationNote: 'MAP Bayesian optimization complete based on longitudinal lab history.'
    }
}