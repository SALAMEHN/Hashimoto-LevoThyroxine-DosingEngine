export interface PatientProfile {
    weightKg: number
    age: number
    sex: 'male' | 'female'
    targetTsh: number // mIU/L (typically 0.5 - 2.5)
}

export interface LabRecord {
    date: string
    dailyDoseMcg: number
    tshMeasured: number // mIU/L
}

export interface EstimationResult {
    individualClearance: number // L/day
    recommendedDoseMcg: number // mcg/day
    predictedTsh: number // mIU/L
    objectiveValue: number
}