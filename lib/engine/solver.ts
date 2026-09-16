import { PatientProfile, LabRecord, EstimationResult } from './types'

const PRIOR_CLEARANCE_PER_LBM_MEAN = 0.08 // L/day per kg LBM
const PRIOR_CLEARANCE_SD = 0.015
const SIGMA_OBS_TSH = 0.4

/**
 * Calculates Lean Body Mass (LBM) using Boer's Formula
 */
export function calculateLbm(weightKg: number, heightCm: number, sex: 'male' | 'female'): number {
    if (sex === 'male') {
        return Math.max(30, 0.407 * weightKg + 0.267 * heightCm - 19.2)
    } else {
        return Math.max(25, 0.183 * weightKg + 0.456 * heightCm - 35.27)
    }
}

function predictTsh(dailyDoseMcg: number, clearanceLPerDay: number): number {
    const t4Concentration = dailyDoseMcg / clearanceLPerDay
    const tsh = 12.0 * Math.exp(-0.018 * t4Concentration)
    return Math.max(0.01, tsh)
}

function objectiveFunction(
    cl: number,
    popClearance: number,
    history: LabRecord[]
): number {
    const priorPenalty = Math.pow(cl - popClearance, 2) / Math.pow(PRIOR_CLEARANCE_SD, 2)

    let likelihoodPenalty = 0
    for (const record of history) {
        const tshPred = predictTsh(record.dailyDoseMcg, cl)
        likelihoodPenalty += Math.pow(Math.log(record.tshMeasured) - Math.log(tshPred), 2) / Math.pow(SIGMA_OBS_TSH, 2)
    }

    return priorPenalty + likelihoodPenalty
}

export function calculateMapDose(
    patient: PatientProfile,
    history: LabRecord[]
): EstimationResult {
    const lbm = calculateLbm(patient.weightKg, patient.heightCm, patient.sex)
    const popClearance = lbm * PRIOR_CLEARANCE_PER_LBM_MEAN

    let a = popClearance * 0.2
    let b = popClearance * 3.0
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
    const targetDoseRaw = (-Math.log(patient.targetTsh / 12.0) * optimalCL) / 0.018
    const recommendedDoseMcg = Math.max(25, Math.min(300, Math.round(targetDoseRaw / 12.5) * 12.5))

    return {
        leanBodyMassKg: Number(lbm.toFixed(1)),
        individualClearance: Number(optimalCL.toFixed(4)),
        recommendedDoseMcg,
        predictedTsh: Number(predictTsh(recommendedDoseMcg, optimalCL).toFixed(2)),
        objectiveValue: Number(objectiveFunction(optimalCL, popClearance, history).toFixed(4))
    }
}