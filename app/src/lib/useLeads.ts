import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Lead } from './database.types'

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(500)
    if (data) {
      setLeads(data as Lead[])
      const c: Record<string, number> = {}
      for (const l of data as Lead[]) c[l.status] = (c[l.status] ?? 0) + 1
      setCounts(c)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { leads, counts, loading, refresh: load }
}
