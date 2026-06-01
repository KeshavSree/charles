'use client'
import { useEffect, useState, useRef, KeyboardEvent } from 'react'
import { FIELDS, EMPTY_USER_INFO, UserInfo } from '@/lib/fields'
import { fetchInfo, updateInfo } from '@/lib/api'

const TEXT_FIELDS = FIELDS
  .filter((f) => f.type === 'text')
  .map((f) => ({ key: f.key as keyof UserInfo, label: f.label, type: f.inputType }))

const BOOL_FIELDS = FIELDS
  .filter((f) => f.type === 'bool')
  .map((f) => ({ key: f.key as keyof UserInfo, label: f.label }))

const STRING_APP_FIELDS = FIELDS
  .filter((f) => f.type === 'string-enum')
  .map((f) => ({ key: f.key as keyof UserInfo, label: f.label }))

const EMPTY = EMPTY_USER_INFO

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

function SkillsInput({ skills, onChange, disabled }: { skills: string[]; onChange: (s: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function add() {
    const s = draft.trim()
    if (s && !skills.includes(s)) onChange([...skills, s])
    setDraft('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && draft === '' && skills.length) {
      onChange(skills.slice(0, -1))
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
        minHeight: '36px', padding: '4px 8px',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: '4px', cursor: 'text',
      }}
    >
      {skills.map((s) => (
        <span key={s} style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'var(--accent)', color: '#fff',
          fontSize: '11px', padding: '2px 8px', borderRadius: '99px',
        }}>
          {s}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(skills.filter((x) => x !== s)) }}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: '12px', lineHeight: 1 }}
            >×</button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        disabled={disabled}
        placeholder={skills.length === 0 ? 'Type a skill, press Enter' : ''}
        style={{ flex: '1 1 120px', minWidth: '80px', background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: '12px', padding: '2px 0' }}
      />
    </div>
  )
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

  const setBool = (key: keyof UserInfo) => (v: boolean | null) =>
    setInfo((prev) => ({ ...prev, [key]: v }))

  const setStr = (key: keyof UserInfo) =>
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
            value={info[key] as boolean | null}
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
            value={(info[key] as string | null) ?? ''}
            onChange={setStr(key)}
            disabled={loading}
            style={inputStyle}
          />
        </div>
      ))}

      <div style={{ marginTop: '28px', marginBottom: '16px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', margin: 0 }}>
          SKILLS
        </h2>
      </div>
      <div style={{ marginBottom: '14px' }}>
        <SkillsInput
          skills={info.skills ?? []}
          onChange={(s) => setInfo((prev) => ({ ...prev, skills: s }))}
          disabled={loading}
        />
      </div>

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
