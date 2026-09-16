import { PatientProfile, LabRecord, EstimationResult } from './types'

// Population Priors for Levothyroxine (LT4)
const PRIOR_CLEARANCE_MEAN = 0.055 // L/day per kg
const PRIOR_CLEARANCE_SD = 0.015
const SIGMA_OBS_TSH = 0.4 // Measurement noise standard deviation on log TSH scale

/**
 * Calculates steady-state TSH given daily dose (mcg/day) and individual clearance CL (L/day)
 * Model: TSH_ss = TSH_baseline * exp(-alpha * (Dose / CL))
 */
function predictTsh(dailyDoseMcg: number, clearanceLPerDay: number): number {
    const t4Concentration = dailyDoseMcg / clearanceLPerDay
    // Empirical PK/PD inverse log-linear response model
    const tsh = 12.0 * Math.exp(-0.018 * t4Concentration)
    return Math.max(0.01, tsh)
}

/**
 * MAP Objective Function to minimize:
 * \Phi(CL) = \frac{(CL - \mu_{CL})^2}{\sigma_{prior}^2} + \sum \frac{(\ln(TSH_{obs}) - \ln(TSH_{pred}))^2}{\sigma_{obs}^2}
 */
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

/**
 * Golden Section Search 1D Minimizer for MAP Clearance Estimation
 */
export function calculateMapDose(
    patient: PatientProfile,
    history: LabRecord[]
): EstimationResult {
    const popClearance = patient.weightKg * PRIOR_CLEARANCE_MEAN

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

    // Calculate recommended dose to hit target TSH
    // TSH_target = 12 * exp(-0.018 * (Dose / CL)) => Dose = -ln(TSH_target / 12) * CL / 0.018
    const targetDoseRaw = (-Math.log(patient.targetTsh / 12.0) * optimalCL) / 0.018
    const recommendedDoseMcg = Math.max(25, Math.min(300, Math.round(targetDoseRaw / 12.5) * 12.5))

    return {
        individualClearance: Number(optimalCL.toFixed(4)),
        recommendedDoseMcg,
        predictedTsh: Number(predictTsh(recommendedDoseMcg, optimalCL).toFixed(2)),
        objectiveValue: Number(objectiveFunction(optimalCL, popClearance, history).toFixed(4))
    }
}