'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  fetchPipeline,
  removeFromPipeline,
  updatePipelineEntry,
  PipelineJob,
  PipelineOutcome,
  PipelineStage,
  PIPELINE_STAGES,
  STAGE_LABELS,
} from '@/lib/api'

const btn: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '4px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
}

const th: React.CSSProperties = {
  padding: '5px 8px',
  textAlign: 'left',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'middle' }

// The one-stage-at-a-time nudge buttons. Small enough to sit in a 5px-padded row.
const stepBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text-muted)',
  width: 18,
  height: 18,
  lineHeight: 1,
  padding: 0,
  cursor: 'pointer',
  fontSize: 11,
}

const OUTCOME_COLOR: Record<PipelineOutcome, string> = {
  offer: '#86efac',
  rejected: '#f87171',
}

function fmtDate(val: string | null): string {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtSalary(j: PipelineJob): string {
  if (!j.salary_min && !j.salary_max) return '—'
  const k = (n: number | null) => (n ? `${Math.round(n / 1000)}k` : '')
  const range = j.salary_min && j.salary_max ? `${k(j.salary_min)}–${k(j.salary_max)}` : k(j.salary_max || j.salary_min)
  return `${range} ${j.salary_currency || ''}`.trim()
}

export default function PipelinePage() {
  const [stage, setStage] = useState<PipelineStage>('interested')
  const [items, setItems] = useState<PipelineJob[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two-click delete confirm: the armed row's id, cleared on blur.
  const [armed, setArmed] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchPipeline(stage)
      setItems(page.items)
      setCounts(page.counts)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline')
    } finally {
      setLoading(false)
    }
  }, [stage])

  useEffect(() => {
    load()
  }, [load])

  // Moving a job to another stage drops it out of the current tab, so the row is
  // removed locally and the tab counts are adjusted rather than refetching.
  async function move(job: PipelineJob, next: PipelineStage) {
    if (next === job.stage) return
    setItems((rows) => rows.filter((r) => r.job_id !== job.job_id))
    setCounts((c) => ({ ...c, [job.stage]: (c[job.stage] || 1) - 1, [next]: (c[next] || 0) + 1 }))
    try {
      await updatePipelineEntry(job.job_id, { stage: next })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move job')
      await load()
    }
  }

  async function setOutcome(job: PipelineJob, outcome: PipelineOutcome) {
    // Clicking the active result clears it — the entry stays in Final, undecided.
    const clearing = job.outcome === outcome
    setItems((rows) =>
      rows.map((r) => (r.job_id === job.job_id ? { ...r, outcome: clearing ? null : outcome } : r)),
    )
    try {
      await updatePipelineEntry(job.job_id, clearing ? { clear_outcome: true } : { outcome })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set outcome')
      await load()
    }
  }

  async function remove(job: PipelineJob) {
    setArmed(null)
    setItems((rows) => rows.filter((r) => r.job_id !== job.job_id))
    setCounts((c) => ({ ...c, [job.stage]: (c[job.stage] || 1) - 1 }))
    try {
      await removeFromPipeline(job.job_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove job')
      await load()
    }
  }

  /** Uncontrolled input, saved on blur — a controlled one would round-trip every
   *  keystroke. Nothing to do when the value is unchanged. */
  async function saveContact(job: PipelineJob, value: string) {
    const next = value.trim()
    if (next === (job.contact_email || '')) return
    setItems((rows) =>
      rows.map((r) => (r.job_id === job.job_id ? { ...r, contact_email: next || null } : r)),
    )
    try {
      const saved = await updatePipelineEntry(job.job_id, { contact_email: next })
      setItems((rows) => rows.map((r) => (r.job_id === job.job_id ? saved : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save contact')
      await load()
    }
  }

  const idx = PIPELINE_STAGES.indexOf(stage)
  // The contact is captured at Contacted and stays visible in every stage after it.
  const showContact = idx >= PIPELINE_STAGES.indexOf('contacted')
  const total = PIPELINE_STAGES.reduce((n, s) => n + (counts[s] || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontSize: 15, fontWeight: 600 }}>
          Pipeline{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400 }}>
            {loading ? 'loading…' : `(${total})`}
          </span>
        </h1>
        <Link href="/jobs" style={{ ...btn, textDecoration: 'none' }}>
          + Add from Jobs
        </Link>
      </div>

      {error && (
        <div
          style={{
            border: '1px solid #f87171',
            color: '#f87171',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          {error}
          <span onClick={() => setError(null)} style={{ cursor: 'pointer' }}>
            ✕
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {PIPELINE_STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            style={{
              ...btn,
              borderColor: stage === s ? 'var(--gold)' : 'var(--border)',
              color: stage === s ? 'var(--gold)' : 'var(--text)',
            }}
          >
            {STAGE_LABELS[s]}
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Nothing in {STAGE_LABELS[stage]}. Add jobs with the <strong>+</strong> button on the Jobs page.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th style={{ ...th, width: 52 }}>Move</th>
                <th style={{ ...th, width: '28%' }}>Title</th>
                <th style={th}>Company</th>
                <th style={{ ...th, width: '14%' }}>Location</th>
                <th style={th}>Salary</th>
                <th style={th}>Stage</th>
                {showContact && <th style={{ ...th, width: '16%' }}>Contact</th>}
                {stage === 'final' && <th style={th}>Result</th>}
                <th style={th}>Posted</th>
                <th style={th}>Last Interacted</th>
                <th style={{ ...th, width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((job, i) => (
                <tr
                  key={job.job_id}
                  style={{
                    background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button
                      title="Back a stage"
                      disabled={idx === 0}
                      onClick={() => move(job, PIPELINE_STAGES[idx - 1])}
                      style={{ ...stepBtn, opacity: idx === 0 ? 0.3 : 1, marginRight: 3 }}
                    >
                      ‹
                    </button>
                    <button
                      title="Forward a stage"
                      disabled={idx === PIPELINE_STAGES.length - 1}
                      onClick={() => move(job, PIPELINE_STAGES[idx + 1])}
                      style={{ ...stepBtn, opacity: idx === PIPELINE_STAGES.length - 1 ? 0.3 : 1 }}
                    >
                      ›
                    </button>
                  </td>
                  <td style={td}>
                    <a href={job.url} target="_blank" rel="noreferrer" style={{ cursor: 'pointer' }}>
                      {job.title}
                    </a>
                    {job.status === 'delisted' && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(delisted)</span>
                    )}
                  </td>
                  <td style={td}>{job.company}</td>
                  <td style={td}>{job.location || '—'}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtSalary(job)}</td>
                  <td style={td}>
                    {/* The jump-anywhere control; the ‹ › buttons are the fast path. */}
                    <select
                      value={job.stage}
                      onChange={(e) => move(job, e.target.value as PipelineStage)}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        borderRadius: 3,
                        padding: '2px 4px',
                        fontSize: 11,
                        outline: 'none',
                      }}
                    >
                      {PIPELINE_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  {showContact && (
                    <td style={td}>
                      <input
                        type="email"
                        defaultValue={job.contact_email || ''}
                        placeholder="email contacted"
                        onBlur={(e) => saveContact(job, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                          borderRadius: 3,
                          padding: '2px 5px',
                          fontSize: 11,
                          width: '100%',
                          outline: 'none',
                        }}
                      />
                    </td>
                  )}
                  {stage === 'final' && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {(['offer', 'rejected'] as PipelineOutcome[]).map((o) => {
                        const on = job.outcome === o
                        return (
                          <button
                            key={o}
                            onClick={() => setOutcome(job, o)}
                            title={on ? 'Click to clear' : ''}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${on ? OUTCOME_COLOR[o] : 'var(--border)'}`,
                              color: on ? OUTCOME_COLOR[o] : 'var(--text-muted)',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontSize: 11,
                              cursor: 'pointer',
                              marginRight: 4,
                            }}
                          >
                            {o === 'offer' ? 'Offer' : 'Rejected'}
                          </button>
                        )
                      })}
                    </td>
                  )}
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtDate(job.posted_at)}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>
                    {fmtDate(job.last_interacted_at)}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      title="Remove from pipeline"
                      onClick={() => (armed === job.job_id ? remove(job) : setArmed(job.job_id))}
                      onBlur={() => setArmed((a) => (a === job.job_id ? null : a))}
                      style={{
                        ...stepBtn,
                        width: 'auto',
                        padding: '0 4px',
                        color: armed === job.job_id ? '#f87171' : 'var(--text-muted)',
                        borderColor: armed === job.job_id ? '#f87171' : 'var(--border)',
                      }}
                    >
                      {armed === job.job_id ? 'sure?' : '✕'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
