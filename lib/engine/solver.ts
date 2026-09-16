import { PatientProfile, LabRecord, EstimationResult } from './types'

const PRIOR_CLEARANCE_PER_LBM = 0.016 // L/day per kg LBM
const PRIOR_CLEARANCE_SD = 0.004
const SIGMA_OBS_TSH = 0.35

export function calculateLbm(weightKg: number, heightCm: number, sex: 'male' | 'female'): number {
    if (sex === 'male') {
        return Math.max(30, 0.407 * weightKg + 0.267 * heightCm - 19.2)
    } else {
        return Math.max(25, 0.183 * weightKg + 0.456 * heightCm - 35.27)
    }
}

function predictTsh(totalExogenousDoseMcg: number, clearanceLPerDay: number): number {
    const css = totalExogenousDoseMcg / clearanceLPerDay
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
    if (history.length === 0) {
        throw new Error('Please add at least one lab observation record.')
    }

    const latestRecord = history[history.length - 1]
    const lbm = calculateLbm(latestRecord.weightKg, patient.heightCm, patient.sex)
    const popClearance = lbm * PRIOR_CLEARANCE_PER_LBM
    const activeRecords = history.filter(r => r.dailyDoseMcg > 0)

    // UNTREATED / ZERO-DOSE PATIENT LOGIC
    if (activeRecords.length === 0) {
        let startingDose = 0
        let note = ''

        if (patient.thyroidStatus === 'total_thyroidectomy') {
            // Complete ablation: full replacement requirement (~1.6 mcg/kg LBM)
            startingDose = Math.round((1.6 * lbm) / 12.5) * 12.5
            note = 'Total thyroidectomy detected. Initiating full replacement dosing (1.6 mcg/kg LBM).'
        } else if (patient.thyroidStatus === 'partial_resection') {
            // Partial resection: ~50-70% calculated replacement depending on TSH severity
            const factor = latestRecord.tshMeasured > 10 ? 1.2 : 0.8
            startingDose = Math.round((factor * lbm) / 12.5) * 12.5
            note = 'Partial thyroidectomy detected. Initiating partial replacement dosing.'
        } else {
            // Intact Gland (e.g. Hashimoto's or primary hypothyroidism)
            if (latestRecord.tshMeasured < 10) {
                startingDose = 25 // Conservative start for subclinical hypothyroidism
                note = 'Intact thyroid with mild TSH elevation. Conservative 25 mcg starting dose.'
            } else {
                startingDose = Math.round((0.8 * lbm) / 12.5) * 12.5
                note = 'Intact thyroid with marked TSH elevation. Starting partial replacement dose.'
            }
        }

        return {
            latestWeightKg: latestRecord.weightKg,
            leanBodyMassKg: Number(lbm.toFixed(1)),
            individualClearance: Number(popClearance.toFixed(4)),
            recommendedDoseMcg: startingDose,
            predictedTsh: Number(predictTsh(startingDose, popClearance).toFixed(2)),
            objectiveValue: 0,
            calculationNote: note
        }
    }

    // ACTIVE TITRATION OPTIMIZATION VIA MAP BAYESIAN SOLVER
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
        calculationNote: `MAP Bayesian optimization complete (${patient.thyroidStatus}, ${patient.isHashimotos ? 'Hashimoto+' : 'Non-autoimmune'}).`
    }
}