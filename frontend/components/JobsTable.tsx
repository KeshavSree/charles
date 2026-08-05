import { Job } from '@/lib/api'

function fmtDate(val: string | null): string {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtSalary(job: Job): string {
  if (!job.salary_min && !job.salary_max) return '—'
  const k = (n: number | null) => (n ? `${Math.round(n / 1000)}k` : '')
  const range = job.salary_min && job.salary_max ? `${k(job.salary_min)}–${k(job.salary_max)}` : k(job.salary_max || job.salary_min)
  return `${range} ${job.salary_currency || ''}`.trim()
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

const tdStyle: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'top' }

const TIER_COLOR: Record<string, string> = {
  intern: '#7dd3fc',
  entry: '#86efac',
  mid: 'var(--text-muted)',
  senior: '#fbbf24',
}

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  color: 'var(--text-muted)',
  width: '18px',
  height: '18px',
  lineHeight: '1',
  padding: 0,
  cursor: 'pointer',
  fontSize: '12px',
}

/** The two triage actions. `onAdd` sends a job to the pipeline, `onDismiss` rejects it;
 *  either way the row leaves this list, which is the not-yet-triaged inbox. So there is
 *  no "already actioned" state to render. */
export default function JobsTable({
  jobs,
  onAdd,
  onDismiss,
}: {
  jobs: Job[]
  onAdd?: (job: Job) => void
  onDismiss?: (job: Job) => void
}) {
  const actions = Boolean(onAdd || onDismiss)
  if (jobs.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        No jobs match these filters.
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            {actions && <th style={{ ...thStyle, width: '52px' }} />}
            <th style={{ ...thStyle, width: '30%' }}>Title</th>
            <th style={thStyle}>Company</th>
            <th style={thStyle}>Source</th>
            <th style={thStyle}>Level</th>
            <th style={{ ...thStyle, width: '15%' }}>Location</th>
            <th style={thStyle}>Salary</th>
            <th style={thStyle}>Posted</th>
            <th style={thStyle}>Seen</th>
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
                opacity: job.status === 'delisted' ? 0.5 : 1,
              }}
            >
              {actions && (
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {onAdd && (
                    <button
                      title="Add to pipeline"
                      // The row itself opens the posting — these clicks must not.
                      onClick={(e) => {
                        e.stopPropagation()
                        onAdd(job)
                      }}
                      style={{ ...actionBtnStyle, marginRight: 3 }}
                    >
                      +
                    </button>
                  )}
                  {onDismiss && (
                    <button
                      title="Not interested — hide this posting"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDismiss(job)
                      }}
                      style={actionBtnStyle}
                    >
                      ✕
                    </button>
                  )}
                </td>
              )}
              <td style={tdStyle}>
                {job.title}
                {job.status === 'delisted' && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(delisted)</span>
                )}
                {job.trust_score !== null && job.trust_score < 100 && (
                  <span title={(job.trust_flags || []).join(', ')} style={{ color: '#f87171', marginLeft: 6 }}>
                    ⚠ {job.trust_score}
                  </span>
                )}
              </td>
              <td style={tdStyle}>{job.company}</td>
              <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{job.provider_id}</td>
              <td style={{ ...tdStyle, color: TIER_COLOR[job.tier] || 'var(--text-muted)' }}>{job.tier}</td>
              <td style={tdStyle}>{job.location || '—'}</td>
              <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{fmtSalary(job)}</td>
              <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{fmtDate(job.posted_at)}</td>
              <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{fmtDate(job.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
