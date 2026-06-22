'use client'
import { useEffect, useState } from 'react'
import {
  Profile, ProfileExperience, ProfileEducation,
  fetchProfile, updateProfile, generateProfile,
} from '@/lib/api'

const FIELD_STYLE = {
  width: '100%',
  padding: '5px 8px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  color: 'var(--text)',
  fontSize: '12px',
  boxSizing: 'border-box' as const,
}

const LABEL_STYLE = {
  display: 'block',
  color: 'var(--text-muted)',
  fontSize: '11px',
  marginBottom: '3px',
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <label style={LABEL_STYLE}>{label}</label>
      <input style={FIELD_STYLE} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

const DATE_RE = /^\d{1,2}\/\d{4}$/

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const invalid = value.length > 0 && !DATE_RE.test(value.trim())
  return (
    <div style={{ marginBottom: '10px' }}>
      <label style={LABEL_STYLE}>{label}</label>
      <input
        style={{
          ...FIELD_STYLE,
          borderColor: invalid ? '#f87171' : undefined,
          outline: invalid ? '1px solid #f87171' : undefined,
        }}
        placeholder="MM/YYYY"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && (
        <span style={{ fontSize: '10px', color: '#f87171', marginTop: '2px', display: 'block' }}>
          Use MM/YYYY (e.g. 06/2023)
        </span>
      )}
    </div>
  )
}

function ExpCard({
  entry, index, onChange, onDelete,
}: {
  entry: ProfileExperience
  index: number
  onChange: (i: number, e: ProfileExperience) => void
  onDelete: (i: number) => void
}) {
  const set = (key: keyof ProfileExperience) => (v: string) =>
    onChange(index, { ...entry, [key]: v })
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
      <Field label="Title" value={entry.title} onChange={set('title')} />
      <Field label="Company" value={entry.company} onChange={set('company')} />
      <Field label="Location" value={entry.location ?? ''} onChange={set('location')} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <DateField label="Start (MM/YYYY)" value={entry.start_date ?? ''} onChange={set('start_date')} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={entry.is_current}
              onChange={() => onChange(index, { ...entry, is_current: !entry.is_current, end_date: !entry.is_current ? null : entry.end_date })}
            />
            Current Role
          </label>
        </div>
        {!entry.is_current && (
          <div style={{ flex: 1 }}>
            <DateField label="End (MM/YYYY)" value={entry.end_date ?? ''} onChange={set('end_date')} />
          </div>
        )}
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label style={LABEL_STYLE}>Description</label>
        <textarea
          style={{ ...FIELD_STYLE, height: '60px', resize: 'vertical' }}
          value={entry.description ?? ''}
          onChange={(e) => onChange(index, { ...entry, description: e.target.value })}
        />
      </div>
      <button
        onClick={() => onDelete(index)}
        style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        Remove
      </button>
    </div>
  )
}

function EduCard({
  entry, index, onChange, onDelete,
}: {
  entry: ProfileEducation
  index: number
  onChange: (i: number, e: ProfileEducation) => void
  onDelete: (i: number) => void
}) {
  const set = (key: keyof ProfileEducation) => (v: string) =>
    onChange(index, { ...entry, [key]: v })
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
      <Field label="Institution" value={entry.institution} onChange={set('institution')} />
      <div style={{ marginBottom: '10px' }}>
        <label style={LABEL_STYLE}>Degree</label>
        <select
          style={{ ...FIELD_STYLE, cursor: 'pointer' }}
          value={entry.degree ?? ''}
          onChange={(e) => onChange(index, { ...entry, degree: e.target.value || null })}
        >
          <option value="">—</option>
          <option value="B.S.">B.S. — Bachelor of Science</option>
          <option value="M.S.">M.S. — Master of Science</option>
          <option value="PhD">PhD — Doctor of Philosophy</option>
        </select>
      </div>
      <Field label="Major" value={entry.major ?? ''} onChange={set('major')} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1 }}><Field label="GPA" value={entry.gpa ?? ''} onChange={set('gpa')} /></div>
        <div style={{ flex: 1 }}><Field label="Grad Month" value={entry.grad_month ?? ''} onChange={set('grad_month')} /></div>
        <div style={{ flex: 1 }}><Field label="Grad Year" value={entry.grad_year ?? ''} onChange={set('grad_year')} /></div>
      </div>
      <button
        onClick={() => onDelete(index)}
        style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        Remove
      </button>
    </div>
  )
}

