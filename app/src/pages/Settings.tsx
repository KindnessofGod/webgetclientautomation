import { useState } from 'react'
import { useCampaignSettings } from '../lib/useCampaignSettings'
import { useNiches } from '../lib/useNiches'
import { useMessageTemplates } from '../lib/useMessageTemplates'

const STAGES = ['first_touch', 'pitch', 'offer', 'handoff', 'opt_out_ack', 'fallback']

export default function Settings() {
  const { settings, updateSetting } = useCampaignSettings()
  const { niches } = useNiches()
  const { templates, createTemplate, toggleActive } = useMessageTemplates()

  const [dailyCap, setDailyCap] = useState<string>('')
  const [jitterMin, setJitterMin] = useState<string>('')
  const [jitterMax, setJitterMax] = useState<string>('')

  const [tplNiche, setTplNiche] = useState('')
  const [tplStage, setTplStage] = useState('first_touch')
  const [tplMetaName, setTplMetaName] = useState('')
  const [tplBody, setTplBody] = useState('')

  const window = settings.send_window as { start?: string; end?: string; timezone?: string } | undefined

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto text-neutral-100 space-y-8">
      <div>
        <h1 className="text-lg font-semibold mb-1">Send pacing &amp; safety</h1>
        <p className="text-sm text-neutral-500 mb-4">
          These caps exist to keep the number off Meta&apos;s spam radar. n8n reads them before every send batch.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Daily send cap (current: ${String(settings.daily_send_cap ?? '—')})`}>
            <input
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              placeholder="e.g. 100"
              className="input"
            />
            <SaveBtn onClick={() => dailyCap && updateSetting('daily_send_cap', Number(dailyCap))} />
          </Field>
          <Field label="WhatsApp tier limit (info only)">
            <input value={String(settings.whatsapp_tier_limit ?? '')} disabled className="input opacity-60" />
          </Field>
          <Field label={`Jitter min seconds (current: ${String(settings.send_jitter_seconds_min ?? '—')})`}>
            <input value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} placeholder="25" className="input" />
            <SaveBtn onClick={() => jitterMin && updateSetting('send_jitter_seconds_min', Number(jitterMin))} />
          </Field>
          <Field label={`Jitter max seconds (current: ${String(settings.send_jitter_seconds_max ?? '—')})`}>
            <input value={jitterMax} onChange={(e) => setJitterMax(e.target.value)} placeholder="180" className="input" />
            <SaveBtn onClick={() => jitterMax && updateSetting('send_jitter_seconds_max', Number(jitterMax))} />
          </Field>
        </div>
        <p className="text-xs text-neutral-500 mt-3">
          Send window: {window?.start ?? '?'}–{window?.end ?? '?'} ({window?.timezone ?? '?'}). Edit via SQL/Supabase dashboard for now.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-1">Message templates</h2>
        <p className="text-sm text-neutral-500 mb-4">
          First-touch messages must match a template approved in Meta Business Manager — the <code>meta_template_name</code>{' '}
          field is what n8n sends to the Cloud API. Pitch/offer/handoff bodies are free-form and only used after the contact
          has replied (inside the 24h window), so they don&apos;t need approval.
        </p>
        <div className="rounded-lg border border-neutral-800 p-4 space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-neutral-400">
              Niche
              <select value={tplNiche} onChange={(e) => setTplNiche(e.target.value)} className="input mt-1">
                <option value="">(all / generic)</option>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-400">
              Stage
              <select value={tplStage} onChange={(e) => setTplStage(e.target.value)} className="input mt-1">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {tplStage === 'first_touch' && (
            <label className="text-xs text-neutral-400 block">
              Meta-approved template name
              <input
                value={tplMetaName}
                onChange={(e) => setTplMetaName(e.target.value)}
                placeholder="e.g. business_intro_v1"
                className="input mt-1"
              />
            </label>
          )}
          <label className="text-xs text-neutral-400 block">
            Body (for your reference / free-form stages — use {'{{business_name}}'} etc. as placeholders)
            <textarea value={tplBody} onChange={(e) => setTplBody(e.target.value)} rows={3} className="input mt-1" />
          </label>
          <button
            onClick={() => {
              if (!tplBody.trim()) return
              createTemplate({
                niche_id: tplNiche || null,
                stage: tplStage,
                meta_template_name: tplMetaName || null,
                body: tplBody,
              })
              setTplBody('')
              setTplMetaName('')
            }}
            className="text-sm px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500"
          >
            Save template
          </button>
        </div>

        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-md border border-neutral-800 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">
                  {t.stage} · {niches.find((n) => n.id === t.niche_id)?.name ?? 'generic'}
                  {t.meta_template_name && ` · meta: ${t.meta_template_name}`}
                </span>
                <button
                  onClick={() => toggleActive(t.id, !t.active)}
                  className={`text-xs px-2 py-0.5 rounded-full border ${t.active ? 'border-emerald-500 text-emerald-300' : 'border-neutral-700 text-neutral-500'}`}
                >
                  {t.active ? 'active' : 'inactive'}
                </button>
              </div>
              <p className="mt-1 text-neutral-200 whitespace-pre-wrap">{t.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-neutral-400 flex flex-col gap-1.5">
      {label}
      <div className="flex gap-2">{children}</div>
    </label>
  )
}

function SaveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs px-2 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-500 shrink-0">
      Save
    </button>
  )
}
