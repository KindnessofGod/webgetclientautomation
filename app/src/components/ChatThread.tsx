import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMessages } from '../lib/useMessages'
import { useConversationDetail } from '../lib/useConversationDetail'
import { sendManualMessage } from '../lib/sendManualMessage'
import MessageBubble from './MessageBubble'
import { stageColor, stageLabel } from '../lib/format'

export default function ChatThread() {
  const { id } = useParams<{ id: string }>()
  const { messages } = useMessages(id)
  const { detail, setTakeover } = useConversationDetail(id)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (!id) {
    return <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">Select a conversation</div>
  }
  if (!detail) {
    return <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">Loading…</div>
  }

  async function onSend(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim() || !detail) return
    setSending(true)
    setSendError(null)
    if (!detail.human_takeover) {
      await setTakeover(true)
    }
    const result = await sendManualMessage({
      conversationId: detail.id,
      leadId: detail.lead_id,
      phoneE164: detail.phone_e164,
      body: draft.trim(),
    })
    setSending(false)
    if (!result.ok) {
      setSendError(result.error ?? 'Failed to send')
      return
    }
    setDraft('')
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="border-b border-neutral-800 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div>
          <p className="text-sm font-medium">{detail.business_name || detail.phone_e164}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stageColor(detail.stage)}`}>{stageLabel(detail.stage)}</span>
            <span className="text-xs text-neutral-500">{detail.phone_e164}</span>
            {detail.niche_name && <span className="text-xs text-neutral-500">· {detail.niche_name}</span>}
          </div>
        </div>
        <button
          onClick={() => setTakeover(!detail.human_takeover)}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            detail.human_takeover
              ? 'border-sky-500 text-sky-300 bg-sky-500/10'
              : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
          }`}
        >
          {detail.human_takeover ? 'You are in control — hand back to AI' : 'Take over this chat'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && <p className="text-sm text-neutral-500">No messages yet.</p>}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSend} className="border-t border-neutral-800 p-3 shrink-0">
        {sendError && <p className="text-xs text-red-400 mb-1.5">{sendError}</p>}
        {!detail.human_takeover && (
          <p className="text-xs text-amber-400/80 mb-1.5">
            AI is currently handling this chat. Sending will hand control to you.
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