const EMPTY_PROFILE: Omit<Profile, 'resume_id'> = {
  first_name: '', last_name: '', email: '', phone: null,
  linkedin_url: null, location: null, work_auth: null,
  experience: [], education: [],
}

export default function ProfileEditor({ resumeId }: { resumeId: string }) {
  const [profile, setProfile] = useState<Omit<Profile, 'resume_id'>>(EMPTY_PROFILE)
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading')

  useEffect(() => {
    setStatus('loading')
    fetchProfile(resumeId)
      .then((p) => { setProfile(p); setStatus('idle') })
      .catch(() => setStatus('idle'))
  }, [resumeId])

  const handleSave = async () => {
    setStatus('saving')
    try {
      const updated = await updateProfile(resumeId, profile)
      setProfile(updated)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('error')
    }
  }

  const handleGenerate = async () => {
    setStatus('loading')
    try {
      const p = await generateProfile(resumeId)
      setProfile(p)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  const set = (key: keyof typeof profile) => (v: string) =>
    setProfile((p) => ({ ...p, [key]: v || null }))

  const updateExp = (i: number, e: ProfileExperience) =>
    setProfile((p) => { const exp = [...p.experience]; exp[i] = e; return { ...p, experience: exp } })
  const deleteExp = (i: number) =>
    setProfile((p) => ({ ...p, experience: p.experience.filter((_, idx) => idx !== i) }))
  const addExp = () =>
    setProfile((p) => ({
      ...p,
      experience: [...p.experience, { company: '', title: '', location: null, start_date: null, end_date: null, is_current: false, description: null, display_order: p.experience.length }],
    }))

  const updateEdu = (i: number, e: ProfileEducation) =>
    setProfile((p) => { const edu = [...p.education]; edu[i] = e; return { ...p, education: edu } })
  const deleteEdu = (i: number) =>
    setProfile((p) => ({ ...p, education: p.education.filter((_, idx) => idx !== i) }))
  const addEdu = () =>
    setProfile((p) => ({
      ...p,
      education: [...p.education, { institution: '', degree: null, major: null, gpa: null, grad_year: null, grad_month: null, display_order: p.education.length }],
    }))

  return (
    <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <span style={{ color: 'var(--gold)', fontSize: '12px', fontWeight: 600 }}>PROFILE</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleGenerate}
            style={{ fontSize: '11px', padding: '4px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
          >
            Re-extract
          </button>
          <button
            onClick={handleSave}
            disabled={status === 'saving'}
            style={{ fontSize: '11px', padding: '4px 10px', background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
          >
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '10px' }}>Contact</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <Field label="First Name" value={profile.first_name} onChange={(v) => setProfile((p) => ({ ...p, first_name: v }))} />
        <Field label="Last Name" value={profile.last_name} onChange={(v) => setProfile((p) => ({ ...p, last_name: v }))} />
      </div>
      <Field label="Email" value={profile.email} onChange={(v) => setProfile((p) => ({ ...p, email: v }))} />
      <Field label="Phone" value={profile.phone ?? ''} onChange={set('phone')} />
      <Field label="LinkedIn URL" value={profile.linkedin_url ?? ''} onChange={set('linkedin_url')} />
      <Field label="Location" value={profile.location ?? ''} onChange={set('location')} />
      <Field label="Work Authorization" value={profile.work_auth ?? ''} onChange={set('work_auth')} />

      <div style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '14px 0 8px' }}>
        Experience
        <button onClick={addExp} style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
      </div>
      {profile.experience.map((e, i) => (
        <ExpCard key={i} entry={e} index={i} onChange={updateExp} onDelete={deleteExp} />
      ))}

      <div style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '14px 0 8px' }}>
        Education
        <button onClick={addEdu} style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
      </div>
      {profile.education.map((e, i) => (
        <EduCard key={i} entry={e} index={i} onChange={updateEdu} onDelete={deleteEdu} />
      ))}
    </div>
  )
}
