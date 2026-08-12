import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { ConversationSummary } from './useConversationList'

export function useConversationDetail(conversationId: string | undefined) {
  const [detail, setDetail] = useState<ConversationSummary | null>(null)

  async function load() {
    if (!conversationId) return
    const { data } = await supabase.from('conversation_list').select('*').eq('id', conversationId).single()
    setDetail(data as unknown as ConversationSummary)
  }

  useEffect(() => {
    load()
    if (!conversationId) return
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  async function setTakeover(takeover: boolean) {
    if (!conversationId) return
    await supabase.from('conversations').update({ human_takeover: takeover, ai_enabled: !takeover }).eq('id', conversationId)
  }

  async function setUnqualified(unqualified: boolean) {
    if (!conversationId) return
    await supabase
      .from('conversations')
      .update(
        unqualified
          ? { stage: 'unqualified', ai_enabled: false }
          : { stage: 'awaiting_confirmation', ai_enabled: !detail?.human_takeover },
      )
      .eq('id', conversationId)
  }

  return { detail, setTakeover, setUnqualified, refresh: load }
}
