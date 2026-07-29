'use client'
import { useEffect, useState } from 'react'
import {
  deleteResume,
  fetchResume,
  fetchResumes,
  ResumeDetail as ResumeDetailType,
  ResumeSummary,
} from '@/lib/api'
import ResumeDetail from '@/components/ResumeDetail'
import ResumeList from '@/components/ResumeList'
import ResumeUpload from '@/components/ResumeUpload'

const SECTION_ORDER = ['contact', 'experience', 'education', 'projects', 'skills']

export default function ResumesPage() {
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ResumeDetailType | null>(null)
  const [activeTab, setActiveTab] = useState('')
  const [showUpload, setShowUpload] = useState(false)

  async function loadList() {
    const data = await fetchResumes()
    setResumes(data)
  }

  useEffect(() => {
    loadList()
  }, [])

  async function handleSelect(id: string) {
    setShowUpload(false)
    setActiveId(id)
    const d = await fetchResume(id)
    setDetail(d)
    setActiveTab(SECTION_ORDER.find((s) => d.sections[s]) ?? 'pdf')
  }

  async function handleDelete() {
    if (!activeId) return
    await deleteResume(activeId)
    setActiveId(null)
    setDetail(null)
    await loadList()
  }

  async function handleUploaded(id: string) {
    await loadList()
    await handleSelect(id)
  }

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 32px)',
        background: 'var(--surface)',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <ResumeList
        resumes={resumes}
        activeId={activeId}
        onSelect={handleSelect}
        onUploadClick={() => setShowUpload(true)}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {showUpload && (
          <div style={{ padding: '24px' }}>
            <ResumeUpload onUploaded={handleUploaded} />
          </div>
        )}
        {!showUpload && detail && (
          <ResumeDetail
            resume={detail}
            onDelete={handleDelete}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        )}
        {!showUpload && !detail && (
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
            Select a resume or upload one to get started.
          </div>
        )}
      </div>
    </div>
  )
}
