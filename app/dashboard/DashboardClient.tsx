'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { calculateMapDose } from '@/lib/engine/solver'
import { PatientProfile, LabRecord, EstimationResult } from '@/lib/engine/types'

export default function DashboardClient({ userEmail }: { userEmail: string }) {
    const router = useRouter()
    const supabase = createClient()

    const [patient, setPatient] = useState<PatientProfile>({
        weightKg: 110,
        heightCm: 180,
        waistCm: 100,
        age: 35,
        sex: 'male',
        targetTsh: 1.5,
    })

    const [history, setHistory] = useState<LabRecord[]>([
        { date: '2026-01-01', dailyDoseMcg: 100, tshMeasured: 5.2 },
    ])

    const [newDose, setNewDose] = useState<number>(100)
    const [newTsh, setNewTsh] = useState<number>(5.2)
    const [result, setResult] = useState<EstimationResult | null>(null)

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/login')
    }

    const handleAddRecord = () => {
        setHistory([
            ...history,
            {
                date: new Date().toISOString().split('T')[0],
                dailyDoseMcg: newDose,
                tshMeasured: newTsh,
            },
        ])
    }

    const handleRemoveRecord = (index: number) => {
        setHistory(history.filter((_, i) => i !== index))
    }

    const handleCalculate = () => {
        const res = calculateMapDose(patient, history)
        setResult(res)
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex justify-between items-center border-b border-gray-800 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-emerald-400">Thyroid Engine Dashboard</h1>
                    <p className="text-xs text-gray-400 font-mono">User: {userEmail}</p>
                </div>
                <button
                    onClick={handleSignOut}
                    className="bg-gray-800 hover:bg-gray-700 text-xs text-red-400 border border-gray-700 px-3 py-1.5 rounded transition"
                >
                    Sign Out
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-4">
                    <h2 className="text-lg font-semibold text-emerald-300">Patient Anthropometrics</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Weight (kg)</label>
                            <input
                                type="number"
                                value={patient.weightKg}
                                onChange={(e) => setPatient({ ...patient, weightKg: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Height (cm)</label>
                            <input
                                type="number"
                                value={patient.heightCm}
                                onChange={(e) => setPatient({ ...patient, heightCm: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Waist (cm)</label>
                            <input
                                type="number"
                                value={patient.waistCm || ''}
                                onChange={(e) => setPatient({ ...patient, waistCm: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Age (yrs)</label>
                            <input
                                type="number"
                                value={patient.age}
                                onChange={(e) => setPatient({ ...patient, age: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Sex</label>
                            <select
                                value={patient.sex}
                                onChange={(e) => setPatient({ ...patient, sex: e.target.value as 'male' | 'female' })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            >
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Target TSH (mIU/L)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={patient.targetTsh}
                                onChange={(e) => setPatient({ ...patient, targetTsh: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                    </div>
                </div>

                <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-4">
                    <h2 className="text-lg font-semibold text-emerald-300">Add Lab Entry</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Dose (mcg/day)</label>
                            <input
                                type="number"
                                value={newDose}
                                onChange={(e) => setNewDose(parseFloat(e.target.value) || 0)}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">TSH (mIU/L)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={newTsh}
                                onChange={(e) => setNewTsh(parseFloat(e.target.value) || 0)}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleAddRecord}
                        className="w-full bg-gray-800 hover:bg-gray-700 text-sm py-2 rounded transition text-gray-200 font-medium cursor-pointer"
                    >
                        + Add Entry
                    </button>
                </div>
            </div>

            <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-semibold text-emerald-300">Lab History</h2>
                {history.length === 0 ? (
                    <p className="text-xs text-gray-500">No lab entries recorded yet.</p>
                ) : (
                    <div className="space-y-2">
                        {history.map((record, index) => (
                            <div key={index} className="flex justify-between items-center bg-gray-950 p-3 rounded border border-gray-800 text-sm">
                                <span>
                                    Dose: <strong className="text-white">{record.dailyDoseMcg} mcg</strong> | Measured TSH: <strong className="text-emerald-400">{record.tshMeasured} mIU/L</strong>
                                </span>
                                <button
                                    onClick={() => handleRemoveRecord(index)}
                                    className="text-xs text-red-400 hover:text-red-300"
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <button
                onClick={handleCalculate}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition shadow-lg cursor-pointer"
            >
                Compute MAP Bayesian Recommendation
            </button>

            {result && (
                <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-6 space-y-4">
                    <h2 className="text-xl font-bold text-emerald-400">Optimization Result</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                        <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <div className="text-xs text-gray-400">Recommended Dose</div>
                            <div className="text-2xl font-extrabold text-emerald-400">{result.recommendedDoseMcg} mcg</div>
                        </div>
                        <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <div className="text-xs text-gray-400">Estimated LBM</div>
                            <div className="text-xl font-bold text-white">{result.leanBodyMassKg} kg</div>
                        </div>
                        <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <div className="text-xs text-gray-400">Individual Clearance</div>
                            <div className="text-xl font-bold text-white">{result.individualClearance} L/day</div>
                        </div>
                        <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <div className="text-xs text-gray-400">Predicted TSH</div>
                            <div className="text-xl font-bold text-white">{result.predictedTsh} mIU/L</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}