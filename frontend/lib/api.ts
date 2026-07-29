// frontend/lib/api.ts

export interface Job {
  id: string
  provider_id: string
  discovery: string
  company: string
  title: string
  url: string
  location: string | null
  posted_at: string | null
  first_seen_at: string
  last_seen_at: string
  tier: string
  status: string
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  trust_score: number | null
  trust_flags: string[] | null
}

/** Cursor-paginated. `total` is capped server-side, so `total_is_capped` means
 *  "at least this many" rather than an exact count. */
export interface JobsPage {
  items: Job[]
  next_cursor: string | null
  total: number
  total_is_capped: boolean
}

export interface JobFilters {
  companies: string[]
  providers: string[]
  tiers: string[]
}

export interface JobsParams {
  search?: string
  q?: string
  company?: string
  provider_id?: string
  tier?: string
  location?: string
  status?: string
  discovery?: string
  posted_after?: string
  salary_min?: number
  trust_min?: number
  has_description?: boolean
  cursor?: string
  limit?: number
}

export async function fetchJobs(params: JobsParams = {}): Promise<JobsPage> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v))
  })
  const res = await fetch(`/api/jobs?${q}`)
  if (!res.ok) throw new Error('Failed to fetch jobs')
  return res.json()
}

export async function fetchJobFilters(): Promise<JobFilters> {
  const res = await fetch('/api/jobs/filters')
  if (!res.ok) throw new Error('Failed to fetch filters')
  return res.json()
}

// ── Scanner ──────────────────────────────────────────────────────────
// Ingest filters: what the scanner is allowed to store. Distinct from the view
// filters above, which only narrow what is already in the database.

export interface ScanConfig {
  title_filter: { positive?: string[]; negative?: string[] } | null
  location_filter: { always_allow?: string[]; allow?: string[]; block?: string[] } | null
  content_filter: { positive?: string[]; negative?: string[] } | null
  visa_filter: { enabled?: boolean; require_mention?: boolean } | null
  salary_filter: { min?: number; max?: number; currency?: string } | null
  trust_filter: { enabled?: boolean } | null
  skip_tiers: string[] | null
  max_posting_age_days: number | null
  blocked_companies: string[] | null
  company_aliases: Record<string, string[]> | null
  since_days: number
  include_undated: boolean
  ats_sources: string[] | null
  limit_per_ats: number | null
  shuffle: boolean
  concurrency: number
}

export interface TrackedCompany {
  id: number
  name: string
  careers_url: string
  api_url: string | null
  provider: string | null
  enabled: boolean
  max_pages: number | null
  notes: string | null
  /** null means no provider claimed the careers URL — the entry will never scan. */
  resolved_provider: string | null
}

export interface ScanCounters {
  found: number
  filtered_blacklist: number
  filtered_title: number
  filtered_tier: number
  filtered_location: number
  filtered_posting_age: number
  filtered_posted_date: number
  filtered_salary: number
  filtered_content: number
  filtered_visa: number
  dropped_stale: number
  dropped_no_date: number
  dupes: number
  kept: number
}

export interface ScanRun extends ScanCounters {
  id: number
  started_at: string
  finished_at: string | null
  mode: string
  status: string
  dry_run: boolean
  companies: number
  new_added: number
  refreshed: number
  delisted: number
  errors: number
  companies_available: number
  companies_scanned: number
  cap_hit: boolean
  unreachable_boards: number
}

export interface BoardHealthRow {
  company: string
  status: string
  detail: string | null
  timestamp: string
  streak: number
}

export async function fetchScanConfig(): Promise<ScanConfig> {
  const res = await fetch('/api/scanner/config')
  if (!res.ok) throw new Error('Failed to fetch scanner config')
  return res.json()
}

