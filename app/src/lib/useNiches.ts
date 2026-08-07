import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Niche } from './database.types'

export function useNiches() {
  const [niches, setNiches] = useState<Niche[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('niches').select('*').order('name')
    if (data) setNiches(data as Niche[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createNiche(name: string): Promise<Niche | null> {
    const { data, error } = await supabase.from('niches').insert({ name }).select().single()
    if (error) {
      // likely a duplicate name — just reuse the existing one
      const { data: existing } = await supabase.from('niches').select('*').eq('name', name).maybeSingle()
      if (existing) return existing as Niche
      return null
    }
    await load()
    return data as Niche
  }

  return { niches, createNiche, refresh: load }
}
