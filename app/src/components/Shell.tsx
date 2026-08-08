import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useHotLeadAlerts } from '../lib/useHotLeadAlerts'
import { usePendingFollowUps } from '../lib/usePendingFollowUps'
import { sendFollowUpDecision } from '../lib/sendFollowUpDecision'

const navItems = [
  { to: '/', label: 'Inbox', end: true },
  { to: '/leads', label: 'Leads' },
  { to: '/settings', label: 'Settings' },
]

export default function Shell() {
  const { alerts, dismiss } = useHotLeadAlerts()
  const { items: pendingFollowUps, remove: removePendingFollowUp } = usePendingFollowUps()
  const [decidingId, setDecidingId] = useState<string | null>(null)

  async function decide(id: string, decision: 'approve' | 'reject') {
    setDecidingId(id)
    const result = await sendFollowUpDecision({ pendingId: id, decision })
    setDecidingId(null)
    if (result.ok) {
      removePendingFollowUp(id)
    } else {
      alert(`Couldn't ${decision} follow-up: ${result.error}`)
    }
  }

  return (
    <div className="h-full flex flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2 shrink-0">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-sm">Ikan Group — Outreach Inbox</span>
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm ${isActive ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          Sign out
        </button>
      </header>

      {alerts.length > 0 && (
        <div className="shrink-0 space-y-1 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <span className="text-amber-300">
                🔥 Hot lead: <strong>{a.businessName ?? a.phone}</strong> said they&apos;re interested — take over now.
              </span>
              <div className="flex gap-3">
                <NavLink to={`/conversation/${a.conversationId}`} className="text-amber-200 underline text-xs">
                  Open chat
                </NavLink>
                <button onClick={() => dismiss(a.id)} className="text-amber-400/70 hover:text-amber-200 text-xs">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingFollowUps.length > 0 && (
        <div className="shrink-0 space-y-1 px-4 py-2 bg-sky-500/10 border-b border-sky-500/30">
          {pendingFollowUps.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span className="text-sky-300">
                📝 Follow-up ready: <strong>{p.businessName ?? p.phone}</strong> — {p.followUpStage.replace('_', ' ')}
              </span>
              <div className="flex gap-3 items-center">
                <NavLink to={`/conversation/${p.conversationId}`} className="text-sky-200 underline text-xs">
                  Open chat
                </NavLink>
                <button
                  disabled={decidingId === p.id}
                  onClick={() => decide(p.id, 'approve')}
                  className="text-emerald-300 hover:text-emerald-100 text-xs font-medium disabled:opacity-50"
                >
                  Approve &amp; send
                </button>
                <button
                  disabled={decidingId === p.id}
                  onClick={() => decide(p.id, 'reject')}
                  className="text-sky-400/70 hover:text-sky-200 text-xs disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  )
}