export async function saveScanConfig(cfg: ScanConfig): Promise<ScanConfig> {
  const res = await fetch('/api/scanner/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error('Failed to save scanner config')
  return res.json()
}

export async function fetchCompanies(): Promise<TrackedCompany[]> {
  const res = await fetch('/api/scanner/companies')
  if (!res.ok) throw new Error('Failed to fetch companies')
  return res.json()
}

export async function saveCompany(data: Partial<TrackedCompany>): Promise<TrackedCompany> {
  const res = await fetch('/api/scanner/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to save company')
  return res.json()
}

export async function deleteCompany(id: number): Promise<void> {
  const res = await fetch(`/api/scanner/companies/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete company')
}

export async function fetchProviders(): Promise<string[]> {
  const res = await fetch('/api/scanner/providers')
  if (!res.ok) throw new Error('Failed to fetch providers')
  return (await res.json()).providers
}

export async function fetchRuns(): Promise<ScanRun[]> {
  const res = await fetch('/api/scanner/runs?limit=20')
  if (!res.ok) throw new Error('Failed to fetch runs')
  return res.json()
}

export async function fetchBoardHealth(): Promise<{ boards: BoardHealthRow[]; failing: BoardHealthRow[] }> {
  const res = await fetch('/api/scanner/health')
  if (!res.ok) throw new Error('Failed to fetch board health')
  return res.json()
}

export async function runScan(body: {
  mode?: string
  dry_run?: boolean
  seeds?: string[]
  since_days?: number
  ats_sources?: string[]
  limit_per_ats?: number
}): Promise<{ counters: ScanCounters; added: number; refreshed: number; delisted: number }> {
  const res = await fetch('/api/scanner/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Scan failed')
  return res.json()
}

/** Dry-run the ingest filters and report the funnel without writing anything. */
export async function previewScan(overrides: Partial<ScanConfig> & { limit_companies?: number }): Promise<{
  counters: ScanCounters
  samples: Record<string, { title: string; company: string; location: string; url: string }[]>
  companies_scanned: number
}> {
  const res = await fetch('/api/scanner/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  })
  if (!res.ok) throw new Error('Preview failed')
  return res.json()
}

export interface ResumeSummary {
  id: string
  filename: string
  uploaded_at: string
  section_count: number
}

export interface ResumeDetail {
  id: string
  filename: string
  uploaded_at: string
  sections: Record<string, string>
}

export async function fetchResumes(): Promise<ResumeSummary[]> {
  const res = await fetch('/api/resumes')
  if (!res.ok) throw new Error('Failed to fetch resumes')
  return res.json()
}

export async function fetchResume(id: string): Promise<ResumeDetail> {
  const res = await fetch(`/api/resumes/${id}`)
  if (!res.ok) throw new Error('Failed to fetch resume')
  return res.json()
}

export async function uploadResume(file: File): Promise<{ id: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/resumes', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Failed to upload resume')
  return res.json()
}

export async function deleteResume(id: string): Promise<void> {
  const res = await fetch(`/api/resumes/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete resume')
}

export function resumePdfUrl(id: string): string {
  return `/api/resumes/${id}/file`
}

/** @deprecated use runScan */
export async function runScraper(): Promise<void> {
  const res = await fetch('/api/scanner/run', { method: 'POST' })
  if (!res.ok) throw new Error('Scraper failed')
}

export interface ProfileExperience {
  id?: number
  company: string
  title: string
  location: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  display_order: number
}

export interface ProfileEducation {
  id?: number
  institution: string
  degree: string | null
  major: string | null
  gpa: string | null
  grad_year: string | null
  grad_month: string | null
  display_order: number
}

export interface Profile {
  resume_id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  linkedin_url: string | null
  location: string | null
  work_auth: string | null
  experience: ProfileExperience[]
  education: ProfileEducation[]
}

export async function fetchProfile(resumeId: string): Promise<Profile> {
  const res = await fetch(`/api/profile/${resumeId}`)
  if (!res.ok) throw new Error('Profile not found')
  return res.json()
}

export async function updateProfile(resumeId: string, data: Omit<Profile, 'resume_id'>): Promise<Profile> {
  const res = await fetch(`/api/profile/${resumeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update profile')
  return res.json()
}

export async function generateProfile(resumeId: string): Promise<Profile> {
  const res = await fetch(`/api/profile/${resumeId}/generate`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to generate profile')
  return res.json()
}


import type { UserInfo } from '@/lib/fields'
export type { UserInfo }

export async function fetchInfo(): Promise<UserInfo> {
  const res = await fetch('/api/info')
  if (!res.ok) throw new Error('Failed to load info')
  return res.json()
}

export async function updateInfo(data: UserInfo): Promise<UserInfo> {
  const res = await fetch('/api/info', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to save info')
  return res.json()
}
