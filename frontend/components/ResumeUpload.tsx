'use client'
import { useRef, useState } from 'react'
import { uploadResume } from '@/lib/api'

interface Props {
  onUploaded: (id: string) => void
}

export default function ResumeUpload({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const { id } = await uploadResume(file)
      onUploaded(id)
    } catch {
      setError('Upload failed. Make sure it is a PDF.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) handleFile(f)
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: '1px dashed var(--accent)',
          borderRadius: '6px',
          padding: '40px 24px',
          textAlign: 'center',
          cursor: uploading ? 'default' : 'pointer',
          color: 'var(--text-muted)',
          fontSize: '13px',
          opacity: uploading ? 0.6 : 1,
        }}
      >
        <div style={{ color: 'var(--gold)', marginBottom: '10px', fontSize: '28px' }}>↑</div>
        <div>{uploading ? 'Uploading…' : 'Drop a PDF here or click to browse'}</div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
      </div>
      {error && (
        <div style={{ marginTop: '8px', color: '#f87171', fontSize: '12px' }}>{error}</div>
      )}
    </div>
  )
}
