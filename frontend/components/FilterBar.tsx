'use client'

interface Props {
  companies: string[]
  sources: string[]
  search: string
  company: string
  source: string
  seniority: string
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

export default function FilterBar({
  companies,
  sources,
  search,
  company,
  source,
  seniority,
  onChange,
}: Props) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
      <input
        placeholder="Search titles..."
        value={search}
        onChange={(e) => onChange('search', e.target.value)}
        style={{ ...inputStyle, width: '200px' }}
      />
      <select
        value={company}
        onChange={(e) => onChange('company', e.target.value)}
        style={inputStyle}
      >
        <option value="">All Companies</option>
        {companies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={source}
        onChange={(e) => onChange('source', e.target.value)}
        style={inputStyle}
      >
        <option value="">All Sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={seniority}
        onChange={(e) => onChange('seniority', e.target.value)}
        style={inputStyle}
      >
        <option value="">All Levels</option>
        <option value="full_time">Full Time</option>
        <option value="intern">Intern</option>
      </select>
    </div>
  )
}
