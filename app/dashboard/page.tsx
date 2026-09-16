import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto border border-gray-800 bg-gray-900 rounded-xl p-6">
        <h1 className="text-2xl font-bold text-emerald-400 mb-2">Thyroid Engine Dashboard</h1>
        <p className="text-gray-400 mb-6">Authenticated as: <span className="text-emerald-300 font-mono">{user.email}</span></p>
        
        <div className="p-4 bg-gray-950 rounded border border-gray-800 text-sm text-gray-300">
          Auth verification successful. MAP optimization engine core coming next.
        </div>
      </div>
    </main>
  )
}
