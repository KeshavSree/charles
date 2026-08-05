'use client'

interface Props {
  companies: string[]
  providers: string[]
  tiers: string[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '5px 10px',
  borderRadius: '4px',
  fontSize: '12px',
  outline: 'none',
}

const TIER_LABELS: Record<string, string> = {
  intern: 'Intern',
  entry: 'Entry',
  mid: 'Mid',
  senior: 'Senior',
}

export default function FilterBar({ companies, providers, tiers, values, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
      <input
        placeholder="Search titles…"
        value={values.search || ''}
        onChange={(e) => onChange('search', e.target.value)}
        style={{ ...inputStyle, width: '180px' }}
      />
      <input
        placeholder="Search descriptions…"
        value={values.q || ''}
        onChange={(e) => onChange('q', e.target.value)}
        style={{ ...inputStyle, width: '180px' }}
      />
      <input
        placeholder="Location…"
        value={values.location || ''}
        onChange={(e) => onChange('location', e.target.value)}
        style={{ ...inputStyle, width: '130px' }}
      />
      <select value={values.company || ''} onChange={(e) => onChange('company', e.target.value)} style={inputStyle}>
        <option value="">All companies</option>
        {companies.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={values.provider_id || ''} onChange={(e) => onChange('provider_id', e.target.value)} style={inputStyle}>
        <option value="">All sources</option>
        {providers.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={values.tier || ''} onChange={(e) => onChange('tier', e.target.value)} style={inputStyle}>
        <option value="">All levels</option>
        {tiers.map((t) => <option key={t} value={t}>{TIER_LABELS[t] || t}</option>)}
      </select>
      <select value={values.status || 'active'} onChange={(e) => onChange('status', e.target.value)} style={inputStyle}>
        <option value="active">Active</option>
        <option value="dismissed">Dismissed</option>
        <option value="delisted">Delisted</option>
        <option value="any">Any status</option>
      </select>
    </div>
  )
}
