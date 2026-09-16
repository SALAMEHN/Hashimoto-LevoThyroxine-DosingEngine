'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { calculateMapDose } from '@/lib/engine/solver'
import { PatientProfile, LabRecord, EstimationResult, OptimizationRun, ThyroidStatus, LbmMethod } from '@/lib/engine/types'

export default function DashboardClient({ userEmail }: { userEmail: string }) {
    const router = useRouter()
    const supabase = createClient()

    const [activeTab, setActiveTab] = useState<'profile' | 'history' | 'calculator'>('profile')
    const [loading, setLoading] = useState(true)

    const [patient, setPatient] = useState<PatientProfile>({
        birthYear: 1990,
        heightCm: 180,
        sex: 'male',
        targetTsh: 1.5,
        thyroidStatus: 'intact',
        isHashimotos: false,
    })

    const [history, setHistory] = useState<LabRecord[]>([])
    const [savedRuns, setSavedRuns] = useState<OptimizationRun[]>([])

    const [newEntry, setNewEntry] = useState({
        date: new Date().toISOString().split('T')[0],
        weightKg: 110,
        lbmMethod: 'waist' as LbmMethod,
        waistCm: 100,
        dexaLbmKg: 75,
        dailyDoseMcg: 100,
        tshMeasured: 5.2,
        freeT4: 1.1,
        freeT3: 2.8,
    })

    const [result, setResult] = useState<EstimationResult | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Load Profile
            const { data: profileData } = await supabase
                .from('patient_profiles')
                .select('*')
                .eq('user_id', user.id)
                .single()

            if (profileData) {
                setPatient({
                    birthYear: profileData.birth_year,
                    heightCm: profileData.height_cm,
                    sex: profileData.sex as 'male' | 'female',
                    targetTsh: profileData.target_tsh,
                    thyroidStatus: profileData.thyroid_status as ThyroidStatus,
                    isHashimotos: profileData.is_hashimotos,
                })
            }

            // Load Labs
            const { data: labData } = await supabase
                .from('lab_records')
                .select('*')
                .eq('user_id', user.id)
                .order('date', { ascending: true })

            if (labData) {
                setHistory(
                    labData.map((r) => ({
                        id: r.id,
                        date: r.date,
                        weightKg: r.weight_kg,
                        lbmMethod: (r.lbm_method || 'waist') as LbmMethod,
                        waistCm: r.waist_cm,
                        dexaLbmKg: r.dexa_lbm_kg,
                        dailyDoseMcg: r.daily_dose_mcg,
                        tshMeasured: r.tsh_measured,
                        freeT4: r.free_t4,
                        freeT3: r.free_t3,
                    }))
                )
            }

            // Load Saved Optimization Runs History
            const { data: runsData } = await supabase
                .from('optimization_runs')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })

            if (runsData) {
                setSavedRuns(
                    runsData.map((r) => ({
                        id: r.id,
                        createdAt: r.created_at,
                        recommendedDoseMcg: r.recommended_dose_mcg,
                        estimatedLbmKg: r.estimated_lbm_kg,
                        estimatedClearance: r.estimated_clearance,
                        predictedTsh: r.predicted_tsh,
                        calculationNote: r.calculation_note,
                    }))
                )
            }

            setLoading(false)
        }

        fetchData()
    }, [])

    const handleSaveProfile = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        await supabase.from('patient_profiles').upsert({
            user_id: user.id,
            birth_year: patient.birthYear,
            height_cm: patient.heightCm,
            sex: patient.sex,
            target_tsh: patient.targetTsh,
            thyroid_status: patient.thyroidStatus,
            is_hashimotos: patient.isHashimotos,
            updated_at: new Date().toISOString(),
        })
        alert('Baseline metrics saved successfully!')
    }

    const handleAddRecord = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data } = await supabase
            .from('lab_records')
            .insert({
                user_id: user.id,
                date: newEntry.date,
                weight_kg: newEntry.weightKg,
                lbm_method: newEntry.lbmMethod,
                waist_cm: newEntry.lbmMethod === 'waist' ? newEntry.waistCm : null,
                dexa_lbm_kg: newEntry.lbmMethod === 'dexa' ? newEntry.dexaLbmKg : null,
                daily_dose_mcg: newEntry.dailyDoseMcg,
                tsh_measured: newEntry.tshMeasured,
                free_t4: newEntry.freeT4 || null,
                free_t3: newEntry.freeT3 || null,
            })
            .select()
            .single()

        if (data) {
            setHistory([
                ...history,
                {
                    id: data.id,
                    date: data.date,
                    weightKg: data.weight_kg,
                    lbmMethod: data.lbm_method as LbmMethod,
                    waistCm: data.waist_cm,
                    dexaLbmKg: data.dexa_lbm_kg,
                    dailyDoseMcg: data.daily_dose_mcg,
                    tshMeasured: data.tsh_measured,
                    freeT4: data.free_t4,
                    freeT3: data.free_t3,
                },
            ])
        }
    }

    const handleRemoveRecord = async (id: string) => {
        await supabase.from('lab_records').delete().eq('id', id)
        setHistory(history.filter((r) => r.id !== id))
    }

    const handleRunCalculator = async () => {
        setErrorMsg(null)
        try {
            const res = calculateMapDose(patient, history)
            setResult(res)

            // Save Optimization Run to Supabase History
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const { data: runData } = await supabase
                    .from('optimization_runs')
                    .insert({
                        user_id: user.id,
                        recommended_dose_mcg: res.recommendedDoseMcg,
                        estimated_lbm_kg: res.leanBodyMassKg,
                        estimated_clearance: res.individualClearance,
                        predicted_tsh: res.predictedTsh,
                        calculation_note: res.calculationNote,
                    })
                    .select()
                    .single()

                if (runData) {
                    setSavedRuns([
                        {
                            id: runData.id,
                            createdAt: runData.created_at,
                            recommendedDoseMcg: runData.recommended_dose_mcg,
                            estimatedLbmKg: runData.estimated_lbm_kg,
                            estimatedClearance: runData.estimated_clearance,
                            predictedTsh: runData.predicted_tsh,
                            calculationNote: runData.calculation_note,
                        },
                        ...savedRuns,
                    ])
                }
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Calculation error.')
        }
    }

    const handleDeleteRun = async (id: string) => {
        await supabase.from('optimization_runs').delete().eq('id', id)
        setSavedRuns(savedRuns.filter((r) => r.id !== id))
    }

    if (loading) {
        return <div className="text-center p-10 text-emerald-400">Loading Patient Records...</div>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex justify-between items-center border-b border-gray-800 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-emerald-400">Thyroid Titration Workspace</h1>
                    <p className="text-xs text-gray-400 font-mono">User: {userEmail}</p>
                </div>
                <button
                    onClick={async () => {
                        await supabase.auth.signOut()
                        router.push('/login')
                    }}
                    className="bg-gray-800 hover:bg-gray-700 text-xs text-red-400 border border-gray-700 px-3 py-1.5 rounded transition"
                >
                    Sign Out
                </button>
            </div>

            <div className="flex border-b border-gray-800 gap-2">
                <button
                    onClick={() => setActiveTab('profile')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition ${activeTab === 'profile' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    1. Patient Baseline
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition ${activeTab === 'history' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    2. Lab & Weight Log ({history.length})
                </button>
                <button
                    onClick={() => setActiveTab('calculator')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition ${activeTab === 'calculator' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    3. Bayesian Engine ({savedRuns.length})
                </button>
            </div>

            {activeTab === 'profile' && (
                <div className="border border-gray-800 bg-gray-900 rounded-xl p-6 space-y-5">
                    <h2 className="text-lg font-semibold text-emerald-300">Immutable Baseline Metrics</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Birth Year</label>
                            <input
                                type="number"
                                value={patient.birthYear}
                                onChange={(e) => setPatient({ ...patient, birthYear: parseInt(e.target.value) || 1990 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Biological Sex</label>
                            <select
                                value={patient.sex}
                                onChange={(e) => setPatient({ ...patient, sex: e.target.value as 'male' | 'female' })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                            >
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Height (cm)</label>
                            <input
                                type="number"
                                value={patient.heightCm}
                                onChange={(e) => setPatient({ ...patient, heightCm: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Target TSH (mIU/L)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={patient.targetTsh}
                                onChange={(e) => setPatient({ ...patient, targetTsh: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Thyroid Gland Status</label>
                            <select
                                value={patient.thyroidStatus}
                                onChange={(e) => setPatient({ ...patient, thyroidStatus: e.target.value as ThyroidStatus })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                            >
                                <option value="intact">Intact Gland</option>
                                <option value="partial_resection">Partial Resection / Subtotal</option>
                                <option value="total_thyroidectomy">Total Thyroidectomy / Ablated</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Hashimoto's Autoimmunity</label>
                            <select
                                value={patient.isHashimotos ? 'true' : 'false'}
                                onChange={(e) => setPatient({ ...patient, isHashimotos: e.target.value === 'true' })}
                                className="w-full bg-gray-950 border border-gray-800 rounded p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                            >
                                <option value="false">Negative / Unknown</option>
                                <option value="true">Confirmed Positive (Anti-TPO/TG)</option>
                            </select>
                        </div>
                    </div>
                    <button
                        onClick={handleSaveProfile}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-lg transition"
                    >
                        Save Baseline Metrics
                    </button>
                </div>
            )}

            {activeTab === 'history' && (
                <div className="space-y-6">
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-4">
                        <h2 className="text-lg font-semibold text-emerald-300">Log New Lab & Weight Observation</h2>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Date</label>
                                <input
                                    type="date"
                                    value={newEntry.date}
                                    onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Weight at Lab (kg)</label>
                                <input
                                    type="number"
                                    value={newEntry.weightKg}
                                    onChange={(e) => setNewEntry({ ...newEntry, weightKg: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Body Comp Method</label>
                                <select
                                    value={newEntry.lbmMethod}
                                    onChange={(e) => setNewEntry({ ...newEntry, lbmMethod: e.target.value as LbmMethod })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                >
                                    <option value="waist">Waist Circumference (cm)</option>
                                    <option value="dexa">DEXA Scan LBM (kg)</option>
                                </select>
                            </div>

                            {newEntry.lbmMethod === 'waist' ? (
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Waist (cm)</label>
                                    <input
                                        type="number"
                                        value={newEntry.waistCm}
                                        onChange={(e) => setNewEntry({ ...newEntry, waistCm: parseFloat(e.target.value) || 0 })}
                                        className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">DEXA Lean Mass (kg)</label>
                                    <input
                                        type="number"
                                        value={newEntry.dexaLbmKg}
                                        onChange={(e) => setNewEntry({ ...newEntry, dexaLbmKg: parseFloat(e.target.value) || 0 })}
                                        className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Daily Dose (mcg)</label>
                                <input
                                    type="number"
                                    value={newEntry.dailyDoseMcg}
                                    onChange={(e) => setNewEntry({ ...newEntry, dailyDoseMcg: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Measured TSH (mIU/L)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={newEntry.tshMeasured}
                                    onChange={(e) => setNewEntry({ ...newEntry, tshMeasured: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Free T4 (ng/dL)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={newEntry.freeT4 || ''}
                                    onChange={(e) => setNewEntry({ ...newEntry, freeT4: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Free T3 (pg/mL)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={newEntry.freeT3 || ''}
                                    onChange={(e) => setNewEntry({ ...newEntry, freeT3: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleAddRecord}
                            className="w-full bg-emerald-700 hover:bg-emerald-600 text-sm py-2.5 rounded transition text-white font-semibold cursor-pointer"
                        >
                            + Record Observation
                        </button>
                    </div>

                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-3">
                        <h2 className="text-lg font-semibold text-emerald-300">Longitudinal Lab History</h2>
                        {history.length === 0 ? (
                            <p className="text-xs text-gray-500">No saved observations found in database.</p>
                        ) : (
                            <div className="space-y-2">
                                {history.map((record) => (
                                    <div key={record.id} className="flex justify-between items-center bg-gray-950 p-3 rounded border border-gray-800 text-sm">
                                        <div>
                                            <span className="text-gray-400 text-xs mr-3">{record.date}</span>
                                            <strong className="text-white">{record.weightKg} kg</strong>
                                            <span className="text-gray-500 mx-2">|</span>
                                            {record.lbmMethod === 'dexa' ? `DEXA LBM: ${record.dexaLbmKg} kg` : `Waist: ${record.waistCm} cm`}
                                            <span className="text-gray-500 mx-2">|</span>
                                            Dose: <strong className="text-white">{record.dailyDoseMcg} mcg</strong>
                                            <span className="text-gray-500 mx-2">|</span>
                                            TSH: <strong className="text-emerald-400">{record.tshMeasured} mIU/L</strong>
                                            {record.freeT4 ? <span className="text-gray-400 ml-2">| FT4: {record.freeT4}</span> : null}
                                            {record.freeT3 ? <span className="text-gray-400 ml-2">| FT3: {record.freeT3}</span> : null}
                                        </div>
                                        <button
                                            onClick={() => handleRemoveRecord(record.id)}
                                            className="text-xs text-red-400 hover:text-red-300 ml-4"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'calculator' && (
                <div className="space-y-6">
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6 space-y-4">
                        <h2 className="text-lg font-semibold text-emerald-300">Bayesian MAP Solver Workspace</h2>
                        <button
                            onClick={handleRunCalculator}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition shadow-lg cursor-pointer"
                        >
                            Run Titration Optimization
                        </button>

                        {errorMsg && (
                            <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded">
                                {errorMsg}
                            </div>
                        )}
                    </div>

                    {result && (
                        <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-6 space-y-5">
                            <div className="flex justify-between items-start">
                                <h2 className="text-xl font-bold text-emerald-400">Latest Optimization Result</h2>
                                <span className="text-xs bg-emerald-950 border border-emerald-800 text-emerald-300 px-2.5 py-1 rounded-full font-mono">
                                    {result.calculationNote}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                                <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                    <div className="text-xs text-gray-400">Recommended Dose</div>
                                    <div className="text-2xl font-extrabold text-emerald-400">{result.recommendedDoseMcg} mcg</div>
                                </div>
                                <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                    <div className="text-xs text-gray-400">Estimated LBM</div>
                                    <div className="text-xl font-bold text-white">{result.leanBodyMassKg} kg</div>
                                    <div className="text-[10px] text-gray-500">Latest Wt: {result.latestWeightKg} kg</div>
                                </div>
                                <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                    <div className="text-xs text-gray-400">Estimated Clearance</div>
                                    <div className="text-xl font-bold text-white">{result.individualClearance} L/day</div>
                                </div>
                                <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                    <div className="text-xs text-gray-400">Predicted TSH</div>
                                    <div className="text-xl font-bold text-white">{result.predictedTsh} mIU/L</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Saved Optimization History Table */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-3">
                        <h2 className="text-lg font-semibold text-emerald-300">Saved Optimization History</h2>
                        {savedRuns.length === 0 ? (
                            <p className="text-xs text-gray-500">No saved optimization runs found in database.</p>
                        ) : (
                            <div className="space-y-2">
                                {savedRuns.map((run) => (
                                    <div key={run.id} className="bg-gray-950 p-3 rounded border border-gray-800 text-xs flex justify-between items-center">
                                        <div>
                                            <span className="text-gray-500 mr-2">{new Date(run.createdAt).toLocaleString()}</span>
                                            Rec Dose: <strong className="text-emerald-400 text-sm">{run.recommendedDoseMcg} mcg</strong>
                                            <span className="text-gray-600 mx-2">|</span>
                                            LBM: <span className="text-gray-300">{run.estimatedLbmKg} kg</span>
                                            <span className="text-gray-600 mx-2">|</span>
                                            CL: <span className="text-gray-300">{run.estimatedClearance} L/d</span>
                                            <span className="text-gray-600 mx-2">|</span>
                                            Pred TSH: <span className="text-gray-300">{run.predictedTsh} mIU/L</span>
                                            <div className="text-[10px] text-gray-500 mt-1">{run.calculationNote}</div>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteRun(run.id)}
                                            className="text-xs text-red-400 hover:text-red-300 ml-3"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}