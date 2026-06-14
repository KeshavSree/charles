import { FIELDS, FIELD_LABELS, UserInfo } from '../../frontend/lib/fields'
import type { FillRequest, FillSummary } from '../content/engine/types'

const API = 'http://localhost:8000'
const STORAGE_KEY = 'activeResumeId'

interface ResumeSummary { id: string; filename: string }

interface ResumeProfileExperience {
  company: string; title: string; location: string | null
  start_date: string | null; end_date: string | null
  is_current: boolean; description: string | null
  display_order: number
}

interface ResumeProfileEducation {
  institution: string; degree: string | null; major: string | null
  gpa: string | null; grad_year: string | null; display_order: number
}

interface ResumeProfile {
  first_name: string; last_name: string; email: string
  phone: string | null; linkedin_url: string | null
  location: string | null
  experience: ResumeProfileExperience[]
  education: ResumeProfileEducation[]
}

// FIELDS-driven merge: info fields win; resume profile fills anything left empty.
function mergeForFill(info: UserInfo, profile: ResumeProfile | null): UserInfo {
  const infoRec = info as unknown as Record<string, unknown>
  const profileRec = profile as unknown as Record<string, unknown> | null
  const result: Record<string, unknown> = {}
  for (const f of FIELDS) {
    const infoVal = infoRec[f.key]
    if (f.type === 'text') {
      const profileVal = f.profileKey && profileRec
        ? (profileRec[f.profileKey] ?? null)
        : null
      const merged = (infoVal as string | null) || (profileVal as string | null) || null
      result[f.key] = f.required ? (merged || '') : merged
    } else {
      result[f.key] = infoVal ?? f.defaultValue
    }
  }
  result.skills = info.skills ?? []
  result.websites = info.websites ?? []
  return result as unknown as UserInfo
}

// Build the plain-data fill request handed to the engine. No regex, no Workday ids —
// just values keyed by role, semantic experience/education entries, skills, and the
// resume PDF. The engine does all detection/classification using its bundled FIELDS.
function buildFillRequest(info: UserInfo, profile: ResumeProfile | null): FillRequest {
  const merged = mergeForFill(info, profile)
  const mergedRec = merged as unknown as Record<string, unknown>

  const values: Record<string, string | boolean | null> = {}
  for (const f of FIELDS) {
    const key = f.fillKey ?? f.key
    const raw = mergedRec[f.key]
    if (f.type === 'text') {
      values[key] = f.hardcodedFillValue ?? ((raw as string | null) ?? '')
    } else {
      values[key] = (raw as boolean | string | null) ?? null
    }
  }
  values['full_name'] = `${merged.first_name} ${merged.last_name}`.trim()

  const experience = profile?.experience
    ? [...profile.experience].sort((a, b) => a.display_order - b.display_order)
    : []
  const education = profile?.education
    ? [...profile.education].sort((a, b) => a.display_order - b.display_order)
    : []
  const skills = (merged.skills ?? []).filter(Boolean)
  const websites = (merged.websites ?? []).filter(Boolean)

  // resume is attached asynchronously by the click handler (needs the PDF bytes).
  return { values, experience, education, websites, skills, resume: null }
}

// Fetch the active resume's PDF and base64-encode it so it can ride along inside the
// executeScript args (Blobs/Files can't cross that boundary). Returns null on failure.
async function fetchResumeFile(resumeId: string, filename: string): Promise<{ base64: string; filename: string } | null> {
  try {
    const res = await fetch(`${API}/api/resumes/${resumeId}/file`)
    if (!res.ok) return null
    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return base64 ? { base64, filename } : null
  } catch {
    return null
  }
}

async function loadResumes(): Promise<ResumeSummary[]> {
  const res = await fetch(`${API}/api/resumes`)
  if (!res.ok) throw new Error('Cannot reach Charles API')
  return res.json()
}

function setStatus(msg: string, type: 'ok' | 'err' | '' = '') {
  const el = document.getElementById('status')!
  el.textContent = msg
  el.className = type
}

