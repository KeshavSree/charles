'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/jobs', label: 'Jobs' },
  { href: '/info', label: 'Info' },
  { href: '/resumes', label: 'Resumes' },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <nav
      style={{
        width: '180px',
        flexShrink: 0,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <div
        style={{
          padding: '14px',
          color: 'var(--accent-dim)',
          fontWeight: 700,
          fontSize: '13px',
          letterSpacing: '.08em',
          borderBottom: '1px solid var(--border)',
        }}
      >
        CHARLES
      </div>
      {NAV.map(({ href, label }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            style={{
              display: 'block',
              padding: '9px 14px',
              color: active ? 'var(--accent-dim)' : 'var(--text-muted)',
              borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              background: active ? 'var(--surface-2)' : 'transparent',
              fontSize: '13px',
            }}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
