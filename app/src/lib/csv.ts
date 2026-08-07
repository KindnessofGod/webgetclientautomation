import Papa from 'papaparse'

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Best-effort E.164 normalizer: keeps a leading '+', strips everything else
// non-numeric, and prefixes a default country code when the number has none.
export function normalizePhone(raw: string, defaultCountryCode: string): string | null {
  let s = raw.trim()
  if (!s) return null
  const hasPlus = s.startsWith('+')
  s = s.replace(/[^\d]/g, '')
  if (!s) return null
  if (hasPlus) return `+${s}`
  const cc = defaultCountryCode.replace(/[^\d]/g, '')
  if (cc && s.startsWith(cc)) return `+${s}`
  if (cc && s.startsWith('0')) return `+${cc}${s.slice(1)}`
  if (cc) return `+${cc}${s}`
  return `+${s}`
}
