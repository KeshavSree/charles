const API = 'http://localhost:8000'
const STORAGE_KEY = 'activeResumeId'

interface ResumeSummary { id: string; filename: string }

interface UserInfo {
  first_name: string; last_name: string; email: string
  phone: string | null; linkedin_url: string | null
  address: string | null; city: string | null; state: string | null
  zip_code: string | null; country: string | null; work_auth: string | null
  work_authorized: boolean | null; requires_sponsorship: boolean | null
  gender: string | null; ethnicity: string | null
  veteran_status: string | null; disability_status: string | null
}

interface ResumeProfile {
  first_name: string; last_name: string; email: string
  phone: string | null; linkedin_url: string | null
  location: string | null; work_auth: string | null
}

// Info fields win; resume profile fills anything Info left empty.
function mergeForFill(info: UserInfo, profile: ResumeProfile | null): UserInfo {
  const pick = (a: string | null, b: string | null) => a || b || null
  return {
    first_name:   pick(info.first_name || null,   profile?.first_name   ?? null) ?? '',
    last_name:    pick(info.last_name  || null,   profile?.last_name    ?? null) ?? '',
    email:        pick(info.email      || null,   profile?.email        ?? null) ?? '',
    phone:        pick(info.phone,                profile?.phone        ?? null),
    linkedin_url: pick(info.linkedin_url,         profile?.linkedin_url ?? null),
    address:      info.address,
    city:         pick(info.city,                 profile?.location     ?? null),
    state:        info.state,
    zip_code:     info.zip_code,
    country:      info.country,
    work_auth:    pick(info.work_auth,            profile?.work_auth    ?? null),
    work_authorized:     info.work_authorized,
    requires_sponsorship: info.requires_sponsorship,
    gender:           info.gender,
    ethnicity:        info.ethnicity,
    veteran_status:   info.veteran_status,
    disability_status: info.disability_status,
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

// Injected into the page — must be fully self-contained (no imports, no outer scope refs)
function fillPageFields(profile: UserInfo): { filled: number; skipped: number } {
  function classify(el: Element): string | null {
    const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
    const name        = (el.getAttribute('name') ?? '').toLowerCase()
    const id          = (el.id ?? '').toLowerCase()
    const placeholder = (el.getAttribute('placeholder') ?? '').toLowerCase()
    const ariaLabel   = (el.getAttribute('aria-label') ?? '').toLowerCase()
    const automationId = (
      el.closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? ''
    ).toLowerCase()

    let labelText = ''
    if (el.id) {
      labelText = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.toLowerCase() ?? ''
    }
    if (!labelText) {
      const ariaLabelledBy = el.getAttribute('aria-labelledby')
      if (ariaLabelledBy) {
        labelText = document.getElementById(ariaLabelledBy)?.textContent?.toLowerCase() ?? ''
      }
    }
    if (!labelText) {
      labelText = el.closest('label')?.textContent?.toLowerCase() ?? ''
    }

    const all = [autocomplete, name, id, placeholder, ariaLabel, automationId, labelText].join(' ')

    if (/given.?name|first.?name|\bfname\b|legalname.*first|legalname--first/.test(all)) return 'first_name'
    if (/family.?name|last.?name|\blname\b|legalname.*last|legalname--last/.test(all)) return 'last_name'
    if (/\bfull.?name\b/.test(all) || autocomplete === 'name' || name === 'name') return 'full_name'
    if (/\bemail\b/.test(all)) return 'email'
    if (/\bphone\b|\bmobile\b|\btel\b/.test(all) && !/extension|type|country.?code|sms/.test(all)) return 'phone'
    if (/linkedin/.test(all)) return 'linkedin'
    if (/\bcity\b|\blocation\b/.test(all)) return 'city'
    if (/\bstate\b|\bprovince\b|\bregion\b/.test(all)) return 'state'
    if (/\bzip\b|\bpostal\b/.test(all)) return 'zip_code'
    if (/\bcountry\b/.test(all)) return 'country'
    if (/\baddress\b|\bstreet\b/.test(all)) return 'address'
    if (/work.?auth|visa.?sponsor|authorization/.test(all)) return 'work_auth'

    return null
  }

  function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur',   { bubbles: true }))
  }

  const valueMap: Record<string, string> = {
    full_name:  `${profile.first_name} ${profile.last_name}`.trim(),
    first_name: profile.first_name   ?? '',
    last_name:  profile.last_name    ?? '',
    email:      profile.email        ?? '',
    phone:      profile.phone        ?? '',
    linkedin:   profile.linkedin_url ?? '',
    address:    profile.address      ?? '',
    city:       profile.city         ?? '',
    state:      profile.state        ?? '',
    zip_code:   profile.zip_code     ?? '',
    country:    profile.country      ?? '',
    work_auth:  profile.work_auth    ?? '',
  }

  let filled = 0
  let skipped = 0

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio'])

  // Workday renders country/state as custom comboboxes backed by async API lookups.
  // Setting .value on them triggers internal fetches that 404/500 on plain text values.
  function isWorkdayCombobox(el: Element): boolean {
    const container = el.closest('[data-automation-id]')
    if (!container) return false
    const aid = container.getAttribute('data-automation-id') ?? ''
    return /country|countryPhone|state|region|province/i.test(aid)
  }

  // --- Pass 1: text inputs, textareas, native selects ---
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select'
  ).forEach((el) => {
    if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return
    if (isWorkdayCombobox(el)) { skipped++; return }
    const key = classify(el)
    if (!key) { skipped++; return }
    const value = valueMap[key]
    if (!value) { skipped++; return }
    try {
      if (el instanceof HTMLSelectElement) {
        el.value = value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        fillInput(el, value)
      }
      filled++
    } catch {
      skipped++
    }
  })

  // --- Pass 2: radio groups and checkboxes ---

  // Keyword map: field name → regexp to match group label
  const radioKeywordMap: Array<{ field: keyof typeof profile; re: RegExp }> = [
    { field: 'work_authorized',     re: /authorized.?to.?work|work.?authorization|legally.?authorized|eligible.?to.?work/i },
    { field: 'requires_sponsorship', re: /sponsorship|visa.?sponsor|require.*sponsor/i },
    { field: 'gender',              re: /\bgender\b/i },
    { field: 'ethnicity',           re: /ethnicity|race|racial/i },
    { field: 'veteran_status',      re: /veteran/i },
    { field: 'disability_status',   re: /disability|disabled/i },
  ]

  function getGroupLabel(radios: HTMLInputElement[]): string {
    // Try legend in nearest fieldset
    for (const r of radios) {
      const legend = r.closest('fieldset')?.querySelector('legend')
      if (legend?.textContent) return legend.textContent.toLowerCase()
    }
    // Try aria-labelledby on the group container
    for (const r of radios) {
      const container = r.closest('[role="group"],[role="radiogroup"]')
      if (container) {
        const labelledBy = container.getAttribute('aria-labelledby')
        if (labelledBy) {
          const text = document.getElementById(labelledBy)?.textContent
          if (text) return text.toLowerCase()
        }
        const ariaLabel = container.getAttribute('aria-label')
        if (ariaLabel) return ariaLabel.toLowerCase()
      }
    }
    // Try the name attribute itself
    if (radios[0]?.name) return radios[0].name.toLowerCase()
    return ''
  }

  function getRadioLabel(radio: HTMLInputElement): string {
    if (radio.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)
      if (lbl?.textContent) return lbl.textContent.toLowerCase().trim()
    }
    const parent = radio.closest('label')
    if (parent?.textContent) return parent.textContent.toLowerCase().trim()
    return (radio.value ?? '').toLowerCase()
  }

  function matchesBoolValue(labelOrVal: string, storedTrue: boolean): boolean {
    if (storedTrue) return /\byes\b|\b1\b|\btrue\b/.test(labelOrVal)
    return /\bno\b|\b0\b|\bfalse\b/.test(labelOrVal)
  }

  // Group radios by name
  const radioGroups = new Map<string, HTMLInputElement[]>()
  document.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => {
    const key = r.name || r.id || Math.random().toString()
    if (!radioGroups.has(key)) radioGroups.set(key, [])
    radioGroups.get(key)!.push(r)
  })

  radioGroups.forEach((radios) => {
    const groupLabel = getGroupLabel(radios)
    for (const { field, re } of radioKeywordMap) {
      if (!re.test(groupLabel)) continue
      const storedValue = profile[field]
      if (storedValue === null || storedValue === undefined) break

      const isBool = typeof storedValue === 'boolean'
      let target: HTMLInputElement | null = null

      for (const radio of radios) {
        const radioLabel = getRadioLabel(radio)
        const radioVal   = (radio.value ?? '').toLowerCase()
        if (isBool) {
          if (matchesBoolValue(radioLabel, storedValue as boolean) ||
              matchesBoolValue(radioVal,   storedValue as boolean)) {
            target = radio
            break
          }
        } else {
          const stored = (storedValue as string).toLowerCase()
          if (radioLabel === stored || radioVal === stored) {
            target = radio
            break
          }
        }
      }

      if (target && !target.checked) {
        try {
          target.click()
          target.dispatchEvent(new Event('change', { bubbles: true }))
          filled++
        } catch {
          skipped++
        }
      }
      break
    }
  })

  // Checkboxes: only boolean fields
  const boolCheckboxMap: Array<{ field: 'work_authorized' | 'requires_sponsorship'; re: RegExp }> = [
    { field: 'work_authorized',     re: /authorized.?to.?work|work.?authorization|legally.?authorized|eligible.?to.?work/i },
    { field: 'requires_sponsorship', re: /sponsorship|visa.?sponsor|require.*sponsor/i },
  ]

  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    const label = classify(cb) ?? ''
    const allText = [
      cb.getAttribute('name') ?? '',
      cb.id,
      cb.getAttribute('aria-label') ?? '',
      document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.textContent ?? '',
      cb.closest('label')?.textContent ?? '',
    ].join(' ').toLowerCase()

    for (const { field, re } of boolCheckboxMap) {
      if (!re.test(allText)) continue
      const storedValue = profile[field]
      if (storedValue === null || storedValue === undefined) break
      try {
        if (storedValue === true && !cb.checked) {
          cb.click()
          cb.dispatchEvent(new Event('change', { bubbles: true }))
          filled++
        } else if (storedValue === false && cb.checked) {
          cb.click()
          cb.dispatchEvent(new Event('change', { bubbles: true }))
          filled++
        }
      } catch {
        skipped++
      }
      break
    }
    if (!label) skipped++
  })

  return { filled, skipped }
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
    setStatus('Filling…')

    try {
      const [infoRes, profileRes] = await Promise.all([
        fetch(`${API}/api/info`),
        fetch(`${API}/api/profile/${resumeId}`),
      ])

      if (!infoRes.ok) throw new Error(`Cannot load Info (${infoRes.status}) — fill in your Info page`)
      const info: UserInfo = await infoRes.json()
      const profile: ResumeProfile | null = profileRes.ok ? await profileRes.json() : null

      const merged = mergeForFill(info, profile)

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillPageFields,
        args: [merged],
      })

      const { filled, skipped } = results[0].result as { filled: number; skipped: number }
      setStatus(`Filled ${filled} field(s)${skipped ? `, skipped ${skipped}` : ''}`, filled > 0 ? 'ok' : 'err')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'err')
    }

    fillBtn.disabled = false
  })
}

init()
