'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import FilterBar from '@/components/FilterBar'
import JobsTable from '@/components/JobsTable'
import { fetchJobFilters, fetchJobs, Job, JobFilters, runScan } from '@/lib/api'

const btnStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '4px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
}

const PAGE_SIZE = 50

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [filters, setFilters] = useState<JobFilters>({ companies: [], providers: [], tiers: [] })
  const [values, setValues] = useState<Record<string, string>>({ status: 'active' })
  const [total, setTotal] = useState(0)
  const [capped, setCapped] = useState(false)
  // Keyset pagination: we keep the stack of cursors we've walked so "Prev" can
  // pop back. Offsets would be simpler but degrade badly — the directory sweep
  // makes tens of thousands of rows, and OFFSET 20000 scans 20,000 rows to
  // throw them away.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [scanStatus, setScanStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')

  useEffect(() => {
    fetchJobFilters().then(setFilters).catch(console.error)
  }, [])

  const cursor = cursorStack[cursorStack.length - 1]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchJobs({ ...values, cursor: cursor ?? undefined, limit: PAGE_SIZE })
      setJobs(page.items)
      setNextCursor(page.next_cursor)
      setTotal(page.total)
      setCapped(page.total_is_capped)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [values, cursor])

  useEffect(() => {
    load()
  }, [load])

  function handleFilter(key: string, value: string) {
    setCursorStack([null]) // any filter change restarts pagination
    setValues((v) => ({ ...v, [key]: value }))
  }

  async function handleScan() {
    setScanStatus('running')
    try {
      await runScan({ mode: 'tracked' })
      setScanStatus('done')
      await fetchJobFilters().then(setFilters).catch(console.error)
      setCursorStack([null])
      await load()
      setTimeout(() => setScanStatus('idle'), 3000)
    } catch {
      setScanStatus('error')
      setTimeout(() => setScanStatus('idle'), 3000)
    }
  }

  const pageNum = cursorStack.length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h1 style={{ fontSize: '15px', fontWeight: 600 }}>
          Jobs{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 400 }}>
            {loading ? 'loading…' : `(${total}${capped ? '+' : ''})`}
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/scanner" style={{ ...btnStyle, textDecoration: 'none' }}>
            ⚙ Scanner
          </Link>
          <button
            onClick={handleScan}
            disabled={scanStatus === 'running'}
            style={{
              ...btnStyle,
              color: scanStatus === 'done' ? 'var(--gold)' : scanStatus === 'error' ? '#f87171' : 'var(--text)',
              opacity: scanStatus === 'running' ? 0.6 : 1,
            }}
          >
            {scanStatus === 'idle' && '↻ Scan Now'}
            {scanStatus === 'running' && 'Scanning…'}
            {scanStatus === 'done' && '✓ Done'}
            {scanStatus === 'error' && '✗ Failed'}
          </button>
        </div>
      </div>

      <FilterBar
        companies={filters.companies}
        providers={filters.providers}
        tiers={filters.tiers}
        values={values}
        onChange={handleFilter}
      />
      <JobsTable jobs={jobs} />

      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => setCursorStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
          disabled={pageNum === 1}
          style={{ ...btnStyle, opacity: pageNum === 1 ? 0.4 : 1 }}
        >
          ← Prev
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Page {pageNum}</span>
        <button
          onClick={() => nextCursor && setCursorStack((s) => [...s, nextCursor])}
          disabled={!nextCursor}
          style={{ ...btnStyle, opacity: nextCursor ? 1 : 0.4 }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
