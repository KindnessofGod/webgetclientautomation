import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export interface ConversationSummary {
  id: string
  lead_id: string
  stage: string
  ai_enabled: boolean
  human_takeover: boolean
  assigned_to: string | null
  updated_at: string
  business_name: string | null
  phone_e164: string
  niche_id: string | null
  niche_name: string | null
  lead_status: string
  last_message_body: string | null
  last_message_direction: 'inbound' | 'outbound' | null
  last_message_at: string | null
  last_inbound_at: string | null
}

export function useConversationList() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    // Ongoing conversations (someone has actually replied) are sorted to the
    // top by their last reply time; leads that only ever got the cold
    // first-touch outbound sort below, by send time. Otherwise a big batch
    // send buries real replies under a flood of fresh, untouched outreach.
    const { data, error } = await supabase
      .from('conversation_list')
      .select('*')
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .order('last_message_at', { ascending: false })
      .limit(500)
    if (!error && data) setConversations(data as unknown as ConversationSummary[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('conversation-list-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { conversations, loading, refresh: load }
}
