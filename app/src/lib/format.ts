export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString()
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const STAGE_LABEL: Record<string, string> = {
  new: 'New',
  awaiting_confirmation: 'Awaiting confirmation',
  confirmed_business: 'Confirmed business',
  pitched: 'Pitched',
  awaiting_interest: 'Awaiting interest',
  interested: 'Interested',
  not_interested: 'Not interested',
  hot_lead: 'Hot lead',
  handed_off: 'Handed off',
  closed: 'Closed',
  unqualified: 'Unqualified',
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage
}

export function stageColor(stage: string): string {
  switch (stage) {
    case 'hot_lead':
    case 'handed_off':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    case 'interested':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    case 'not_interested':
    case 'closed':
      return 'bg-neutral-700/40 text-neutral-400 border-neutral-600/40'
    case 'unqualified':
      return 'bg-red-500/10 text-red-400 border-red-500/30'
    case 'new':
      return 'bg-sky-500/20 text-sky-300 border-sky-500/40'
    default:
      return 'bg-violet-500/20 text-violet-300 border-violet-500/40'
  }
}
