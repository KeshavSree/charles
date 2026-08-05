'use client'
import { useEffect, useState } from 'react'
import {
  ScannerSource, TrackedCompany,
  deleteCompany, fetchCompanies, fetchProviders, saveCompany,
} from '@/lib/api'

const btn: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
const input: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '5px 8px', borderRadius: 4, fontSize: 12, outline: 'none',
}
const th: React.CSSProperties = {
  padding: '5px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600,
  fontSize: 11, letterSpacing: '.05em', textTransform: 'uppercase',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border)' }
const note: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }

export interface PanelProps {
  source: ScannerSource
  onSettings: (settings: Record<string, unknown>) => void
}

/** Default panel for the board sources. They have no configuration beyond on or off,
 *  so this just explains what the source is rather than rendering an empty form. */
function BoardPanel({ source }: PanelProps) {
  return (
    <p style={note}>
      A single public feed covering many companies, so there is nothing to configure.
      Because it needs no company list, your title and location filters are the only
      thing constraining it.
    </p>
  )
}

function TrackedPanel({ source }: PanelProps) {
  const [companies, setCompanies] = useState<TrackedCompany[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [draft, setDraft] = useState({ name: '', careers_url: '' })

  const reload = () => fetchCompanies().then(setCompanies).catch(console.error)
  useEffect(() => {
    reload()
    fetchProviders().then(setProviders).catch(console.error)
  }, [])

  return (
    <div>
      <p style={note}>
        Paste a careers URL and the ATS is detected from it. A red “none” in Detected
        means no provider claims the URL, so that entry will never return jobs.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...input, width: 170 }} placeholder="Company name"
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input style={{ ...input, width: 360 }} placeholder="https://job-boards.greenhouse.io/acme"
          value={draft.careers_url} onChange={(e) => setDraft({ ...draft, careers_url: e.target.value })} />
        <button style={btn} onClick={async () => {
          if (!draft.name) return
          await saveCompany({ ...draft, enabled: true })
          setDraft({ name: '', careers_url: '' })
          reload()
        }}>Add</button>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--surface-2)' }}>
            <th style={th}>On</th><th style={th}>Company</th><th style={th}>Careers URL</th>
            <th style={th}>Detected</th><th style={th}>Notes</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} style={{ opacity: c.enabled ? 1 : 0.55 }}>
                <td style={td}>
                  <input type="checkbox" checked={c.enabled} onChange={async () => {
                    await saveCompany({ name: c.name, enabled: !c.enabled }); reload()
                  }} />
                </td>
                <td style={td}>{c.name}</td>
                <td style={{ ...td, color: 'var(--text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.careers_url}
                </td>
                <td style={{ ...td, color: c.resolved_provider ? 'var(--gold)' : '#f87171' }}>
                  {c.resolved_provider || 'none'}
                </td>
                <td style={{ ...td, color: 'var(--text-muted)', fontSize: 11 }}>{c.notes || ''}</td>
                <td style={td}>
                  <button style={{ ...btn, padding: '2px 8px' }}
                    onClick={async () => { await deleteCompany(c.id); reload() }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...note, marginTop: 8 }}>Providers available: {providers.join(', ')}</p>
    </div>
  )
}

const ATS_DIRECTORIES = ['greenhouse', 'lever', 'ashby', 'workday'] as const

function DirectoryPanel({ source, onSettings }: PanelProps) {
  const selected = (source.settings.ats_sources as string[]) || [...ATS_DIRECTORIES]
  const cap = (source.settings.limit_per_ats as number) ?? null

  return (
    <div>
      <p style={note}>
        Walks public directories of every company on each ATS, so it finds companies you
        never curated. Only fresh postings are kept, since sweeping thousands of boards
        without a date gate is a firehose.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        {ATS_DIRECTORIES.map((a) => (
          <label key={a} style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={selected.includes(a)} onChange={(e) => {
              const set = new Set(selected)
              if (e.target.checked) set.add(a); else set.delete(a)
              onSettings({ ...source.settings, ats_sources: [...set] })
            }} />
            {a}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          Companies per ATS
          <input style={{ ...input, width: 90 }} type="number" value={cap ?? ''}
            placeholder="all"
            onChange={(e) => onSettings({
              ...source.settings,
              limit_per_ats: e.target.value ? Number(e.target.value) : null,
            })} />
        </label>
        <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={Boolean(source.settings.shuffle)}
            onChange={(e) => onSettings({ ...source.settings, shuffle: e.target.checked })} />
          Shuffle
        </label>
      </div>
      {cap != null && !source.settings.shuffle && (
        <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>
          Without shuffle a capped sweep always takes the same alphabetical first slice,
          so later companies are never reached.
        </p>
      )}
    </div>
  )
}

const SEED_LISTS = [
  { id: 'yc', label: 'Y Combinator' },
  { id: 'a16z', label: 'Andreessen Horowitz' },
]

function SeedsPanel({ source, onSettings }: PanelProps) {
  const selected = (source.settings.lists as string[]) || SEED_LISTS.map((l) => l.id)
  return (
    <div>
      <p style={note}>
        Pulls public VC portfolio lists and probes each company for a Greenhouse, Lever
        or Ashby board. Catches early-stage companies too new for the ATS directories.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        {SEED_LISTS.map((l) => (
          <label key={l.id} style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={selected.includes(l.id)} onChange={(e) => {
              const set = new Set(selected)
              if (e.target.checked) set.add(l.id); else set.delete(l.id)
              onSettings({ ...source.settings, lists: [...set] })
            }} />
            {l.label}
          </label>
        ))}
      </div>
    </div>
  )
}

const PANELS: Record<string, (p: PanelProps) => JSX.Element> = {
  tracked: TrackedPanel,
  directory: DirectoryPanel,
  seeds: SeedsPanel,
}

export default function SourcePanel(props: PanelProps) {
  const Panel = PANELS[props.source.id] || BoardPanel
  return <Panel {...props} />
}
