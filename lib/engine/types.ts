export type ThyroidStatus = 'intact' | 'partial_resection' | 'total_thyroidectomy'

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
    waistCm?: number
    dailyDoseMcg: number
    tshMeasured: number
}

export interface EstimationResult {
    latestWeightKg: number
    leanBodyMassKg: number
    individualClearance: number // L/day
    recommendedDoseMcg: number // mcg/day
    predictedTsh: number // mIU/L
    objectiveValue: number
    calculationNote: string
}