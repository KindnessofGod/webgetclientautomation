import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { ConversationSummary } from '../lib/useConversationList'
import { timeAgo, stageColor, stageLabel } from '../lib/format'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'replied', label: 'Replied' },
  { key: 'hot_lead', label: 'Hot leads' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'handed_off', label: 'Handed off' },
]

export default function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const filtered = conversations.filter((c) => {
    if (filter === 'replied' && !c.last_inbound_at) return false
    if (filter === 'hot_lead' && c.stage !== 'hot_lead') return false
    if (filter === 'handed_off' && c.stage !== 'handed_off') return false
    if (filter === 'needs_reply' && !(c.last_message_direction === 'inbound' && !c.human_takeover)) return false
    if (query) {
      const q = query.toLowerCase()
      const hay = `${c.business_name ?? ''} ${c.phone_e164}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="w-80 shrink-0 border-r border-neutral-800 flex flex-col h-full">
      <div className="p-2 border-b border-neutral-800 space-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search business or phone"
          className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
        />
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs px-2 py-1 rounded-full border ${
                filter === f.key
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                  : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-sm text-neutral-500 p-4">No conversations yet. Import leads to get started.</p>
        )}
        {filtered.map((c) => (
          <NavLink
            key={c.id}
            to={`/conversation/${c.id}`}
            className={({ isActive }) =>
              `block px-3 py-2.5 border-b border-neutral-900 hover:bg-neutral-900 ${isActive ? 'bg-neutral-900' : ''}`
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{c.business_name || c.phone_e164}</span>
              <span className="text-[11px] text-neutral-500 shrink-0">{timeAgo(c.last_message_at)}</span>
            </div>
            <p className="text-xs text-neutral-500 truncate mt-0.5">
              {c.last_message_direction === 'outbound' ? 'You: ' : ''}
              {c.last_message_body || '—'}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stageColor(c.stage)}`}>{stageLabel(c.stage)}</span>
              {c.niche_name && <span className="text-[10px] text-neutral-500">{c.niche_name}</span>}
              {c.human_takeover && <span className="text-[10px] text-sky-400">you&apos;re in control</span>}
            </div>
          </NavLink>
        ))}
      </div>
    </div>
  )
}
