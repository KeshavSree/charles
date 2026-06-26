'use client'
import { useEffect, useState, useRef, KeyboardEvent } from 'react'
import { FIELDS, EMPTY_USER_INFO, UserInfo } from '@/lib/fields'
import { fetchInfo, updateInfo, fetchResumes, fetchProfile } from '@/lib/api'

// Excludes derived text fields (current_employer/current_title) — those are computed by
// the extension from the résumé at fill time, so there's nothing for the user to edit here.
const TEXT_FIELDS = FIELDS
  .filter((f) => f.type === 'text' && !f.derived)
  .map((f) => ({ key: f.key as keyof UserInfo, label: f.label, type: f.inputType }))

// Personal = non-link text fields (name, email, phone, address…). Links = url-typed.
const PERSONAL_FIELDS = TEXT_FIELDS.filter((f) => f.type !== 'url')
const LINK_FIELDS = TEXT_FIELDS.filter((f) => f.type === 'url')

// doubleCheck fields show "(Default)" — the extension fills them with a best-guess default.
// Aggressive fields go in the gated Aggressive Fill section; derived fields (engine-computed
// from the résumé, e.g. degree_pursuing/grad_date) have no user control and are excluded.
const BOOL_FIELDS = FIELDS
  .filter((f) => f.type === 'bool' && !f.aggressive && !f.derived)
  .map((f) => ({ key: f.key as keyof UserInfo, label: f.doubleCheck ? `${f.label} (Default)` : f.label }))

const STRING_APP_FIELDS = FIELDS
  .filter((f) => f.type === 'string-enum' && !f.aggressive && !f.derived)
  .map((f) => ({ key: f.key as keyof UserInfo, label: f.label, options: f.options }))

// Editable aggressive fields (derived ones are computed by the engine, not shown here).
const AGGRESSIVE_BOOL_FIELDS = FIELDS
  .filter((f) => f.aggressive && !f.derived && f.type === 'bool')
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

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        padding: '4px 16px',
        fontSize: '12px',
        fontWeight: 600,
        background: on ? 'var(--accent)' : 'var(--surface-2)',
        color: on ? '#fff' : 'var(--text-muted)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '999px',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {on ? 'On' : 'Off'}
    </button>
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: 'var(--text-muted)',
  marginBottom: '4px',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <h2 style={{
        color: 'var(--gold)', fontSize: '12px', fontWeight: 700, letterSpacing: '.08em',
        margin: '0 0 14px', paddingBottom: '8px', borderBottom: '1px solid var(--border)',
      }}>
        {title}
      </h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '14px 20px',
        alignItems: 'start',
      }}>
        {children}
      </div>
    </section>
  )
}

// A field cell spanning the full row (for chip inputs that need horizontal room).
const fullRow: React.CSSProperties = { gridColumn: '1 / -1' }

function ChipInput({ items, onChange, disabled, placeholder }: { items: string[]; onChange: (s: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function add() {
    const s = draft.trim()
    if (s && !items.includes(s)) onChange([...items, s])
    setDraft('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && draft === '' && items.length) {
      onChange(items.slice(0, -1))
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
      {items.map((s) => (
        <span key={s} style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'var(--accent)', color: '#fff',
          fontSize: '11px', padding: '2px 8px', borderRadius: '99px',
        }}>
          {s}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(items.filter((x) => x !== s)) }}
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
        placeholder={items.length === 0 ? (placeholder ?? '') : ''}
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
      .then(async (d) => {
        setInfo(d)
        setStatus('idle')
        // Seed the "companies you've worked at" list from the résumé if unset, so the
        // aggressive "have you worked here?" answer works out of the box (editable).
        if (!d.worked_companies?.length) {
          try {
            const resumes = await fetchResumes()
            if (!resumes.length) return
            const newest = [...resumes].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0]
            const profile = await fetchProfile(newest.id)
            const companies = Array.from(new Set(profile.experience.map((e) => e.company).filter(Boolean)))
            if (companies.length) setInfo((prev) => ({ ...prev, worked_companies: companies }))
          } catch { /* no generated profile — leave the list empty */ }
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  const setText = (key: keyof UserInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInfo((prev) => ({ ...prev, [key]: e.target.value || null }))

  const setBool = (key: keyof UserInfo) => (v: boolean | null) =>
    setInfo((prev) => ({ ...prev, [key]: v }))

  const setStr = (key: keyof UserInfo) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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

  // One text field cell (grid gap handles spacing).
  const textField = ({ key, label, type }: { key: keyof UserInfo; label: string; type?: string }) => (
    <div key={key}>
      <label style={labelStyle}>{label}</label>
      <input
        type={type ?? 'text'}
        value={(info[key] as string | null) ?? ''}
        onChange={setText(key)}
        disabled={loading}
        style={inputStyle}
      />
    </div>
  )

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
        <h1 style={{ color: 'var(--text)', fontSize: '15px', fontWeight: 700, letterSpacing: '.04em', margin: 0 }}>
          Info
        </h1>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Used by the extension to fill application forms
        </span>
      </div>

      <Section title="PERSONAL INFO">
        {PERSONAL_FIELDS.map(textField)}
      </Section>

      <Section title="LINKS & SKILLS">
        {LINK_FIELDS.map(textField)}
        <div style={fullRow}>
          <label style={labelStyle}>Skills</label>
          <ChipInput
            items={info.skills ?? []}
            onChange={(s) => setInfo((prev) => ({ ...prev, skills: s }))}
            disabled={loading}
            placeholder="Type a skill, press Enter"
          />
        </div>
      </Section>

      <Section title="COMMON APPLICATION QUESTIONS">
        {BOOL_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label style={labelStyle}>{label}</label>
            <BoolPicker
              value={info[key] as boolean | null}
              onChange={setBool(key)}
              disabled={loading}
            />
          </div>
        ))}
        {STRING_APP_FIELDS.map(({ key, label, options }) => (
          <div key={key}>
            <label style={labelStyle}>{label}</label>
            {options ? (
              <select
                value={(info[key] as string | null) ?? ''}
                onChange={setStr(key)}
                disabled={loading}
                style={inputStyle}
              >
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={(info[key] as string | null) ?? ''}
                onChange={setStr(key)}
                disabled={loading}
                style={inputStyle}
              />
            )}
          </div>
        ))}
      </Section>

      <Section title="AGGRESSIVE FILL">
        <div style={{ ...fullRow, display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <Toggle
            on={info.aggressive_fill}
            onChange={(v) => setInfo((prev) => ({ ...prev, aggressive_fill: v }))}
            disabled={loading}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            When on, the extension answers the questions below — e.g. “have you worked here?” and privacy consent.
          </span>
        </div>

        <div style={{
          ...fullRow,
          opacity: info.aggressive_fill ? 1 : 0.5,
          pointerEvents: info.aggressive_fill ? 'auto' : 'none',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '14px 20px',
            alignItems: 'start',
          }}>
            <div style={fullRow}>
              <label style={labelStyle}>Companies you’ve worked at</label>
              <ChipInput
                items={info.worked_companies ?? []}
                onChange={(s) => setInfo((prev) => ({ ...prev, worked_companies: s }))}
                disabled={!info.aggressive_fill || loading}
                placeholder="Add a company, press Enter"
              />
              <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Auto-answers “have you worked at &lt;company&gt;?” — seeded from your résumé, edit as needed.
              </span>
            </div>
            {AGGRESSIVE_BOOL_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <BoolPicker
                  value={info[key] as boolean | null}
                  onChange={setBool(key)}
                  disabled={!info.aggressive_fill || loading}
                />
              </div>
            ))}
          </div>
        </div>
      </Section>

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
