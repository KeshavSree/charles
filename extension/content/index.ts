import { fillElement } from './filler'
import { detectFieldsGreenhouse } from './detectors/greenhouse'
import { detectFieldsLever } from './detectors/lever'
import { detectFieldsAshby } from './detectors/ashby'
import { detectFieldsWorkday } from './detectors/workday'

interface Profile {
  first_name: string
  last_name: string
  email: string
  phone: string | null
  linkedin_url: string | null
  location: string | null
  work_auth: string | null
  experience: Array<{
    company: string; title: string; start_date: string | null;
    end_date: string | null; description: string | null;
  }>
  education: Array<{
    institution: string; degree: string | null; major: string | null;
    gpa: string | null; grad_year: string | null;
  }>
}

function detectAts(): 'greenhouse' | 'lever' | 'ashby' | 'workday' | null {
  const h = location.hostname
  if (h.includes('greenhouse.io'))      return 'greenhouse'
  if (h.includes('lever.co'))           return 'lever'
  if (h.includes('ashbyhq.com'))        return 'ashby'
  if (h.includes('myworkdayjobs.com'))  return 'workday'
  return null
}

function getFields(ats: ReturnType<typeof detectAts>): Record<string, HTMLElement | null> {
  switch (ats) {
    case 'greenhouse': return detectFieldsGreenhouse()
    case 'lever':      return detectFieldsLever()
    case 'ashby':      return detectFieldsAshby()
    case 'workday':    return detectFieldsWorkday()
    default:           return {}
  }
}

function buildValueMap(profile: Profile): Record<string, string> {
  const map: Record<string, string> = {
    first_name: profile.first_name,
    last_name:  profile.last_name,
    email:      profile.email,
    phone:      profile.phone ?? '',
    linkedin:   profile.linkedin_url ?? '',
    location:   profile.location ?? '',
    work_auth:  profile.work_auth ?? '',
  }
  profile.experience.forEach((e, i) => {
    map[`experience_${i}_company`] = e.company
    map[`experience_${i}_title`]   = e.title
    map[`experience_${i}_start`]   = e.start_date ?? ''
    map[`experience_${i}_end`]     = e.end_date ?? ''
  })
  profile.education.forEach((e, i) => {
    map[`education_${i}_institution`] = e.institution
    map[`education_${i}_degree`]      = e.degree ?? ''
    map[`education_${i}_major`]       = e.major ?? ''
    map[`education_${i}_gpa`]         = e.gpa ?? ''
  })
  return map
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'fill') return

  const ats = detectAts()
  if (!ats) {
    sendResponse({ error: 'ATS not recognized on this page' })
    return
  }

  chrome.runtime.sendMessage({ action: 'getProfile', resumeId: msg.resumeId }, (res) => {
    if (res?.error) { sendResponse({ error: res.error }); return }

    const profile: Profile = res.profile
    const fields = getFields(ats)
    const values = buildValueMap(profile)

    let filled = 0
    let skipped = 0
    for (const [key, el] of Object.entries(fields)) {
      const value = values[key]
      if (fillElement(el, value)) { filled++ } else { skipped++ }
    }
    sendResponse({ filled, skipped })
  })

  return true // async
})
