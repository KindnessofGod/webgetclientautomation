import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export interface MessageTemplateRow {
  id: string
  niche_id: string | null
  stage: string
  meta_template_name: string | null
  body: string
  variables: unknown
  active: boolean
  created_at: string
}

export function useMessageTemplates() {
  const [templates, setTemplates] = useState<MessageTemplateRow[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('message_templates').select('*').order('created_at', { ascending: false })
    if (data) setTemplates(data as MessageTemplateRow[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createTemplate(t: Omit<MessageTemplateRow, 'id' | 'created_at' | 'active' | 'variables'>) {
    await supabase.from('message_templates').insert({ ...t, variables: [] })
    await load()
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('message_templates').update({ active }).eq('id', id)
    await load()
  }

  return { templates, createTemplate, toggleActive, refresh: load }
}
