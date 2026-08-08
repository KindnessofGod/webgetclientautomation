import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export interface PendingFollowUp {
  id: string
  conversationId: string
  businessName: string | null
  phone: string
  followUpStage: string
}

// Watches `pending_follow_ups` for new rows in realtime and surfaces a
// dismissible review banner, since follow-ups must be approved by a human
// before anything actually sends (see WA Follow-Up Approval Handler).
export function usePendingFollowUps() {
  const [items, setItems] = useState<PendingFollowUp[]>([])
  const notifiedRef = useRef(new Set<string>())

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    async function loadExisting() {
      const { data } = await supabase
        .from('pending_follow_ups')
        .select('id, conversation_id, business_name, phone_e164, follow_up_stage')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (data) {
        setItems(
          data.map((row) => ({
            id: row.id,
            conversationId: row.conversation_id,
            businessName: row.business_name,
            phone: row.phone_e164,
            followUpStage: row.follow_up_stage,
          })),
        )
        for (const row of data) notifiedRef.current.add(row.id)
      }
    }
    loadExisting()

    const channel = supabase
      .channel('pending-follow-ups')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pending_follow_ups' },
        (payload) => {
          const row = payload.new as { id: string; conversation_id: string; business_name: string | null; phone_e164: string; follow_up_stage: string; status: string }
          if (row.status !== 'pending' || notifiedRef.current.has(row.id)) return
          notifiedRef.current.add(row.id)

          const item: PendingFollowUp = {
            id: row.id,
            conversationId: row.conversation_id,
            businessName: row.business_name,
            phone: row.phone_e164,
            followUpStage: row.follow_up_stage,
          }
          setItems((prev) => [item, ...prev])

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Follow-up ready for review 📝', {
              body: `${item.businessName ?? item.phone} — ${item.followUpStage.replace('_', ' ')} needs your approval`,
            })
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return {
    items,
    remove: (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
  }
}
