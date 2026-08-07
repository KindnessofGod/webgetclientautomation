import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { CampaignSetting } from './database.types'

export function useCampaignSettings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('campaign_settings').select('*')
    if (data) {
      const map: Record<string, unknown> = {}
      for (const row of data as CampaignSetting[]) map[row.key] = row.value
      setSettings(map)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function updateSetting(key: string, value: unknown) {
    await supabase.from('campaign_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key)
    await load()
  }

  return { settings, updateSetting, refresh: load }
}
