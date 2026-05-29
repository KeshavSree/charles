'use client'
import { ResumeSummary } from '@/lib/api'

interface Props {
  resumes: ResumeSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onUploadClick: () => void
}

export default function ResumeList({ resumes, activeId, onSelect, onUploadClick }: Props) {
  return (
    <div
      style={{
        width: '280px',
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
          }}
        >
          Resumes
        </span>
        <button
          onClick={onUploadClick}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          + Upload
        </button>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {resumes.length === 0 && (
          <div
            style={{
              padding: '24px 12px',
              color: 'var(--text-muted)',
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            No resumes yet.
          </div>
        )}
        {resumes.map((r) => (
          <div
            key={r.id}
            onClick={() => onSelect(r.id)}
            style={{
              padding: '10px 12px',
              cursor: 'pointer',
              borderLeft: `2px solid ${r.id === activeId ? 'var(--accent)' : 'transparent'}`,
              background: r.id === activeId ? 'var(--surface-2)' : 'transparent',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                color: r.id === activeId ? 'var(--accent-dim)' : 'var(--text)',
                fontSize: '13px',
                marginBottom: '3px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.filename}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              {r.section_count} sections · {new Date(r.uploaded_at).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
