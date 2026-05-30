'use client'
import { useEffect, useState } from 'react'
import { UserInfo, fetchInfo, updateInfo } from '@/lib/api'

const TEXT_FIELDS: { key: keyof UserInfo; label: string; type?: string }[] = [
  { key: 'first_name',   label: 'First Name' },
  { key: 'last_name',    label: 'Last Name' },
  { key: 'email',        label: 'Email', type: 'email' },
  { key: 'phone',        label: 'Phone', type: 'tel' },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
  { key: 'address',      label: 'Address' },
  { key: 'city',         label: 'City' },
  { key: 'state',        label: 'State' },
  { key: 'zip_code',     label: 'Zip Code' },
  { key: 'country',      label: 'Country' },
  { key: 'work_auth',    label: 'Work Authorization' },
]

const BOOL_FIELDS: { key: 'work_authorized' | 'requires_sponsorship'; label: string }[] = [
  { key: 'work_authorized',     label: 'Work Authorized?' },
  { key: 'requires_sponsorship', label: 'Requires Sponsorship?' },
]

const STRING_APP_FIELDS: { key: 'gender' | 'ethnicity' | 'veteran_status' | 'disability_status'; label: string }[] = [
  { key: 'gender',           label: 'Gender' },
  { key: 'ethnicity',        label: 'Race / Ethnicity' },
  { key: 'veteran_status',   label: 'Veteran Status' },
  { key: 'disability_status', label: 'Disability Status' },
]

const EMPTY: UserInfo = {
  first_name: '', last_name: '', email: '',
  phone: null, linkedin_url: null,
  address: null, city: null, state: null, zip_code: null, country: null,
  work_auth: null,
  work_authorized: null, requires_sponsorship: null,
  gender: null, ethnicity: null, veteran_status: null, disability_status: null,
}

function BoolPicker({
  value,
  onChange,
  disabled,
}: {
  value: boolean | null
  onChange: (v: boolean | null) => void
  disabled?: boolean
}) {
  const options: { label: string; val: boolean | null }[] = [
    { label: 'Yes', val: true },
    { label: 'No',  val: false },
    { label: '—',   val: null },
  ]
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      {options.map(({ label, val }) => {
        const active = value === val
        return (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(val)}
            style={{
              padding: '4px 14px',
              fontSize: '12px',
              fontWeight: active ? 600 : 400,
              background: active ? 'var(--accent)' : 'var(--surface-2)',
              color: active ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '4px',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  color: 'var(--text)',
  fontSize: '13px',
  boxSizing: 'border-box',
}

export default function InfoPage() {
  const [info, setInfo] = useState<UserInfo>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading')

  useEffect(() => {
    fetchInfo()
      .then((d) => { setInfo(d); setStatus('idle') })
      .catch(() => setStatus('error'))
  }, [])

  const setText = (key: keyof UserInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInfo((prev) => ({ ...prev, [key]: e.target.value || null }))

  const setBool = (key: 'work_authorized' | 'requires_sponsorship') => (v: boolean | null) =>
    setInfo((prev) => ({ ...prev, [key]: v }))

  const setStr = (key: 'gender' | 'ethnicity' | 'veteran_status' | 'disability_status') =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setInfo((prev) => ({ ...prev, [key]: e.target.value || null }))

  async function handleSave() {
    setStatus('saving')
    try {
      const updated = await updateInfo(info)
      setInfo(updated)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('error')
    }
  }

  const loading = status === 'loading'

  return (
    <div style={{ padding: '32px', maxWidth: '480px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
        <h1 style={{ color: 'var(--gold)', fontSize: '13px', fontWeight: 700, letterSpacing: '.08em', margin: 0 }}>
          INFO
        </h1>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Used by the extension to fill application forms
        </span>
      </div>

      {TEXT_FIELDS.map(({ key, label, type }) => (
        <div key={key} style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            {label}
          </label>
          <input
            type={type ?? 'text'}
            value={info[key] as string ?? ''}
            onChange={setText(key)}
            disabled={loading}
            style={inputStyle}
          />
        </div>
      ))}

      <div style={{ marginTop: '28px', marginBottom: '16px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', margin: 0 }}>
          APPLICATION QUESTIONS
        </h2>
      </div>

      {BOOL_FIELDS.map(({ key, label }) => (
        <div key={key} style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '180px' }}>
            {label}
          </label>
          <BoolPicker
            value={info[key]}
            onChange={setBool(key)}
            disabled={loading}
          />
        </div>
      ))}

      {STRING_APP_FIELDS.map(({ key, label }) => (
        <div key={key} style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            {label}
          </label>
          <input
            type="text"
            value={info[key] ?? ''}
            onChange={setStr(key)}
            disabled={loading}
            style={inputStyle}
          />
        </div>
      ))}

      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleSave}
          disabled={status === 'saving' || loading}
          style={{
            padding: '7px 20px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && (
          <span style={{ fontSize: '12px', color: 'var(--gold)' }}>Saved</span>
        )}
        {status === 'error' && (
          <span style={{ fontSize: '12px', color: '#f87171' }}>Something went wrong</span>
        )}
      </div>
    </div>
  )
}
