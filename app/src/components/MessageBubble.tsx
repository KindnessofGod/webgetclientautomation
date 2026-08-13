import type { Message } from '../lib/database.types'
import { clockTime } from '../lib/format'

// Inbound documents store "[Document: filename] <extracted text>" in body — split
// the bracketed label from the (potentially very long) extracted text so the
// bubble shows a short link plus a clamped preview instead of a wall of text.
function splitDocumentBody(body: string | null): { label: string; preview: string } {
  const match = body?.match(/^\[Document: ([^\]]*)\]\s*(.*)$/s)
  if (match) return { label: match[1] || 'Document', preview: match[2] }
  return { label: body || 'Document', preview: '' }
}

export default function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === 'outbound'
  const senderLabel = message.sent_by === 'ai' ? 'AI' : message.sent_by === 'human' ? 'You' : null

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isOut ? 'bg-emerald-700/40 text-emerald-50' : 'bg-neutral-800 text-neutral-100'
        }`}
      >
        {message.message_type === 'image' && message.media_url ? (
          <a href={message.media_url} target="_blank" rel="noreferrer">
            <img
              src={message.media_url}
              alt={message.body || 'Image'}
              loading="lazy"
              className="max-w-full max-h-72 rounded-md"
            />
          </a>
        ) : message.message_type === 'video' && message.media_url ? (
          <video controls preload="metadata" className="max-w-full max-h-72 rounded-md">
            <source src={message.media_url} />
          </video>
        ) : message.message_type === 'audio' && message.media_url ? (
          <div className="min-w-[240px]">
            <audio controls preload="metadata" className="w-full h-10">
              <source src={message.media_url} />
            </audio>
            {message.body && <p className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{message.body}</p>}
          </div>
        ) : message.message_type === 'document' && message.media_url ? (
          <div>
            <a href={message.media_url} target="_blank" rel="noreferrer" className="underline text-sky-300">
              📎 {splitDocumentBody(message.body).label}
            </a>
            {splitDocumentBody(message.body).preview && (
              <p className="text-xs opacity-70 mt-1 whitespace-pre-wrap line-clamp-4">
                {splitDocumentBody(message.body).preview}
              </p>
            )}
          </div>
        ) : (
          <p>{message.body}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1 justify-end">
          {senderLabel && (
            <span
              className={`text-[10px] px-1 rounded font-medium ${
                message.sent_by === 'human' ? 'bg-sky-500/20 text-sky-300' : 'bg-neutral-600/30 text-neutral-300'
              }`}
            >
              {senderLabel}
            </span>
          )}
          <span className="text-[10px] opacity-50">{clockTime(message.created_at)}</span>
          {isOut && message.status === 'failed' && <span className="text-[10px] text-red-400">failed</span>}
          {isOut && message.status === 'read' && <span className="text-[10px] text-sky-300">✓✓</span>}
          {isOut && message.status === 'delivered' && <span className="text-[10px] opacity-50">✓✓</span>}
          {isOut && message.status === 'sent' && <span className="text-[10px] opacity-50">✓</span>}
        </div>
      </div>
    </div>
  )
}
