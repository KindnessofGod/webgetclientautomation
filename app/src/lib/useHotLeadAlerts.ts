import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export interface HotLeadAlert {
  id: string
  conversationId: string
  businessName: string | null
  phone: string
}

// Watches `events` for hot_lead rows in realtime and surfaces a dismissible
// banner + browser notification, since the owner won't see these in their
// normal WhatsApp app (the automation number can't be logged in there too).
export function useHotLeadAlerts() {
  const [alerts, setAlerts] = useState<HotLeadAlert[]>([])
  const notifiedRef = useRef(new Set<string>())

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const channel = supabase
      .channel('hot-lead-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: 'type=eq.hot_lead' },
        async (payload) => {
          const row = payload.new as { id: string; lead_id: string; conversation_id: string | null; payload: Record<string, unknown> }
          if (notifiedRef.current.has(row.id)) return
          notifiedRef.current.add(row.id)

          const { data: lead } = await supabase
            .from('leads')
            .select('business_name, phone_e164')
            .eq('id', row.lead_id)
            .single()

          const alert: HotLeadAlert = {
            id: row.id,
            conversationId: row.conversation_id ?? '',
            businessName: lead?.business_name ?? null,
            phone: lead?.phone_e164 ?? '',
          }
          setAlerts((prev) => [alert, ...prev])

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Hot lead 🔥', {
              body: `${alert.businessName ?? alert.phone} is interested — jump in now`,
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
    alerts,
    dismiss: (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)),
  }
}
