// frontend/lib/api.ts

export interface Job {
  id: string
  provider_id: string
  source_id: string
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
  sources: string[]
}

export interface JobsParams {
  search?: string
  q?: string
  company?: string
  provider_id?: string
  source_id?: string
  tier?: string
  location?: string
  status?: string
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

/** Rejects a posting so it stops appearing in the list, surviving future scans.
 *  `restore` puts it back to active. */
export async function dismissJob(jobId: string, restore = false): Promise<Job> {
  const res = await fetch(`/api/jobs/${jobId}/dismiss${restore ? '?restore=true' : ''}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to dismiss job')
  return res.json()
}

/** Deletes the jobs matching `params`, except any in the pipeline. Not undoable. */
export async function purgeListedJobs(params: JobsParams = {}): Promise<{ deleted: number }> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v))
  })
  const res = await fetch(`/api/jobs/purge?${q}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to purge jobs')
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
  /** Tiers to KEEP. Empty means every tier passes. */
  seniority_tiers: string[] | null
  max_posting_age_days: number | null
  blocked_companies: string[] | null
  company_aliases: Record<string, string[]> | null
  include_undated: boolean
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
  boards_skipped_dead?: number
  drops?: DropBreakdown
  started_at: string
  finished_at: string | null
  source_id: string
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

export async function purgeJobs(): Promise<{ deleted: number }> {
  const res = await fetch('/api/scanner/purge', { method: 'POST' })
  if (!res.ok) throw new Error('Purge failed')
  return res.json()
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

/** One row per source that ran. `all: true` runs every enabled source. */
/** Per stage, what its drops group by and the most common values. */
export interface DropBreakdown {
  [stage: string]: { by: string; items: { label: string; count: number }[] }
}

export interface SourceRun {
  source_id: string
  label?: string
  counters: ScanCounters
  drops?: DropBreakdown
  added: number
  refreshed: number
  delisted: number
  errors?: { company: string; error: string; kind?: string }[]
  companies_scanned?: number
  companies_available?: number
  cap_hit?: boolean
  error?: string
}

export interface ScannerSource {
  id: string
  label: string
  profile: 'tracked' | 'reverse'
  enabled: boolean
  settings: Record<string, unknown>
  last_run: {
    started_at: string
    status: string
    found: number
    kept: number
    new_added: number
    errors: number
  } | null
}

export async function fetchSources(): Promise<ScannerSource[]> {
  const res = await fetch('/api/scanner/sources')
  if (!res.ok) throw new Error('Failed to fetch sources')
  return res.json()
}

export async function saveSource(
  id: string,
  body: { enabled?: boolean; settings?: Record<string, unknown> },
): Promise<ScannerSource> {
  const res = await fetch(`/api/scanner/sources/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to save source')
  return res.json()
}

export interface ScanStage {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  done: number
  added?: number
  /** null when the source never declares a denominator (single-request feeds). */
  total: number | null
  /** null means indeterminate — render a pulsing bar, not a 0% one. */
  fraction: number | null
  found: number
  kept: number
  elapsed: number | null
}

export interface ScanProgress {
  /** The server's answer to "is a scan happening", never a tab's local guess. */
  active: boolean
  run_id: string | null
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  elapsed?: number
  started_at?: number
  stage_index?: number
  stage_count?: number
  completed?: number
  kept?: number
  added?: number
  current?: (ScanStage & { detail: string }) | null
  stages: ScanStage[]
}

export async function cancelScan(): Promise<ScanProgress & { cancelled: boolean }> {
  const res = await fetch('/api/scanner/cancel', { method: 'POST' })
  if (!res.ok) throw new Error('Failed to cancel scan')
  return res.json()
}

export async function getScanProgress(): Promise<ScanProgress> {
  const res = await fetch('/api/scanner/progress')
  if (!res.ok) throw new Error('Failed to load scan progress')
  return res.json()
}

export async function runScan(body: {
  source_id?: string
  all?: boolean
  dry_run?: boolean
  max_posting_age_days?: number
}): Promise<ScanProgress & { started: boolean; reason?: string }> {
  const res = await fetch('/api/scanner/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to start scan')
  // 202 with the run's id. The sweep keeps going regardless of this tab; its state is
  // read from /scanner/progress, so nothing here can time out or desync.
  return res.json()
}

/** Dry-run the ingest filters and report the funnel without writing anything. */
export async function previewScan(overrides: Partial<ScanConfig> & { source_id?: string; limit_companies?: number }): Promise<{
  counters: ScanCounters
  drops: DropBreakdown
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
  github_url: string | null
  website: string | null
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

// ── Pipeline ────────────────────────────────────────────────────────

/** In order. Mirrors PIPELINE_STAGES in storage/models.py — index position is the
 *  ordering, so "advance" is +1 and the two lists must not drift. */
export const PIPELINE_STAGES = ['interested', 'contacted', 'applied', 'oa', 'interview', 'final'] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const STAGE_LABELS: Record<PipelineStage, string> = {
  interested: 'Interested',
  contacted: 'Contacted',
  applied: 'Applied',
  oa: 'OA',
  interview: 'Interview Process',
  final: 'Final',
}

/** Results recorded on a Final entry. Not stages. */
export const PIPELINE_OUTCOMES = ['offer', 'rejected'] as const
export type PipelineOutcome = (typeof PIPELINE_OUTCOMES)[number]

/** A pipeline entry flattened together with the job it points at. */
export interface PipelineJob {
  job_id: string
  stage: PipelineStage
  outcome: PipelineOutcome | null
  /** Set at the Contacted stage, carried through every stage after it. */
  contact_email: string | null
  notes: string | null
  added_at: string
  /** Last time the user touched this entry — moved it, set a result, logged a contact. */
  last_interacted_at: string
  company: string
  title: string
  url: string
  location: string | null
  provider_id: string
  tier: string
  status: string
  posted_at: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
}

export interface PipelinePage {
  items: PipelineJob[]
  counts: Record<string, number>
  stages: PipelineStage[]
}

export async function fetchPipeline(stage?: PipelineStage): Promise<PipelinePage> {
  const res = await fetch(`/api/pipeline${stage ? `?stage=${stage}` : ''}`)
  if (!res.ok) throw new Error('Failed to load pipeline')
  return res.json()
}

export async function addToPipeline(jobId: string): Promise<PipelineJob> {
  const res = await fetch('/api/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId }),
  })
  if (!res.ok) throw new Error('Failed to add to pipeline')
  return res.json()
}

export async function updatePipelineEntry(
  jobId: string,
  patch: {
    stage?: PipelineStage
    outcome?: PipelineOutcome
    notes?: string
    /** Empty string clears it; omitting the key leaves it alone. */
    contact_email?: string
    clear_outcome?: boolean
  },
): Promise<PipelineJob> {
  const res = await fetch(`/api/pipeline/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Failed to update pipeline entry')
  return res.json()
}

export async function removeFromPipeline(jobId: string): Promise<void> {
  const res = await fetch(`/api/pipeline/${jobId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to remove from pipeline')
}
