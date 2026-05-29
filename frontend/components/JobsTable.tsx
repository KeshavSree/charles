import { Job } from '@/lib/api'

function fmtDate(val: string | null): string {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  })
}

const thStyle: React.CSSProperties = {
  padding: '5px 8px',
  textAlign: 'left',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: '11px',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

export default function JobsTable({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        No jobs found.
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            <th style={{ ...thStyle, width: '30%' }}>Title</th>
            <th style={thStyle}>Company</th>
            <th style={thStyle}>Source</th>
            <th style={thStyle}>Level</th>
            <th style={{ ...thStyle, width: '15%' }}>Location</th>
            <th style={thStyle}>Posted</th>
            <th style={thStyle}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job, i) => (
            <tr
              key={job.id}
              onClick={() => window.open(job.url, '_blank')}
              style={{
                background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2d2d5e'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)'
              }}
            >
              <td style={{ padding: '4px 8px', color: 'var(--accent-dim)' }}>{job.title}</td>
              <td style={{ padding: '4px 8px' }}>{job.company}</td>
              <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{job.source}</td>
              <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>
                {job.seniority === 'intern' ? 'Intern' : 'FT'}
              </td>
              <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>
                {job.location ?? '—'}
              </td>
              <td style={{ padding: '4px 8px', color: 'var(--gold)' }}>
                {fmtDate(job.posted_at)}
              </td>
              <td style={{ padding: '4px 8px', color: 'var(--gold)' }}>
                {fmtDate(job.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
