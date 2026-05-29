'use client'
import { ResumeDetail as ResumeDetailType, resumePdfUrl } from '@/lib/api'

const SECTION_ORDER = ['contact', 'experience', 'education', 'projects', 'skills']
const SECTION_LABELS: Record<string, string> = {
  contact: 'Contact',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
}

interface Props {
  resume: ResumeDetailType
  onDelete: () => void
  activeTab: string
  onTabChange: (tab: string) => void
}

function splitEntries(content: string): string[] {
  return content.split(/\n{2,}/).map((e) => e.trim()).filter(Boolean)
}

function SectionEntries({ content, sectionType }: { content: string; sectionType: string }) {
  if (sectionType === 'skills' || sectionType === 'contact') {
    return (
      <pre
        style={{
          fontFamily: 'inherit',
          whiteSpace: 'pre-wrap',
          color: 'var(--text)',
          fontSize: '13px',
          lineHeight: '1.65',
        }}
      >
        {content}
      </pre>
    )
  }

  const entries = splitEntries(content)
  if (entries.length <= 1) {
    return (
      <pre
        style={{
          fontFamily: 'inherit',
          whiteSpace: 'pre-wrap',
          color: 'var(--text)',
          fontSize: '13px',
          lineHeight: '1.65',
        }}
      >
        {content}
      </pre>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {entries.map((entry, i) => {
        const lines = entry.split('\n')
        const headline = lines[0]
        const body = lines.slice(1).join('\n')
        return (
          <div
            key={i}
            style={{
              borderLeft: '2px solid var(--accent)',
              paddingLeft: '12px',
              paddingBottom: '4px',
            }}
          >
            <div
              style={{
                color: 'var(--accent-dim)',
                fontSize: '13px',
                fontWeight: 600,
                marginBottom: body ? '4px' : 0,
              }}
            >
              {headline}
            </div>
            {body && (
              <pre
                style={{
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text)',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  margin: 0,
                }}
              >
                {body}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ResumeDetail({ resume, onDelete, activeTab, onTabChange }: Props) {
  const sectionTabs = SECTION_ORDER.filter((s) => resume.sections[s])
  const allTabs = [...sectionTabs, 'pdf']

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--text)', fontSize: '13px' }}>{resume.filename}</span>
        <button
          onClick={onDelete}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            padding: '3px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>

      {allTabs.length === 1 /* only PDF tab, no sections */ && activeTab !== 'pdf' ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '13px',
          }}
        >
          No sections parsed yet. View the{' '}
          <button
            onClick={() => onTabChange('pdf')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-dim)',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '0 4px',
            }}
          >
            PDF
          </button>{' '}
          tab to see the original document.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              flexShrink: 0,
            }}
          >
            {allTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                style={{
                  padding: '7px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'}`,
                  color:
                    tab === 'pdf'
                      ? activeTab === tab
                        ? 'var(--gold)'
                        : 'var(--text-muted)'
                      : activeTab === tab
                      ? 'var(--accent-dim)'
                      : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {tab === 'pdf' ? 'PDF' : (SECTION_LABELS[tab] ?? tab)}
              </button>
            ))}
          </div>

          {activeTab === 'pdf' ? (
            <iframe
              src={resumePdfUrl(resume.id)}
              style={{ flex: 1, border: 'none', width: '100%' }}
              title={resume.filename}
            />
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              <SectionEntries
                content={resume.sections[activeTab] ?? ''}
                sectionType={activeTab}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
