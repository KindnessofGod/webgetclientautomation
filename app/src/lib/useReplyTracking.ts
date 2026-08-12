import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Lead } from './database.types'

export interface ReplyTrackingRow extends Lead {
  conversation_id: string | null
}

// Anyone with last_outbound_at set has been sent at least the first-touch
// message. last_inbound_at is updated by the inbound handler whenever they
// reply, so its presence/absence is enough to split "replied" vs "never replied".
export function useReplyTracking() {
  const [replied, setReplied] = useState<ReplyTrackingRow[]>([])
  const [noReply, setNoReply] = useState<ReplyTrackingRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: leads }, { data: conversations }] = await Promise.all([
      supabase
        .from('leads')
        .select('*')
        .not('last_outbound_at', 'is', null)
        .order('last_outbound_at', { ascending: false })
        .limit(1000),
      supabase.from('conversations').select('id, lead_id'),
    ])
    const convByLead = new Map((conversations ?? []).map((c) => [c.lead_id as string, c.id as string]))
    const rows: ReplyTrackingRow[] = ((leads ?? []) as Lead[]).map((l) => ({
      ...l,
      conversation_id: convByLead.get(l.id) ?? null,
    }))
    setReplied(rows.filter((r) => r.last_inbound_at))
    setNoReply(rows.filter((r) => !r.last_inbound_at))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('reply-tracking-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  return { replied, noReply, loading, refresh: load }
}
