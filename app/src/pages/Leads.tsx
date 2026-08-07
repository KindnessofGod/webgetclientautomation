import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabaseClient'
import { useLeads } from '../lib/useLeads'
import { useNiches } from '../lib/useNiches'
import { downloadCsv, normalizePhone } from '../lib/csv'
import type { Lead } from '../lib/database.types'

interface ParsedRow {
  [key: string]: string
}

export default function Leads() {
  const { leads, counts, refresh } = useLeads()
  const { niches, createNiche } = useNiches()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [businessCol, setBusinessCol] = useState('')
  const [phoneCol, setPhoneCol] = useState('')
  const [defaultCountryCode, setDefaultCountryCode] = useState('234')
  const [selectedNicheId, setSelectedNicheId] = useState('')
  const [newNicheName, setNewNicheName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<string | null>(null)

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data)
        setHeaders(result.meta.fields ?? [])
        const guessBusiness = (result.meta.fields ?? []).find((h) => /name|business/i.test(h))
        const guessPhone = (result.meta.fields ?? []).find((h) => /phone|number|whatsapp/i.test(h))
        setBusinessCol(guessBusiness ?? '')
        setPhoneCol(guessPhone ?? '')
        setImportSummary(null)
      },
    })
  }

  async function onCreateNiche() {
    if (!newNicheName.trim()) return
    const n = await createNiche(newNicheName.trim())
    if (n) setSelectedNicheId(n.id)
    setNewNicheName('')
  }

  async function onImport() {
    if (!rows || !phoneCol) return
    setImporting(true)
    const batchId = `import-${new Date().toISOString()}`
    const seen = new Set<string>()
    const toInsert: Partial<Lead>[] = []
    for (const row of rows) {
      const phone = normalizePhone(row[phoneCol] ?? '', defaultCountryCode)
      if (!phone || seen.has(phone)) continue
      seen.add(phone)
      toInsert.push({
        business_name: businessCol ? row[businessCol] || null : null,
        phone_e164: phone,
        niche_id: selectedNicheId || null,
        source: 'csv_import',
        raw_row: row,
        status: 'queued',
        imported_batch: batchId,
      })
    }

    let inserted = 0
    const chunkSize = 500
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize)
      const { error, count } = await supabase
        .from('leads')
        .upsert(chunk, { onConflict: 'phone_e164', ignoreDuplicates: true, count: 'exact' })
      if (!error) inserted += count ?? chunk.length
    }

    setImporting(false)
    setImportSummary(`Imported ${inserted} new lead(s) out of ${toInsert.length} rows with a valid phone (${rows.length - toInsert.length} skipped: missing/duplicate phone in file).`)
    setRows(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    refresh()
  }

  function exportLeads() {
    downloadCsv(
      `leads-${new Date().toISOString().slice(0, 10)}.csv`,
      leads.map((l) => ({
        business_name: l.business_name,
        phone_e164: l.phone_e164,
        status: l.status,
        whatsapp_status: l.whatsapp_status,
        opted_out: l.opted_out,
        source: l.source,
        imported_batch: l.imported_batch,
        created_at: l.created_at,
        last_outbound_at: l.last_outbound_at,
        last_inbound_at: l.last_inbound_at,
      })),
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto text-neutral-100">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Leads</h1>
        <button onClick={exportLeads} className="text-sm px-3 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-500">
          Download CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(counts).map(([status, n]) => (
          <span key={status} className="text-xs px-2 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300">
            {status}: {n}
          </span>
        ))}
        {leads.length === 0 && <span className="text-sm text-neutral-500">No leads imported yet.</span>}
      </div>

      <div className="rounded-lg border border-neutral-800 p-4 mb-6">
        <h2 className="text-sm font-medium mb-2">Import a CSV of leads</h2>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={onFileChosen} className="text-sm" />

        {rows && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-neutral-500">{rows.length} rows found. Map the columns below.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-neutral-400">
                Business name column
                <select
                  value={businessCol}
                  onChange={(e) => setBusinessCol(e.target.value)}
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm"
                >
                  <option value="">(none)</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-neutral-400">
                Phone number column *
                <select
                  value={phoneCol}
                  onChange={(e) => setPhoneCol(e.target.value)}
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm"
                >
                  <option value="">Select…</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-neutral-400">
                Default country code (used if a number has no + prefix)
                <input
                  value={defaultCountryCode}
                  onChange={(e) => setDefaultCountryCode(e.target.value)}
                  placeholder="234"
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-400">
                Niche for this whole batch
                <select
                  value={selectedNicheId}
                  onChange={(e) => setSelectedNicheId(e.target.value)}
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm"
                >
                  <option value="">(none)</option>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-2 items-center">
              <input
                value={newNicheName}
                onChange={(e) => setNewNicheName(e.target.value)}
                placeholder="New niche name (e.g. Restaurants)"
                className="rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm"
              />
              <button onClick={onCreateNiche} className="text-xs px-2 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-500">
                Add niche
              </button>
            </div>
            <button
              onClick={onImport}
              disabled={!phoneCol || importing}
              className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
            >
              {importing ? 'Importing…' : `Import ${rows.length} rows`}
            </button>
          </div>
        )}
        {importSummary && <p className="text-xs text-emerald-400 mt-3">{importSummary}</p>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-neutral-800">
            <th className="py-1.5 pr-3">Business</th>
            <th className="py-1.5 pr-3">Phone</th>
            <th className="py-1.5 pr-3">Status</th>
            <th className="py-1.5 pr-3">WhatsApp</th>
            <th className="py-1.5 pr-3">Imported</th>
          </tr>
        </thead>
        <tbody>
          {leads.slice(0, 100).map((l) => (
            <tr key={l.id} className="border-b border-neutral-900">
              <td className="py-1.5 pr-3">{l.business_name || '—'}</td>
              <td className="py-1.5 pr-3 text-neutral-400">{l.phone_e164}</td>
              <td className="py-1.5 pr-3">{l.status}</td>
              <td className="py-1.5 pr-3 text-neutral-500">{l.whatsapp_status}</td>
              <td className="py-1.5 pr-3 text-neutral-500">{new Date(l.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {leads.length > 100 && <p className="text-xs text-neutral-500 mt-2">Showing 100 of {leads.length}. Use Download CSV for the full list.</p>}
    </div>
  )
}
