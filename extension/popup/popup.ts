import { FIELDS, FIELD_LABELS, UserInfo } from '../../frontend/lib/fields'
import type { FillRequest, FillSummary } from '../content/engine/types'
import { deriveDegreePursuing, deriveGradDate } from '../content/engine/values'

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
  gpa: string | null; grad_year: string | null; grad_month: string | null; display_order: number
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

const END_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// Recency rank for an experience entry's end date. A current role (or an end date of
// "Present"/"Current") ranks highest; otherwise rank by parsed year*100 + month.
// Absent/unparseable end dates rank lowest so any dated job outranks them.
function endRank(e: ResumeProfileExperience): number {
  if (e.is_current) return Number.POSITIVE_INFINITY
  const s = (e.end_date ?? '').toLowerCase()
  if (!s) return -1
  if (/present|current/.test(s)) return Number.POSITIVE_INFINITY
  const yr = s.match(/(?:19|20)\d{2}/)
  if (!yr) return -1
  const month = Object.keys(END_MONTHS).find((m) => s.includes(m))
  return parseInt(yr[0], 10) * 100 + (month ? END_MONTHS[month] : 0)
}

// The résumé's "current or previous" job: a current role if any, else the entry with the
// most recent end date. Ties break toward the earlier display_order (résumé order).
function deriveCurrentJob(experience: ResumeProfileExperience[]): ResumeProfileExperience | null {
  if (!experience.length) return null
  return [...experience].sort((a, b) => endRank(b) - endRank(a) || a.display_order - b.display_order)[0]
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

  // Chosen / preferred name — the user's set value, else fall back to their first name so a
  // required "Chosen Name" field still fills.
  values['chosen_name'] = (merged.chosen_name || merged.first_name || '').trim()

  // Current/previous employer + job title — derived from the résumé's most-recent job
  // (computed here like full_name, not stored). Empty string when there's no experience.
  const currentJob = deriveCurrentJob(profile?.experience ?? [])
  values['current_employer'] = currentJob?.company ?? ''
  values['current_title'] = currentJob?.title ?? ''

  const experience = profile?.experience
    ? [...profile.experience].sort((a, b) => a.display_order - b.display_order)
    : []
  const education = profile?.education
    ? [...profile.education].sort((a, b) => a.display_order - b.display_order)
    : []

  // Résumé-derived answers — computed here (need only the parsed education) and filled by the
  // engine like any stored value. Replaces the old fill-time VALUE_DERIVATIONS.
  values['degree_pursuing'] = deriveDegreePursuing(education)
  values['grad_date'] = deriveGradDate(education)
  values['school'] = education[0]?.institution ?? ''
  const skills = (merged.skills ?? []).filter(Boolean)
  const websites = (merged.websites ?? []).filter(Boolean)

  // Aggressive-fill settings live on UserInfo directly (not in the FIELDS-driven values).
  const aggressive = info.aggressive_fill ?? false
  const workedCompanies = (info.worked_companies ?? []).filter(Boolean)

  // resume is attached asynchronously by the click handler (needs the PDF bytes).
  return { values, experience, education, websites, skills, resume: null, aggressive, workedCompanies }
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

function showDetails(filledFields: string[], doubleCheckFields: string[], unanswered: string[], didntLand: string[], questions: Record<string, string>) {
  const el = document.getElementById('details')!
  el.innerHTML = ''

  // Filled / double-check chips are role-keyed → show the on-page question text, falling back
  // to the catalog label then the raw role. Unanswered chips are already question text.
  const chipText = (k: string) => questions[k] ?? FIELD_LABELS[k] ?? k

  // Amber note: fields we had an answer for but couldn't fill (outlined amber on the page).
  if (didntLand.length) {
    const note = document.createElement('div')
    note.textContent = `🟠 ${didntLand.length} had an answer but didn't land — outlined amber in the tab`
    note.style.cssText = 'font-size:11px; color:#e2e8f0; margin-bottom:10px; padding:6px 8px; background:#1a1a2e; border:1px solid #2d2d4e; border-radius:4px;'
    el.appendChild(note)
  }

  function renderSection(heading: string, cls: string, labels: string[], chipCls: string) {
    const section = document.createElement('div')
    section.className = 'detail-section'
    const h = document.createElement('div')
    h.className = `detail-heading ${cls}`
    h.textContent = heading
    section.appendChild(h)
    const list = document.createElement('div')
    list.className = 'chip-list'
    labels.forEach((t) => {
      const chip = document.createElement('span')
      chip.className = `chip ${chipCls}`
      chip.textContent = t
      list.appendChild(chip)
    })
    section.appendChild(list)
    el.appendChild(section)
  }

  if (filledFields.length) renderSection(`✓ Filled (${filledFields.length})`, 'ok', filledFields.map(chipText), 'chip-ok')
  if (unanswered.length) renderSection(`✗ Not filled (${unanswered.length})`, 'err', unanswered, 'chip-err')
  if (doubleCheckFields.length) renderSection(`⚠ Double-check (${doubleCheckFields.length})`, 'warn', doubleCheckFields.map(chipText), 'chip-warn')
}

// executeScript with allFrames returns one InjectionResult per frame. The real form lives in
// exactly one frame — often a cross-origin iframe (e.g. a Greenhouse embed) — and the others
// detect nothing. Merge across frames by union: each list/map is contributed by whichever
// frame held the form; non-form frames contribute nothing.
function mergeSummaries(summaries: FillSummary[]): FillSummary {
  const filledFields = new Set<string>()
  const doubleCheckFields = new Set<string>()
  const unanswered = new Set<string>()
  const didntLand = new Set<string>()
  const questions: Record<string, string> = {}
  let filled = 0
  for (const s of summaries) {
    filled += s.filled
    s.filledFields.forEach((f) => filledFields.add(f))
    s.doubleCheckFields.forEach((f) => doubleCheckFields.add(f))
    s.unanswered.forEach((q) => unanswered.add(q))
    s.didntLand.forEach((q) => didntLand.add(q))
    for (const [k, v] of Object.entries(s.questions)) if (!questions[k]) questions[k] = v
  }
  return {
    filled,
    filledFields: [...filledFields],
    doubleCheckFields: [...doubleCheckFields],
    unanswered: [...unanswered],
    didntLand: [...didntLand],
    questions,
  }
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

      // Inject the bundled engine (a real module graph) into every frame, then invoke
      // it via a tiny bridge func that returns the summary. allFrames is what lets us
      // reach a form embedded in a cross-origin iframe (e.g. a Greenhouse embed): the
      // engine runs in the iframe's own context, where location.hostname is the real
      // form's host. Frames that didn't receive the engine (file injection skipped) or
      // that aren't a form are harmless — the bridge returns null and we drop them.
      // Both calls run in the same isolated world per frame, so the second sees
      // globalThis.__charlesEngine set by the first.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['dist/content/engine.js'],
      })
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (req) => {
          const engine = (globalThis as unknown as {
            __charlesEngine?: { run: (r: FillRequest) => Promise<FillSummary> }
          }).__charlesEngine
          return engine ? engine.run(req) : null
        },
        args: [request],
      })

      const summaries = injectionResults
        .map((r) => r.result as FillSummary | null)
        .filter((s): s is FillSummary => s != null)
      const summary = mergeSummaries(summaries)
      setStatus(
        `Filled ${summary.filled} field(s)${summary.unanswered.length ? ` · ${summary.unanswered.length} unanswered` : ''}`,
        summary.filled > 0 ? 'ok' : 'err',
      )
      showDetails(summary.filledFields, summary.doubleCheckFields, summary.unanswered, summary.didntLand, summary.questions)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      chrome.runtime.onMessage.removeListener(progressListener)
    }

    fillBtn.disabled = false
  })
}

init()