function showDetails(filledFields: string[], skippedFields: string[], doubleCheckFields: string[], needsYou: string[], didntLand: string[]) {
  const el = document.getElementById('details')!
  el.innerHTML = ''

  // Post-fill review summary — the per-field detail lives as outlines on the page.
  if (needsYou.length || didntLand.length) {
    const summary = document.createElement('div')
    const parts: string[] = []
    if (needsYou.length) parts.push(`🔴 ${needsYou.length} need you`)
    if (didntLand.length) parts.push(`🟠 ${didntLand.length} didn't land`)
    summary.textContent = `On the form: ${parts.join(' · ')} — outlined in the tab`
    summary.style.cssText = 'font-size:11px; color:#e2e8f0; margin-bottom:10px; padding:6px 8px; background:#1a1a2e; border:1px solid #2d2d4e; border-radius:4px;'
    el.appendChild(summary)
  }

  function renderSection(heading: string, cls: string, fields: string[], chipCls: string) {
    const section = document.createElement('div')
    section.className = 'detail-section'
    const h = document.createElement('div')
    h.className = `detail-heading ${cls}`
    h.textContent = heading
    section.appendChild(h)
    const list = document.createElement('div')
    list.className = 'chip-list'
    fields.forEach((k) => {
      const chip = document.createElement('span')
      chip.className = `chip ${chipCls}`
      chip.textContent = FIELD_LABELS[k] ?? k
      list.appendChild(chip)
    })
    section.appendChild(list)
    el.appendChild(section)
  }

  if (filledFields.length) renderSection(`✓ Filled (${filledFields.length})`, 'ok', filledFields, 'chip-ok')
  if (skippedFields.length) renderSection(`✗ Not filled (${skippedFields.length})`, 'err', skippedFields, 'chip-err')
  if (doubleCheckFields.length) renderSection(`⚠ Double-check (${doubleCheckFields.length})`, 'warn', doubleCheckFields, 'chip-warn')
}

async function init() {
  const select  = document.getElementById('resume-select') as HTMLSelectElement
  const fillBtn = document.getElementById('fill-btn') as HTMLButtonElement

  try {
    const resumes = await loadResumes()
    if (resumes.length) {
      select.innerHTML = resumes
        .map((r) => `<option value="${r.id}">${r.filename}</option>`)
        .join('')
      const stored = await chrome.storage.local.get(STORAGE_KEY)
      if (stored[STORAGE_KEY]) select.value = stored[STORAGE_KEY]
    } else {
      select.innerHTML = '<option value="">No resumes uploaded</option>'
    }
    fillBtn.disabled = resumes.length === 0
  } catch {
    setStatus('Cannot reach Charles API (is the backend running?)', 'err')
    select.innerHTML = '<option value="">Unavailable</option>'
  }

  select.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEY]: select.value })
  })

  fillBtn.addEventListener('click', async () => {
    const resumeId = select.value
    if (!resumeId) return

    fillBtn.disabled = true
    setStatus('loading...')

    const progressListener = (msg: { type: string; msg: string }) => {
      if (msg.type === 'charles:progress') setStatus(msg.msg)
    }
    chrome.runtime.onMessage.addListener(progressListener)

    try {
      const [infoRes, profileRes] = await Promise.all([
        fetch(`${API}/api/info`),
        fetch(`${API}/api/profile/${resumeId}`),
      ])

      if (!infoRes.ok) throw new Error(`Cannot load Info (${infoRes.status}) — fill in your Info page`)
      const info: UserInfo = await infoRes.json()
      const profile: ResumeProfile | null = profileRes.ok ? await profileRes.json() : null

      const request = buildFillRequest(info, profile)
      const filename = select.options[select.selectedIndex]?.text ?? 'resume.pdf'
      request.resume = await fetchResumeFile(resumeId, filename)

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')

      // Inject the bundled engine (a real module graph), then invoke it via a tiny
      // bridge func that returns the summary. Both run in the same isolated world,
      // so the second call sees globalThis.__charlesEngine set by the first.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['dist/content/engine.js'],
      })
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (req) => (globalThis as unknown as {
          __charlesEngine: { run: (r: FillRequest) => Promise<FillSummary> }
        }).__charlesEngine.run(req),
        args: [request],
      })

      const summary = result as FillSummary
      setStatus(
        `Filled ${summary.filled} field(s)${summary.skipped ? `, skipped ${summary.skipped}` : ''}`,
        summary.filled > 0 ? 'ok' : 'err',
      )
      showDetails(summary.filledFields, summary.skippedFields, summary.doubleCheckFields, summary.needsYou, summary.didntLand)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      chrome.runtime.onMessage.removeListener(progressListener)
    }

    fillBtn.disabled = false
  })
}

init()
