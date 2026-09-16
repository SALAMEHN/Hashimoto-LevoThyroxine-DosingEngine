'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { calculateMapDose } from '@/lib/engine/solver'
import { PatientProfile, LabRecord, EstimationResult, OptimizationRun, ThyroidStatus, LbmMethod } from '@/lib/engine/types'

export default function DashboardClient({ userEmail }: { userEmail: string }) {
    const router = useRouter()
    const supabase = createClient()

    // Navigation and loading states
    const [activeTab, setActiveTab] = useState<'profile' | 'history' | 'calculator' | 'manual'>('profile')
    const [loading, setLoading] = useState(true)

    // Patient baseline configuration state
    const [patient, setPatient] = useState<PatientProfile>({
        birthYear: 1990,
        heightCm: 180,
        sex: 'male',
        targetTsh: 1.5,
        thyroidStatus: 'intact',
        isHashimotos: false,
    })

    // Longitudinal lab records and optimization runs history
    const [history, setHistory] = useState<(LabRecord & { antiTpo?: number; antiTg?: number })[]>([])
    const [savedRuns, setSavedRuns] = useState<OptimizationRun[]>([])
    const [lastCalculatedSnapshot, setLastCalculatedSnapshot] = useState<string>('')

    // Form state for adding/editing a lab observation
    const [newEntry, setNewEntry] = useState({
        date: new Date().toISOString().split('T')[0],
        weightKg: 110,
        lbmMethod: 'waist' as LbmMethod,
        waistCm: 100,
        dexaLbmKg: 75,
        dailyDoseMcg: 0,
        tshMeasured: 5.2,
        freeT4: 1.1,
        freeT3: 4.2,
        antiTpo: 0,
        antiTg: 0,
    })

    // Calculation output state and error banners
    const [result, setResult] = useState<EstimationResult | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const currentSnapshot = JSON.stringify({ patient, history })
    const isUpToDate = savedRuns.length > 0 && lastCalculatedSnapshot === currentSnapshot
    const existingRecordForDate = history.find((r) => r.date === newEntry.date)

    // Initial data hydration from Supabase on mount
    useEffect(() => {
        const fetchData = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Load patient profile baseline
            const { data: profileData } = await supabase
                .from('patient_profiles')
                .select('*')
                .eq('user_id', user.id)
                .single()

            let loadedPatient = patient
            if (profileData) {
                loadedPatient = {
                    birthYear: profileData.birth_year,
                    heightCm: profileData.height_cm,
                    sex: profileData.sex as 'male' | 'female',
                    targetTsh: profileData.target_tsh,
                    thyroidStatus: profileData.thyroid_status as ThyroidStatus,
                    isHashimotos: profileData.is_hashimotos,
                }
                setPatient(loadedPatient)
            }

            // Load longitudinal lab records
            const { data: labData } = await supabase
                .from('lab_records')
                .select('*')
                .eq('user_id', user.id)
                .order('date', { ascending: true })

            let loadedHistory: (LabRecord & { antiTpo?: number; antiTg?: number })[] = []
            if (labData) {
                loadedHistory = labData.map((r) => ({
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
                    antiTpo: r.anti_tpo || 0,
                    antiTg: r.anti_tg || 0,
                }))
                setHistory(loadedHistory)
            }

            // Load saved optimization runs
            const { data: runsData } = await supabase
                .from('optimization_runs')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })

            if (runsData) {
                const loadedRuns = runsData.map((r) => ({
                    id: r.id,
                    createdAt: r.created_at,
                    recommendedDoseMcg: r.recommended_dose_mcg,
                    estimatedLbmKg: r.estimated_lbm_kg,
                    estimatedClearance: r.estimated_clearance,
                    predictedTsh: r.predicted_tsh,
                    calculationNote: r.calculation_note,
                }))
                setSavedRuns(loadedRuns)

                if (loadedRuns.length > 0) {
                    setLastCalculatedSnapshot(JSON.stringify({ patient: loadedPatient, history: loadedHistory }))
                }
            }

            setLoading(false)
        }

        fetchData()
    }, [])

    // Handler: Save or update patient baseline profile metrics
    const handleSaveProfile = async () => {
        setErrorMsg(null)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { error } = await supabase.from('patient_profiles').upsert({
            user_id: user.id,
            birth_year: patient.birthYear,
            height_cm: patient.heightCm,
            sex: patient.sex,
            target_tsh: patient.targetTsh,
            thyroid_status: patient.thyroidStatus,
            is_hashimotos: patient.isHashimotos,
            updated_at: new Date().toISOString(),
        })

        if (error) {
            setErrorMsg(`Failed to save profile: ${error.message}`)
            return
        }

        alert('Baseline metrics saved successfully!')
    }

    // Handler: Insert or update lab observation record with explicit error catching
    const handleSaveRecord = async () => {
        setErrorMsg(null)

        // 1. Verify active user session
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            setErrorMsg('Authentication error: User session not found. Please sign in again.')
            return
        }

        // 2. Format payload: Nullify unused body comp fields based on selected method
        const recordPayload = {
            user_id: user.id,
            date: newEntry.date,
            weight_kg: Number(newEntry.weightKg),
            lbm_method: newEntry.lbmMethod,
            waist_cm: newEntry.lbmMethod === 'waist' ? Number(newEntry.waistCm) || null : null,
            dexa_lbm_kg: newEntry.lbmMethod === 'dexa' ? Number(newEntry.dexaLbmKg) || null : null,
            daily_dose_mcg: Number(newEntry.dailyDoseMcg),
            tsh_measured: Number(newEntry.tshMeasured),
            free_t4: newEntry.freeT4 ? Number(newEntry.freeT4) : null,
            free_t3: newEntry.freeT3 ? Number(newEntry.freeT3) : null,
            anti_tpo: newEntry.antiTpo ? Number(newEntry.antiTpo) : null,
            anti_tg: newEntry.antiTg ? Number(newEntry.antiTg) : null,
        }

        try {
            if (existingRecordForDate) {
                // 3a. Update existing database record matching the selected date
                const { data, error } = await supabase
                    .from('lab_records')
                    .update(recordPayload)
                    .eq('id', existingRecordForDate.id)
                    .select()
                    .single()

                if (error) throw error

                if (data) {
                    setHistory(
                        history.map((r) =>
                            r.id === existingRecordForDate.id
                                ? {
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
                                    antiTpo: data.anti_tpo || 0,
                                    antiTg: data.anti_tg || 0,
                                }
                                : r
                        )
                    )
                }

                // Delete stale optimization run for this date since lab data changed
                const staleRun = savedRuns.find((run) =>
                    run.calculationNote.includes(`[Log Date: ${existingRecordForDate.date}]`)
                )
                if (staleRun) {
                    await supabase.from('optimization_runs').delete().eq('id', staleRun.id)
                    setSavedRuns(savedRuns.filter((r) => r.id !== staleRun.id))
                    setLastCalculatedSnapshot('')
                }
            } else {
                // 3b. Insert new record into database
                const { data, error } = await supabase
                    .from('lab_records')
                    .insert(recordPayload)
                    .select()
                    .single()

                if (error) throw error

                if (data) {
                    const updated = [
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
                            antiTpo: data.anti_tpo || 0,
                            antiTg: data.anti_tg || 0,
                        },
                    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

                    setHistory(updated)
                }
            }

            // 4. Reset form inputs back to defaults after successful save
            setNewEntry({
                date: new Date().toISOString().split('T')[0],
                weightKg: 110,
                lbmMethod: 'waist',
                waistCm: 100,
                dexaLbmKg: 75,
                dailyDoseMcg: 0,
                tshMeasured: 5.2,
                freeT4: 0,
                freeT3: 0,
                antiTpo: 0,
                antiTg: 0,
            })
        } catch (err: any) {
            console.error('Supabase write error:', err)
            setErrorMsg(`Database save failed: ${err.message || err.details || 'Unknown database error'}`)
        }
    }

    // Handler: Load existing record into input form for editing
    const handleEditRecordClick = (record: LabRecord & { antiTpo?: number; antiTg?: number }) => {
        setNewEntry({
            date: record.date,
            weightKg: record.weightKg,
            lbmMethod: record.lbmMethod || 'waist',
            waistCm: record.waistCm || 100,
            dexaLbmKg: record.dexaLbmKg || 75,
            dailyDoseMcg: record.dailyDoseMcg,
            tshMeasured: record.tshMeasured,
            freeT4: record.freeT4 || 0,
            freeT3: record.freeT3 || 0,
            antiTpo: record.antiTpo || 0,
            antiTg: record.antiTg || 0,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    // Handler: Delete lab observation record and cascade-delete its linked optimization run
    const handleRemoveRecord = async (id: string) => {
        setErrorMsg(null)

        // Find the record before deletion to get its date for cascade lookup
        const recordToDelete = history.find((r) => r.id === id)

        const { error } = await supabase.from('lab_records').delete().eq('id', id)
        if (error) {
            setErrorMsg(`Failed to delete record: ${error.message}`)
            return
        }
        setHistory(history.filter((r) => r.id !== id))

        // Cascade: delete the optimization run linked to this lab record's date
        if (recordToDelete) {
            const associatedRun = savedRuns.find((run) =>
                run.calculationNote.includes(`[Log Date: ${recordToDelete.date}]`)
            )
            if (associatedRun) {
                await supabase.from('optimization_runs').delete().eq('id', associatedRun.id)
                const updatedRuns = savedRuns.filter((r) => r.id !== associatedRun.id)
                setSavedRuns(updatedRuns)
                if (updatedRuns.length === 0) {
                    setLastCalculatedSnapshot('')
                }
            }
        }
    }

    // Handler: Execute Bayesian MAP solver optimization run
    const handleRunCalculator = async () => {
        if (history.length === 0) {
            setErrorMsg('No lab records available to calculate titration.')
            return
        }

        setErrorMsg(null)
        try {
            const res = calculateMapDose(patient, history)
            setResult(res)

            const latestLogDate = history[history.length - 1].date
            const noteWithDate = `[Log Date: ${latestLogDate}] ${res.calculationNote}`

            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const existingRunForDate = savedRuns.find((run) =>
                    run.calculationNote.includes(`[Log Date: ${latestLogDate}]`)
                )

                const runPayload = {
                    user_id: user.id,
                    recommended_dose_mcg: res.recommendedDoseMcg,
                    estimated_lbm_kg: res.leanBodyMassKg,
                    estimated_clearance: res.individualClearance,
                    predicted_tsh: res.predictedTsh,
                    calculation_note: noteWithDate,
                    created_at: new Date().toISOString(),
                }

                if (existingRunForDate) {
                    const { data: updatedRun, error: updateError } = await supabase
                        .from('optimization_runs')
                        .update(runPayload)
                        .eq('id', existingRunForDate.id)
                        .select()
                        .single()

                    if (updateError) throw updateError

                    if (updatedRun) {
                        setSavedRuns(
                            savedRuns.map((r) =>
                                r.id === existingRunForDate.id
                                    ? {
                                        id: updatedRun.id,
                                        createdAt: updatedRun.created_at,
                                        recommendedDoseMcg: updatedRun.recommended_dose_mcg,
                                        estimatedLbmKg: updatedRun.estimated_lbm_kg,
                                        estimatedClearance: updatedRun.estimated_clearance,
                                        predictedTsh: updatedRun.predicted_tsh,
                                        calculationNote: updatedRun.calculation_note,
                                    }
                                    : r
                            )
                        )
                    }
                } else {
                    const { data: newRun, error: insertError } = await supabase
                        .from('optimization_runs')
                        .insert(runPayload)
                        .select()
                        .single()

                    if (insertError) throw insertError

                    if (newRun) {
                        setSavedRuns([
                            {
                                id: newRun.id,
                                createdAt: newRun.created_at,
                                recommendedDoseMcg: newRun.recommended_dose_mcg,
                                estimatedLbmKg: newRun.estimated_lbm_kg,
                                estimatedClearance: newRun.estimated_clearance,
                                predictedTsh: newRun.predicted_tsh,
                                calculationNote: newRun.calculation_note,
                            },
                            ...savedRuns,
                        ])
                    }
                }
                setLastCalculatedSnapshot(currentSnapshot)
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Calculation error.')
        }
    }

    // Handler: Delete saved optimization run
    const handleDeleteRun = async (id: string) => {
        const { error } = await supabase.from('optimization_runs').delete().eq('id', id)
        if (error) {
            setErrorMsg(`Failed to delete run: ${error.message}`)
            return
        }

        const updatedRuns = savedRuns.filter((r) => r.id !== id)
        setSavedRuns(updatedRuns)
        if (updatedRuns.length === 0) {
            setLastCalculatedSnapshot('')
        }
    }

    if (loading) {
        return <div className="text-center p-10 text-emerald-400 font-mono">Loading Workspace & Patient Profile...</div>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
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
                    className="bg-gray-800 hover:bg-gray-700 text-xs text-red-400 border border-gray-700 px-3 py-1.5 rounded transition cursor-pointer"
                >
                    Sign Out
                </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-gray-800 gap-2">
                <button
                    onClick={() => setActiveTab('profile')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition cursor-pointer ${activeTab === 'profile' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    1. Patient Baseline
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition cursor-pointer ${activeTab === 'history' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    2. Lab & Weight Log ({history.length})
                </button>
                <button
                    onClick={() => setActiveTab('calculator')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition cursor-pointer ${activeTab === 'calculator' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    3. Bayesian Engine ({savedRuns.length})
                </button>
                <button
                    onClick={() => setActiveTab('manual')}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition cursor-pointer ${activeTab === 'manual' ? 'bg-gray-900 text-emerald-400 border-t border-x border-gray-800' : 'text-gray-400'
                        }`}
                >
                    4. How It Works
                </button>
            </div>

            {/* Global Error Message Banner */}
            {errorMsg && (
                <div className="p-3 bg-red-950/90 border border-red-800 text-red-200 text-xs rounded font-mono flex justify-between items-center">
                    <span>❌ {errorMsg}</span>
                    <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-200 font-bold ml-2">✕</button>
                </div>
            )}

            {/* Tab 1: Patient Baseline */}
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
                            <label className="block text-xs text-gray-400 mb-1">Target TSH (uIU/mL)</label>
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
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-lg transition cursor-pointer"
                    >
                        Save Baseline Metrics
                    </button>
                </div>
            )}

            {/* Tab 2: Lab & Weight Log */}
            {activeTab === 'history' && (
                <div className="space-y-6">
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-5 space-y-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-lg font-semibold text-emerald-300">
                                {existingRecordForDate ? 'Edit Observation for Date' : 'Log New Lab & Weight Observation'}
                            </h2>
                            {existingRecordForDate && (
                                <span className="text-xs bg-amber-950 border border-amber-800 text-amber-300 px-2 py-0.5 rounded font-mono">
                                    Overwriting Entry for {newEntry.date}
                                </span>
                            )}
                        </div>

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
                                <label className="block text-xs text-gray-400 mb-1">Measured TSH (uIU/mL)</label>
                                <input
                                    type="number"
                                    step="0.01"
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
                                <label className="block text-xs text-gray-400 mb-1">Free T3 (pmol/L)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={newEntry.freeT3 || ''}
                                    onChange={(e) => setNewEntry({ ...newEntry, freeT3: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Anti-TPO (IU/mL)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={newEntry.antiTpo || ''}
                                    onChange={(e) => setNewEntry({ ...newEntry, antiTpo: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Anti-TG (IU/mL)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={newEntry.antiTg || ''}
                                    onChange={(e) => setNewEntry({ ...newEntry, antiTg: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleSaveRecord}
                            className={`w-full text-sm py-2.5 rounded transition text-white font-semibold cursor-pointer ${existingRecordForDate ? 'bg-amber-700 hover:bg-amber-600' : 'bg-emerald-700 hover:bg-emerald-600'
                                }`}
                        >
                            {existingRecordForDate ? 'Update Existing Entry for Date' : '+ Record Observation'}
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
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-emerald-400 font-mono text-xs font-bold px-2 py-0.5 bg-emerald-950 border border-emerald-800 rounded">
                                                    {record.date}
                                                </span>
                                                <strong className="text-white">{record.weightKg} kg</strong>
                                                <span className="text-gray-600">|</span>
                                                <span className="text-gray-300">
                                                    {record.lbmMethod === 'dexa' ? `DEXA: ${record.dexaLbmKg} kg` : `Waist: ${record.waistCm} cm`}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 flex flex-wrap gap-x-2 gap-y-1">
                                                <span>Dose: <strong className="text-white">{record.dailyDoseMcg} mcg</strong></span>
                                                <span className="text-gray-600">|</span>
                                                <span>TSH: <strong className="text-emerald-300">{record.tshMeasured} uIU/mL</strong></span>
                                                {record.freeT4 ? <> <span className="text-gray-600">|</span> <span>FT4: {record.freeT4} ng/dL</span> </> : null}
                                                {record.freeT3 ? <> <span className="text-gray-600">|</span> <span>FT3: {record.freeT3} pmol/L</span> </> : null}
                                                {record.antiTpo ? <> <span className="text-gray-600">|</span> <span>Anti-TPO: {record.antiTpo} IU/mL</span> </> : null}
                                                {record.antiTg ? <> <span className="text-gray-600">|</span> <span>Anti-TG: {record.antiTg} IU/mL</span> </> : null}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 ml-4 shrink-0">
                                            <button
                                                onClick={() => handleEditRecordClick(record)}
                                                className="px-3 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded text-xs font-semibold transition cursor-pointer"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleRemoveRecord(record.id)}
                                                className="px-3 py-1 bg-red-950 hover:bg-red-900 text-red-300 border border-red-800/60 rounded text-xs font-semibold transition cursor-pointer"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab 3: Bayesian Engine */}
            {activeTab === 'calculator' && (
                <div className="space-y-6">
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6 space-y-4">
                        <h2 className="text-lg font-semibold text-emerald-300">Bayesian MAP Solver Workspace</h2>

                        <button
                            onClick={handleRunCalculator}
                            disabled={isUpToDate || history.length === 0}
                            className={`w-full font-bold py-3 rounded-xl transition shadow-lg ${isUpToDate || history.length === 0
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                                }`}
                        >
                            {isUpToDate ? 'Optimization Up To Date' : 'Run Titration Optimization'}
                        </button>
                    </div>

                    {result && (
                        <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-6 space-y-5">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-xl font-bold text-emerald-400">Latest Optimization Result</h2>
                                    <p className="text-xs text-emerald-300/80 font-mono mt-0.5">
                                        * Projected TSH represents expected steady-state 6–8 weeks post-titration.
                                    </p>
                                </div>
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
                                    <div className="text-xs text-gray-400">Predicted TSH (6-8 wks)</div>
                                    <div className="text-xl font-bold text-white">{result.predictedTsh} uIU/mL</div>
                                </div>
                            </div>

                            <div className="p-4 bg-gray-950 border border-gray-800 rounded-lg text-xs space-y-2 text-gray-300">
                                <strong className="text-emerald-300 block">Model Assumptions & Pharmacokinetic Notes:</strong>
                                <ul className="list-disc list-inside space-y-1 text-gray-400">
                                    <li><strong>Elimination Half-Life (t½):</strong> Levothyroxine requires ~6 to 8 weeks (4–5 elimination half-lives) to reach true thermodynamic steady-state.</li>
                                    <li><strong>LBM Scaling:</strong> Peripheral volume of distribution and metabolic clearance rate scale strictly to Lean Body Mass rather than total body weight.</li>
                                    <li><strong>Pituitary Axis:</strong> TSH feedback follows an inverse log-linear response relative to bioavailable steady-state T4.</li>
                                </ul>
                            </div>
                        </div>
                    )}

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
                                                Pred TSH (6-8wks): <span className="text-gray-300">{run.predictedTsh} uIU/mL</span>
                                                <div className="text-[10px] text-emerald-400/80 mt-1 font-mono">{run.calculationNote}</div>
                                            </div>

                                            <button
                                                onClick={() => handleDeleteRun(run.id)}
                                                className="text-xs text-red-400 hover:text-red-300 cursor-pointer shrink-0"
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
            {/* Tab 4: How It Works — Solver Manual */}
            {activeTab === 'manual' && (
                <div className="space-y-6 text-gray-300 text-sm leading-relaxed">
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h2 className="text-xl font-bold text-emerald-400 mb-4">How the Dosing Engine Works</h2>
                        <p className="text-gray-400 mb-4">
                            This tool uses a <strong className="text-white">mechanistic pharmacokinetic / pharmacodynamic (PK/PD) model</strong> combined with
                            <strong className="text-white"> Bayesian Maximum A Posteriori (MAP) estimation</strong> to recommend individualized levothyroxine doses.
                            Unlike simple weight-based rules, it learns your body&apos;s unique response to medication across each titration cycle.
                        </p>
                    </div>

                    {/* Section 1: The Two Core Equations */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-emerald-300 mb-3">1. Steady-State PK/PD Model</h3>
                        <p className="mb-3">
                            After ~6–8 weeks on a stable dose (4–5 elimination half-lives of T4), plasma concentrations reach a steady state.
                            At this equilibrium, the model uses two algebraic equations:
                        </p>

                        <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs space-y-3 border border-gray-800 mb-4">
                            <div>
                                <span className="text-emerald-400">Free T4 Equation:</span>
                                <div className="mt-1 text-gray-200">fT4<sub>ss</sub>(D) = α · (η · D + S<sub>end</sub>) / (k<sub>e</sub> · V<sub>d</sub>)&nbsp;&nbsp;&nbsp;[ng/dL]</div>
                            </div>
                            <div>
                                <span className="text-emerald-400">TSH Equation (Hill Function):</span>
                                <div className="mt-1 text-gray-200">TSH<sub>ss</sub>(fT4) = TSH<sub>max</sub> / (1 + (fT4 / EC<sub>50</sub>)<sup>γ</sup>)&nbsp;&nbsp;&nbsp;[mIU/L]</div>
                            </div>
                        </div>

                        <p className="text-gray-400 text-xs">
                            The first equation models how your administered dose (D) and residual thyroid gland output (S<sub>end</sub>) combine to produce
                            a circulating free T4 concentration. The second equation models how the pituitary gland reads that fT4 level and adjusts TSH secretion
                            via a sigmoidal (Hill) suppression curve.
                        </p>
                    </div>

                    {/* Section 2: Patient-Specific Parameters */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-emerald-300 mb-3">2. Patient-Specific Parameters (θ)</h3>
                        <p className="mb-3">The model estimates three unknown parameters unique to each patient:</p>

                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-gray-700">
                                    <th className="text-left py-2 px-3 text-emerald-400">Symbol</th>
                                    <th className="text-left py-2 px-3 text-emerald-400">Name</th>
                                    <th className="text-left py-2 px-3 text-emerald-400">Meaning</th>
                                    <th className="text-left py-2 px-3 text-emerald-400">Population Prior</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-300">
                                <tr className="border-b border-gray-800">
                                    <td className="py-2 px-3 font-mono">η</td>
                                    <td className="py-2 px-3">Absorption Efficiency</td>
                                    <td className="py-2 px-3 text-gray-400">Fraction of the oral dose that reaches systemic circulation</td>
                                    <td className="py-2 px-3 font-mono">0.80 (80%)</td>
                                </tr>
                                <tr className="border-b border-gray-800">
                                    <td className="py-2 px-3 font-mono">S<sub>end</sub></td>
                                    <td className="py-2 px-3">Endogenous T4 Production</td>
                                    <td className="py-2 px-3 text-gray-400">Residual daily T4 output from remaining thyroid tissue (mcg/day)</td>
                                    <td className="py-2 px-3 font-mono">
                                        Intact: 40 · Partial: 15 · Total thyroidectomy: 0
                                    </td>
                                </tr>
                                <tr>
                                    <td className="py-2 px-3 font-mono">k<sub>e</sub></td>
                                    <td className="py-2 px-3">Elimination Rate</td>
                                    <td className="py-2 px-3 text-gray-400">First-order rate constant for T4 clearance (day⁻¹). Reflects metabolism speed.</td>
                                    <td className="py-2 px-3 font-mono">0.10 (t½ ≈ 7 days)</td>
                                </tr>
                            </tbody>
                        </table>

                        <div className="mt-4 bg-gray-950 rounded-lg p-4 text-xs border border-gray-800">
                            <span className="text-emerald-400 font-semibold">Fixed Parameters:</span>
                            <ul className="mt-2 space-y-1 text-gray-400">
                                <li><strong className="text-gray-300">V<sub>d</sub></strong> = 0.16 L/kg × Lean Body Mass — distribution volume, computed directly from your LBM</li>
                                <li><strong className="text-gray-300">α</strong> = 0.014 — unit-conversion factor (free fraction × concentration units)</li>
                                <li><strong className="text-gray-300">TSH<sub>max</sub></strong> = 100 mIU/L — maximum pituitary TSH secretion capacity</li>
                                <li><strong className="text-gray-300">EC<sub>50</sub></strong> = 0.32 ng/dL — fT4 level at which TSH is 50% suppressed</li>
                                <li><strong className="text-gray-300">γ</strong> = 3 — Hill coefficient controlling the steepness of TSH suppression</li>
                            </ul>
                        </div>
                    </div>

                    {/* Section 3: Bayesian MAP Fitting */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-emerald-300 mb-3">3. Bayesian MAP Parameter Estimation</h3>
                        <p className="mb-3">
                            Given your N historical lab records (each with a dose D<sub>i</sub>, measured TSH, and optionally fT4),
                            the optimizer finds the θ = [η, S<sub>end</sub>, k<sub>e</sub>] that best explains all your data while staying
                            anchored to population-average priors.
                        </p>

                        <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs border border-gray-800 mb-4">
                            <span className="text-emerald-400">Cost Function (minimized):</span>
                            <div className="mt-2 text-gray-200">
                                J(θ) = Σ<sub>i</sub> [ w<sub>TSH</sub> · (TSH<sub>i</sub> − TSH&#770;<sub>i</sub>)² + w<sub>fT4</sub> · (fT4<sub>i</sub> − fT4&#770;<sub>i</sub>)² ] + λ · ‖θ − θ<sub>prior</sub>‖²
                            </div>
                        </div>

                        <ul className="space-y-2 text-xs text-gray-400">
                            <li>
                                <strong className="text-gray-300">Data Terms:</strong> The squared differences between your measured TSH/fT4
                                and what the model predicts at each historical dose. This forces the model to fit your actual lab results.
                            </li>
                            <li>
                                <strong className="text-gray-300">Regularization Term (λ · ‖θ − θ<sub>prior</sub>‖²):</strong> A penalty
                                that pulls parameters toward population averages. This prevents overfitting when you have few data points
                                (e.g., only 1 lab). As you add more labs, the data terms dominate and the model becomes increasingly personalized.
                            </li>
                            <li>
                                <strong className="text-gray-300">Weights:</strong> TSH residuals carry w<sub>TSH</sub> = 1.0 (primary marker),
                                fT4 residuals carry w<sub>fT4</sub> = 10.0 (supplementary, compensating for smaller absolute values in ng/dL).
                            </li>
                        </ul>

                        <div className="mt-4 p-3 bg-emerald-950/30 border border-emerald-800/50 rounded-lg text-xs">
                            <strong className="text-emerald-400">Why &quot;Bayesian&quot;?</strong>
                            <span className="text-gray-400 ml-1">
                                With 1 lab record, the system has 3 unknowns but only 1–2 data points. Pure curve-fitting would be underdetermined.
                                The Bayesian prior acts as a &quot;safety net&quot; — starting from population averages and adjusting only as far as the evidence justifies.
                                Each additional titration cycle provides more evidence, progressively personalizing the model.
                            </span>
                        </div>
                    </div>

                    {/* Section 4: Dose Inversion */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-emerald-300 mb-3">4. Optimal Dose Calculation</h3>
                        <p className="mb-3">
                            Once the optimizer has found your personalized θ̂, the recommended dose D* is solved analytically by inverting
                            the steady-state equations:
                        </p>

                        <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs border border-gray-800 mb-4">
                            <span className="text-emerald-400">Step 1 — Target fT4 from target TSH:</span>
                            <div className="mt-1 text-gray-200 ml-4">
                                fT4<sub>target</sub> = EC<sub>50</sub> · (TSH<sub>max</sub> / TSH<sub>target</sub> − 1)<sup>1/γ</sup>
                            </div>
                            <div className="mt-3">
                                <span className="text-emerald-400">Step 2 — Dose from target fT4:</span>
                                <div className="mt-1 text-gray-200 ml-4">
                                    D* = (k<sub>e</sub> · V<sub>d</sub> / α · fT4<sub>target</sub> − S<sub>end</sub>) / η
                                </div>
                            </div>
                        </div>

                        <ul className="space-y-2 text-xs text-gray-400">
                            <li>
                                <strong className="text-gray-300">Quantization:</strong> The raw dose D* is rounded to the nearest
                                available tablet strength (multiples of 12.5 mcg).
                            </li>
                            <li>
                                <strong className="text-gray-300">Safety Clamp:</strong> The final dose is clamped to the clinical range
                                of 25–300 mcg/day regardless of the computed value.
                            </li>
                        </ul>
                    </div>

                    {/* Section 5: Output Interpretation */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-emerald-300 mb-3">5. Understanding the Output</h3>

                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-gray-700">
                                    <th className="text-left py-2 px-3 text-emerald-400">Field</th>
                                    <th className="text-left py-2 px-3 text-emerald-400">What It Means</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-300">
                                <tr className="border-b border-gray-800">
                                    <td className="py-2 px-3 font-semibold">Recommended Dose</td>
                                    <td className="py-2 px-3 text-gray-400">The daily levothyroxine dose (mcg) predicted to bring your TSH to target at steady state.</td>
                                </tr>
                                <tr className="border-b border-gray-800">
                                    <td className="py-2 px-3 font-semibold">Estimated LBM</td>
                                    <td className="py-2 px-3 text-gray-400">Your lean body mass (kg), used to compute V<sub>d</sub>. Derived from DEXA, waist circumference formula, or 75% of total weight.</td>
                                </tr>
                                <tr className="border-b border-gray-800">
                                    <td className="py-2 px-3 font-semibold">Estimated Clearance</td>
                                    <td className="py-2 px-3 text-gray-400">Your individualized metabolic clearance rate (k<sub>e</sub> × V<sub>d</sub>, in L/day). Higher values mean faster T4 metabolism. Typical range: 0.5–2.0 L/day.</td>
                                </tr>
                                <tr className="border-b border-gray-800">
                                    <td className="py-2 px-3 font-semibold">Predicted TSH</td>
                                    <td className="py-2 px-3 text-gray-400">The model&apos;s forecast of your TSH 6–8 weeks after starting the recommended dose, assuming full compliance.</td>
                                </tr>
                                <tr>
                                    <td className="py-2 px-3 font-semibold">Objective Value</td>
                                    <td className="py-2 px-3 text-gray-400">The final value of J(θ̂). Lower = better fit. Values near 0 mean the model closely matches all your historical labs.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Section 6: Iterative Titration */}
                    <div className="border border-gray-800 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-emerald-300 mb-3">6. The Titration Loop</h3>
                        <p className="mb-3">The engine is designed for iterative use across multiple titration cycles:</p>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                            <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 text-center">
                                <div className="text-emerald-400 font-bold text-lg mb-1">①</div>
                                <strong className="text-gray-200">Baseline</strong>
                                <p className="text-gray-500 mt-1">Enter your first lab (TSH, weight, dose if any). Model uses population priors heavily.</p>
                            </div>
                            <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 text-center">
                                <div className="text-emerald-400 font-bold text-lg mb-1">②</div>
                                <strong className="text-gray-200">Follow-Up (6–8 wks)</strong>
                                <p className="text-gray-500 mt-1">Add your new lab after taking the recommended dose. Model now has 2 data points.</p>
                            </div>
                            <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 text-center">
                                <div className="text-emerald-400 font-bold text-lg mb-1">③</div>
                                <strong className="text-gray-200">Re-Optimize</strong>
                                <p className="text-gray-500 mt-1">Run the engine again. Parameters shift toward YOUR pharmacokinetics, away from averages.</p>
                            </div>
                            <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 text-center">
                                <div className="text-emerald-400 font-bold text-lg mb-1">④</div>
                                <strong className="text-gray-200">Converge</strong>
                                <p className="text-gray-500 mt-1">After 2–3 cycles the model is well-individualized. Dose adjustments become smaller.</p>
                            </div>
                        </div>
                    </div>

                    {/* Section 7: Limitations */}
                    <div className="border border-red-900/50 bg-gray-900 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-red-400 mb-3">⚠ Important Limitations</h3>
                        <ul className="space-y-2 text-xs text-gray-400">
                            <li>
                                <strong className="text-gray-300">Not Medical Advice:</strong> This tool is a computational aid, not a substitute for
                                clinical judgment. All dose changes should be reviewed and approved by your endocrinologist.
                            </li>
                            <li>
                                <strong className="text-gray-300">Steady-State Assumption:</strong> The model assumes you have been on a stable dose
                                for at least 6 weeks before each lab. Labs drawn during dose transitions will produce inaccurate fits.
                            </li>
                            <li>
                                <strong className="text-gray-300">Compliance:</strong> The model assumes 100% daily adherence to the prescribed dose.
                                Missed doses or irregular timing will skew results.
                            </li>
                            <li>
                                <strong className="text-gray-300">Drug Interactions:</strong> Medications and supplements that affect T4 absorption
                                (calcium, iron, PPIs, etc.) are not explicitly modeled. The optimizer may partially compensate via the η parameter,
                                but significant interactions should be flagged to your physician.
                            </li>
                            <li>
                                <strong className="text-gray-300">Antibodies:</strong> Anti-TPO and Anti-Tg values are stored for clinical reference
                                but do <strong>not</strong> currently enter the dose calculation.
                            </li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    )
}