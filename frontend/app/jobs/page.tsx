'use client'
import { useCallback, useEffect, useState } from 'react'
import FilterBar from '@/components/FilterBar'
import JobsTable from '@/components/JobsTable'
import { fetchJobFilters, fetchJobs, Job, JobFilters, runScraper } from '@/lib/api'

const btnStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '4px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [filters, setFilters] = useState<JobFilters>({ companies: [], sources: [] })
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('')
  const [source, setSource] = useState('')
  const [seniority, setSeniority] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [scrapeStatus, setScrapeStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')

  useEffect(() => {
    fetchJobFilters().then(setFilters).catch(console.error)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchJobs({ search, company, source, seniority, page })
      setJobs(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, company, source, seniority, page])

  useEffect(() => {
    load()
  }, [load])

  async function handleRunScraper() {
    setScrapeStatus('running')
    try {
      await runScraper()
      setScrapeStatus('done')
      await fetchJobFilters().then(setFilters).catch(console.error)
      await load()
      setTimeout(() => setScrapeStatus('idle'), 3000)
    } catch {
      setScrapeStatus('error')
      setTimeout(() => setScrapeStatus('idle'), 3000)
    }
  }

  function handleFilter(key: string, value: string) {
    setPage(1)
    if (key === 'search') setSearch(value)
    if (key === 'company') setCompany(value)
    if (key === 'source') setSource(value)
    if (key === 'seniority') setSeniority(value)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h1 style={{ fontSize: '15px', fontWeight: 600 }}>
          Jobs{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 400 }}>
            {loading ? 'loading…' : `(${jobs.length})`}
          </span>
        </h1>
        <button
          onClick={handleRunScraper}
          disabled={scrapeStatus === 'running'}
          style={{
            ...btnStyle,
            color: scrapeStatus === 'done' ? 'var(--gold)' : scrapeStatus === 'error' ? '#f87171' : 'var(--text)',
            opacity: scrapeStatus === 'running' ? 0.6 : 1,
            cursor: scrapeStatus === 'running' ? 'default' : 'pointer',
          }}
        >
          {scrapeStatus === 'idle' && '↻ Scrape Jobs'}
          {scrapeStatus === 'running' && 'Scraping…'}
          {scrapeStatus === 'done' && '✓ Done'}
          {scrapeStatus === 'error' && '✗ Failed'}
        </button>
      </div>
      <FilterBar
        companies={filters.companies}
        sources={filters.sources}
        search={search}
        company={company}
        source={source}
        seniority={seniority}
        onChange={handleFilter}
      />
      <JobsTable jobs={jobs} />
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          style={btnStyle}
        >
          ← Prev
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={jobs.length < 100}
          style={btnStyle}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
