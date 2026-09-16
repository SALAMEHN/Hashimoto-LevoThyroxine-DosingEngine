export type ThyroidStatus = 'intact' | 'partial_resection' | 'total_thyroidectomy'
export type LbmMethod = 'dexa' | 'waist'

export interface PatientProfile {
    birthYear: number
    heightCm: number
    sex: 'male' | 'female'
    targetTsh: number
    thyroidStatus: ThyroidStatus
    isHashimotos: boolean
}

export interface LabRecord {
    id: string
    date: string
    weightKg: number
    lbmMethod: LbmMethod
    waistCm?: number
    dexaLbmKg?: number
    dailyDoseMcg: number
    tshMeasured: number
    freeT4?: number // ng/dL
    freeT3?: number // pg/mL
}

export interface OptimizationRun {
    id: string
    createdAt: string
    recommendedDoseMcg: number
    estimatedLbmKg: number
    estimatedClearance: number
    predictedTsh: number
    calculationNote: string
}

export interface EstimationResult {
    latestWeightKg: number
    leanBodyMassKg: number
    individualClearance: number
    recommendedDoseMcg: number
    predictedTsh: number
    objectiveValue: number
    calculationNote: string
}