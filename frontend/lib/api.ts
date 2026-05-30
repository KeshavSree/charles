// frontend/lib/api.ts

export interface Job {
  id: string
  source: string
  company: string
  title: string
  url: string
  location: string | null
  posted_at: string | null
  updated_at: string | null
  seniority: string
  scraped_at: string
}

export interface JobFilters {
  companies: string[]
  sources: string[]
}

export interface JobsParams {
  search?: string
  company?: string
  source?: string
  seniority?: string
  page?: number
  limit?: number
}

export async function fetchJobs(params: JobsParams = {}): Promise<Job[]> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
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

export async function runScraper(): Promise<void> {
  const res = await fetch('/api/scraper/run', { method: 'POST' })
  if (!res.ok) throw new Error('Scraper failed')
}

export interface ProfileExperience {
  id?: number
  company: string
  title: string
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
