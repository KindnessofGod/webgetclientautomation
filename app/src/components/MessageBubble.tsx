import type { Message } from '../lib/database.types'
import { clockTime } from '../lib/format'

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
        {message.message_type === 'document' && message.media_url ? (
          <a href={message.media_url} target="_blank" rel="noreferrer" className="underline text-sky-300">
            📎 {message.body || 'Document'}
          </a>
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
