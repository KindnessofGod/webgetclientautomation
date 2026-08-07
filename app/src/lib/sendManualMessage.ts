// Manual sends never call WhatsApp directly from the browser — the access
// token lives only in n8n. This posts to an n8n webhook which sends via the
// Cloud API and writes the resulting message row to Supabase (picked up by
// the UI over realtime).
const webhookUrl = import.meta.env.VITE_N8N_MANUAL_SEND_WEBHOOK_URL as string | undefined

export async function sendManualMessage(params: {
  conversationId: string
  leadId: string
  phoneE164: string
  body: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) {
    return { ok: false, error: 'VITE_N8N_MANUAL_SEND_WEBHOOK_URL is not configured — see README for n8n setup.' }
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: params.conversationId,
        lead_id: params.leadId,
        phone_e164: params.phoneE164,
        body: params.body,
      }),
    })
    if (!res.ok) return { ok: false, error: `n8n webhook returned ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
