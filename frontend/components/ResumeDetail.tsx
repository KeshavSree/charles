'use client'
import { ResumeDetail as ResumeDetailType, resumePdfUrl } from '@/lib/api'
import ProfileEditor from './ProfileEditor'

const SECTION_ORDER = ['contact', 'experience', 'education', 'projects', 'skills']
const SECTION_LABELS: Record<string, string> = {
  contact: 'Contact',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  profile: 'Profile',
}

interface Props {
  resume: ResumeDetailType
  onDelete: () => void
  activeTab: string
  onTabChange: (tab: string) => void
}


export default function ResumeDetail({ resume, onDelete, activeTab, onTabChange }: Props) {
  const sectionTabs = SECTION_ORDER.filter((s) => resume.sections[s])
  const allTabs = [...sectionTabs, 'profile', 'pdf']

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
                    tab === 'pdf' || tab === 'profile'
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
                {SECTION_LABELS[tab] ?? tab.toUpperCase()}
              </button>
            ))}
          </div>

          {activeTab === 'pdf' ? (
            <iframe
              src={resumePdfUrl(resume.id)}
              style={{ flex: 1, border: 'none', width: '100%' }}
              title={resume.filename}
            />
          ) : activeTab === 'profile' ? (
            <ProfileEditor resumeId={resume.id} />
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              <pre
                style={{
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text)',
                  fontSize: '13px',
                  lineHeight: '1.65',
                }}
              >
                {resume.sections[activeTab] ?? ''}
              </pre>
            </div>
          )}
        </>
    </div>
  )
}
