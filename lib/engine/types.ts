export interface PatientProfile {
    weightKg: number
    heightCm: number
    waistCm?: number
    age: number
    sex: 'male' | 'female'
    targetTsh: number // mIU/L
}

export interface LabRecord {
    date: string
    dailyDoseMcg: number
    tshMeasured: number // mIU/L
}

export interface EstimationResult {
    leanBodyMassKg: number
    individualClearance: number // L/day
    recommendedDoseMcg: number // mcg/day
    predictedTsh: number // mIU/L
    objectiveValue: number
}