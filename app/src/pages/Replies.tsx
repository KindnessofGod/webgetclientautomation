import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useReplyTracking, type ReplyTrackingRow } from '../lib/useReplyTracking'

function fmt(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function ReplyTable({ rows, showReplied }: { rows: ReplyTrackingRow[]; showReplied: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500 py-6">Nothing here yet.</p>
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-500 border-b border-neutral-800">
          <th className="py-1.5 pr-3">Business</th>
          <th className="py-1.5 pr-3">Phone</th>
          <th className="py-1.5 pr-3">Status</th>
          <th className="py-1.5 pr-3">First-touch sent</th>
          {showReplied && <th className="py-1.5 pr-3">Last reply</th>}
          <th className="py-1.5 pr-3" />
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 200).map((r) => (
          <tr key={r.id} className="border-b border-neutral-900">
            <td className="py-1.5 pr-3">{r.business_name || '—'}</td>
            <td className="py-1.5 pr-3 text-neutral-400">{r.phone_e164}</td>
            <td className="py-1.5 pr-3">{r.status}</td>
            <td className="py-1.5 pr-3 text-neutral-500">{fmt(r.last_outbound_at)}</td>
            {showReplied && <td className="py-1.5 pr-3 text-neutral-500">{fmt(r.last_inbound_at)}</td>}
            <td className="py-1.5 pr-3">
              {r.conversation_id && (
                <NavLink to={`/conversation/${r.conversation_id}`} className="text-emerald-400 hover:text-emerald-300 text-xs underline">
                  Open chat
                </NavLink>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Replies() {
  const { replied, noReply, loading } = useReplyTracking()
  const [tab, setTab] = useState<'noReply' | 'replied'>('noReply')

  const tabs: { key: 'noReply' | 'replied'; label: string; count: number }[] = [
    { key: 'noReply', label: 'Never replied', count: noReply.length },
    { key: 'replied', label: 'Replied', count: replied.length },
  ]

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Replies</h1>
        {!loading && (
          <span className="text-xs text-neutral-500">
            {replied.length + noReply.length} sent · {replied.length} replied · {noReply.length} silent
          </span>
        )}
      </div>

      <div className="flex gap-1 mb-3 border-b border-neutral-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-t-md ${
              tab === t.key ? 'bg-neutral-900 text-white border border-b-0 border-neutral-800' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t.label} <span className="text-neutral-500">({t.count})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : tab === 'noReply' ? (
        <ReplyTable rows={noReply} showReplied={false} />
      ) : (
        <ReplyTable rows={replied} showReplied={true} />
      )}
    </div>
  )
}
