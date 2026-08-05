'use client'
import { useRef, useState } from 'react'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  padding: '1px 4px 1px 6px',
  fontSize: 11,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
}

const removeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: '0 1px',
}

/**
 * Comma-separated keyword entry rendered as removable chips.
 *
 * The container wraps and grows with its contents rather than scrolling a single
 * line, because these lists routinely run to 20+ keywords and a filter you cannot
 * fully see is a filter you cannot reason about.
 */
export default function TagInput({ value, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function commit(raw: string) {
    // Splitting here (not only on keypress) means a pasted "a, b, c" lands as
    // three tags rather than one.
    const added = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (!added.length) return
    const seen = new Set(value.map((t) => t.toLowerCase()))
    const next = [...value]
    for (const tag of added) {
      if (seen.has(tag.toLowerCase())) continue
      seen.add(tag.toLowerCase())
      next.push(tag)
    }
    onChange(next)
    setDraft('')
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 4,
        minHeight: 30,
        cursor: 'text',
      }}
    >
      {value.map((tag, i) => (
        <span key={`${tag}-${i}`} style={chip}>
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            style={removeBtn}
            onClick={(e) => {
              e.stopPropagation()
              onChange(value.filter((_, j) => j !== i))
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          if (e.target.value.includes(',')) commit(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        // Commit on blur so a half-typed keyword is not silently lost when the
        // user clicks straight to Save.
        onBlur={() => commit(draft)}
        style={{
          flex: 1,
          minWidth: 90,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontSize: 12,
          padding: '2px 3px',
        }}
      />
    </div>
  )
}
