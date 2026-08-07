import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    const fn = mode === 'sign_in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { error } = await fn
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    if (mode === 'sign_up') {
      setInfo('Account created. If email confirmation is enabled, check your inbox, then sign in.')
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-neutral-950 text-neutral-100 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Ikan Group — Outreach Inbox</h1>
        <p className="text-sm text-neutral-400 mb-6">Sign in to monitor and take over WhatsApp conversations.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-400">{info}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2 text-sm font-medium"
          >
            {mode === 'sign_in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button
          onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
          className="mt-4 text-xs text-neutral-400 hover:text-neutral-200 underline"
        >
          {mode === 'sign_in' ? 'First time here? Create the owner account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
