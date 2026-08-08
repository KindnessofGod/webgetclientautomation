// Approve/reject a pending follow-up. Posts to n8n, which sends the WhatsApp
// template on approval (or just logs the rejection) -- the access token
// never touches the browser, same pattern as sendManualMessage.
const webhookUrl = import.meta.env.VITE_N8N_FOLLOWUP_WEBHOOK_URL as string | undefined

export async function sendFollowUpDecision(params: {
  pendingId: string
  decision: 'approve' | 'reject'
}): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) {
    return { ok: false, error: 'VITE_N8N_FOLLOWUP_WEBHOOK_URL is not configured -- see README for n8n setup.' }
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending_id: params.pendingId, decision: params.decision }),
    })
    if (!res.ok) return { ok: false, error: `n8n webhook returned ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
