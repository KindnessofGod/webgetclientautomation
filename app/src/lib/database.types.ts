export type LeadStatus =
  | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'replied'
  | 'interested' | 'not_interested' | 'hot_lead' | 'handed_off'
  | 'opted_out' | 'not_on_whatsapp' | 'failed' | 'paused'

export type ConversationStage =
  | 'new' | 'awaiting_confirmation' | 'confirmed_business' | 'pitched'
  | 'awaiting_interest' | 'interested' | 'not_interested' | 'hot_lead'
  | 'handed_off' | 'closed'

export interface Niche {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface Lead {
  id: string
  business_name: string | null
  phone_e164: string
  niche_id: string | null
  source: string | null
  raw_row: Record<string, unknown> | null
  whatsapp_status: 'unknown' | 'confirmed' | 'not_on_whatsapp'
  status: LeadStatus
  opted_out: boolean
  imported_batch: string | null
  created_at: string
  updated_at: string
  last_outbound_at: string | null
  last_inbound_at: string | null
}

export interface Conversation {
  id: string
  lead_id: string
  stage: ConversationStage
  ai_enabled: boolean
  human_takeover: boolean
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  lead_id: string
  direction: 'inbound' | 'outbound'
  wa_message_id: string | null
  message_type: 'text' | 'template' | 'document' | 'image' | 'audio' | 'video' | 'other'
  body: string | null
  media_url: string | null
  template_name: string | null
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
  error: Record<string, unknown> | null
  sent_by: 'system' | 'ai' | 'human' | 'contact'
  created_at: string
}

export interface EventRow {
  id: string
  lead_id: string | null
  conversation_id: string | null
  type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface CampaignSetting {
  key: string
  value: unknown
  updated_at: string
}

// Minimal shape satisfying supabase-js's generic Database param without
// codegen — table types are used directly via the interfaces above.
export type Database = {
  public: {
    Tables: {
      niches: { Row: Niche; Insert: Partial<Niche>; Update: Partial<Niche> }
      leads: { Row: Lead; Insert: Partial<Lead>; Update: Partial<Lead> }
      conversations: { Row: Conversation; Insert: Partial<Conversation>; Update: Partial<Conversation> }
      messages: { Row: Message; Insert: Partial<Message>; Update: Partial<Message> }
      events: { Row: EventRow; Insert: Partial<EventRow>; Update: Partial<EventRow> }
      campaign_settings: { Row: CampaignSetting; Insert: Partial<CampaignSetting>; Update: Partial<CampaignSetting> }
    }
  }
}
