import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMessages } from '../lib/useMessages'
import { useConversationDetail } from '../lib/useConversationDetail'
import { sendManualMessage } from '../lib/sendManualMessage'
import { supabase } from '../lib/supabaseClient'
import MessageBubble from './MessageBubble'
import { stageColor, stageLabel } from '../lib/format'

export default function ChatThread() {
  const { id } = useParams<{ id: string }>()
  const { messages } = useMessages(id)
  const { detail, setTakeover, setUnqualified } = useConversationDetail(id)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function onPickFile() {
    fileInputRef.current?.click()
  }

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !detail) return

    setSending(true)
    setSendError(null)
    setUploadProgress('Uploading…')
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `manual-sends/${detail.id}-${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('assets').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (uploadError) {
        setSendError(`Upload failed: ${uploadError.message}`)
        return
      }
      const { data: publicUrlData } = supabase.storage.from('assets').getPublicUrl(path)

      setUploadProgress('Sending…')
      if (!detail.human_takeover) {
        await setTakeover(true)
      }
      const result = await sendManualMessage({
        conversationId: detail.id,
        leadId: detail.lead_id,
        phoneE164: detail.phone_e164,
        body: file.name,
        mediaUrl: publicUrlData.publicUrl,
        caption: file.name,
        fileName: file.name,
      })
      if (!result.ok) {
        setSendError(result.error ?? 'Failed to send file')
      }
    } finally {
      setSending(false)
      setUploadProgress(null)
    }
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUnqualified(detail.stage !== 'unqualified')}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              detail.stage === 'unqualified'
                ? 'border-red-500 text-red-300 bg-red-500/10'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {detail.stage === 'unqualified' ? 'Unqualified — reactivate' : 'Mark unqualified'}
          </button>
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
        {uploadProgress && <p className="text-xs text-neutral-400 mb-1.5">{uploadProgress}</p>}
        {!detail.human_takeover && (
          <p className="text-xs text-amber-400/80 mb-1.5">
            AI is currently handling this chat. Sending will hand control to you.
          </p>
        )}
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" onChange={onFileSelected} className="hidden" />
          <button
            type="button"
            disabled={sending}
            onClick={onPickFile}
            title="Send a file (PDF, image, etc.)"
            className="rounded-md border border-neutral-700 hover:border-neutral-500 disabled:opacity-50 px-3 py-2 text-sm"
          >
            📎
          </button>
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
