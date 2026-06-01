import { FIELDS, FIELD_LABELS, UserInfo } from '../../frontend/lib/fields'

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

// Instructions computed in popup context (can use FIELDS import) and passed
// to fillPageFields. All values are plain serializable data — no functions,
// no RegExp objects. Chrome serializes fillPageFields as a function string;
// only its parameter values survive into the injected context.
interface SectionEntry {
  namedFields: Record<string, string>       // fieldName → value (matched by id prefix--name)
  namedCheckboxes: Record<string, boolean>  // fieldName → checked
  dateSuffixes: Record<string, string>      // id suffix → value (month/year inputs)
  textareaSuffixes: Record<string, string>  // id suffix → value
  typeaheadFields: Record<string, string>   // id suffix → value (type + wait + click suggestion)
  containerFields: Record<string, string>   // formField aid → value (input found via parent aid)
  comboboxFields: Record<string, string>    // formField aid → value (click button, pick li[role=option])
}

interface FillInstructions {
  classifyRules: Array<{ re: string; excludeRe?: string; key: string }>
  textValues: Record<string, string>
  radioInstructions: Array<{ groupRe: string; key: string; value: string | boolean | null; isBool: boolean }>
  checkboxInstructions: Array<{ groupRe: string; key: string; value: boolean | null }>
  comboboxInstructions: Array<{ aidPattern: string; key: string }>
  allDataKeys: string[]
  sections: Array<{ headingRe: string; entries: SectionEntry[] }>
  skills: string[]
  resumeFile: { base64: string; filename: string } | null
}

// FIELDS-driven merge: info fields win; resume profile fills anything left empty.
function mergeForFill(info: UserInfo, profile: ResumeProfile | null): UserInfo {
  const result: Record<string, unknown> = {}
  for (const f of FIELDS) {
    const infoVal = (info as Record<string, unknown>)[f.key]
    if (f.type === 'text') {
      const profileVal = f.profileKey && profile
        ? ((profile as Record<string, unknown>)[f.profileKey] ?? null)
        : null
      const merged = (infoVal as string | null) || (profileVal as string | null) || null
      result[f.key] = f.required ? (merged || '') : merged
    } else {
      result[f.key] = infoVal ?? f.defaultValue
    }
  }
  result.skills = info.skills ?? []
  return result as UserInfo
}

function parseDateParts(d: string | null): { month: string; year: string } | null {
  if (!d) return null
  if (d.includes('/')) {
    // MM/YYYY
    const [m, y] = d.split('/')
    return { month: m ? String(parseInt(m, 10)) : '', year: y || '' }
  }
  // YYYY-MM or YYYY-MM-DD
  const parts = d.split('-')
  return { month: parts[1] ? String(parseInt(parts[1], 10)) : '', year: parts[0] || '' }
}

// Pre-computes all fill instructions from the merged UserInfo and optional profile.
// Called in popup context so it can reference the imported FIELDS registry.
function buildFillInstructions(merged: UserInfo, profile: ResumeProfile | null): FillInstructions {
  const classifyRules: FillInstructions['classifyRules'] = []
  const textValues: Record<string, string> = {}
  const radioInstructions: FillInstructions['radioInstructions'] = []
  const checkboxInstructions: FillInstructions['checkboxInstructions'] = []
  const comboboxInstructions: FillInstructions['comboboxInstructions'] = []
  const allDataKeys: string[] = []

  for (const f of FIELDS) {
    const fillKey = f.fillKey ?? f.key
    const rawValue = (merged as Record<string, unknown>)[f.key]

    // Classify rule for text fields
    if (f.classifyRe && f.type === 'text') {
      classifyRules.push({
        re: f.classifyRe,
        ...(f.classifyExcludeRe ? { excludeRe: f.classifyExcludeRe } : {}),
        key: fillKey,
      })
    }

    // Insert full_name rule after last_name (preserves original classify() order)
    if (f.key === 'last_name') {
      classifyRules.push({ re: String.raw`\bfull.?name\b`, key: 'full_name' })
    }

    // Text values — hardcodedFillValue wins over stored data
    if (f.type === 'text') {
      const strVal = f.hardcodedFillValue ?? ((rawValue as string | null) ?? '')
      textValues[fillKey] = strVal
      if (strVal) allDataKeys.push(fillKey)
    }

    // Radio instructions (bool + string-enum fields)
    if (f.groupRe && rawValue !== null && rawValue !== undefined && rawValue !== '') {
      radioInstructions.push({
        groupRe: f.groupRe,
        key: f.key,
        value: rawValue as string | boolean | null,
        isBool: f.type === 'bool',
      })
      allDataKeys.push(f.key)
    }

    // Checkbox instructions (bool fields only)
    if (f.groupRe && f.type === 'bool') {
      checkboxInstructions.push({
        groupRe: f.groupRe,
        key: f.key,
        value: rawValue as boolean | null,
      })
    }

    // Workday combobox fields
    if (f.aidPattern) {
      comboboxInstructions.push({ aidPattern: f.aidPattern, key: fillKey })
    }
  }

  // Add full_name computed value
  const fullName = `${merged.first_name} ${merged.last_name}`.trim()
  if (fullName) {
    textValues['full_name'] = fullName
    allDataKeys.push('full_name')
  }

  // Build section instructions from profile experience
  const sections: FillInstructions['sections'] = []

  if (profile?.experience?.length) {
    const entries = [...profile.experience]
      .sort((a, b) => a.display_order - b.display_order)
      .map((exp) => {
        const s = parseDateParts(exp.start_date)
        const e = parseDateParts(exp.end_date)
        return {
          namedFields: {
            jobTitle: exp.title,
            companyName: exp.company,
            ...(exp.location ? { location: exp.location } : {}),
          },
          namedCheckboxes: { currentlyWorkHere: exp.is_current },
          dateSuffixes: {
            ...(s?.month ? { 'startDate-dateSectionMonth-input': s.month } : {}),
            ...(s?.year  ? { 'startDate-dateSectionYear-input':  s.year  } : {}),
            ...(!exp.is_current && e?.month ? { 'endDate-dateSectionMonth-input': e.month } : {}),
            ...(!exp.is_current && e?.year  ? { 'endDate-dateSectionYear-input':  e.year  } : {}),
          },
          textareaSuffixes: exp.description ? { roleDescription: exp.description } : {},
          typeaheadFields: {},
          containerFields: {},
          comboboxFields: {},
        }
      })
    sections.push({ headingRe: String.raw`work.?experience`, entries })
  }

  if (profile?.education?.length) {
    const DEGREE_MAP: Record<string, string> = {
      'B.S.':  'Bachelor of Science',
      'M.S.':  'Master of Science',
      'PhD':   'Doctor of Philosophy',
    }
    const entries = [...profile.education]
      .sort((a, b) => a.display_order - b.display_order)
      .map((edu) => ({
        namedFields: {},
        namedCheckboxes: {},
        dateSuffixes: {},
        textareaSuffixes: {},
        typeaheadFields: {
          ...(edu.institution ? { school: edu.institution } : {}),
          ...(edu.major       ? { fieldOfStudy: edu.major } : {}),
        },
        containerFields: {},
        comboboxFields: {
          ...(edu.degree ? { 'formField-degree': DEGREE_MAP[edu.degree] ?? edu.degree } : {}),
        },
      }))
    sections.push({ headingRe: String.raw`education`, entries })
  }

  const skills = (merged.skills ?? []).filter(Boolean)

  // resumeFile is fetched + attached asynchronously by the click handler (it needs
  // the PDF bytes from the API, which this synchronous builder can't fetch).
  return { classifyRules, textValues, radioInstructions, checkboxInstructions, comboboxInstructions, allDataKeys, sections, skills, resumeFile: null }
}

// Fetch the active resume's PDF and base64-encode it so it can ride along inside
// the executeScript args (Blobs/Files can't cross that boundary). Returns null if
// the file can't be fetched.
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

// Injected into the page — must be fully self-contained (no imports, no outer scope refs).
// Receives pre-computed FillInstructions so it has zero hardcoded field knowledge.
async function fillPageFields(instructions: {
  classifyRules: Array<{ re: string; excludeRe?: string; key: string }>
  textValues: Record<string, string>
  radioInstructions: Array<{ groupRe: string; key: string; value: string | boolean | null; isBool: boolean }>
  checkboxInstructions: Array<{ groupRe: string; key: string; value: boolean | null }>
  comboboxInstructions: Array<{ aidPattern: string; key: string }>
  allDataKeys: string[]
  skills: string[]
  resumeFile: { base64: string; filename: string } | null
  sections: Array<{
    headingRe: string
    entries: Array<{
      namedFields: Record<string, string>
      namedCheckboxes: Record<string, boolean>
      dateSuffixes: Record<string, string>
      textareaSuffixes: Record<string, string>
      typeaheadFields: Record<string, string>
      containerFields: Record<string, string>
      comboboxFields: Record<string, string>
    }>
  }>
}): Promise<{ filled: number; skipped: number; filledFields: string[]; skippedFields: string[] }> {

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

    // One hardcoded special case: full_name via HTML autocomplete/name semantics
    if (autocomplete === 'name' || name === 'name') return 'full_name'

    // All other fields driven from instructions
    for (const rule of instructions.classifyRules) {
      if (new RegExp(rule.re, 'i').test(all)) {
        if (rule.excludeRe && new RegExp(rule.excludeRe, 'i').test(all)) continue
        return rule.key
      }
    }
    return null
  }

  function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string, triggerBlur = true): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input',    { bubbles: true }))
    el.dispatchEvent(new Event('change',   { bubbles: true }))
    if (triggerBlur) el.dispatchEvent(new Event('focusout', { bubbles: true }))
  }

  // Workday custom comboboxes use async API lookups — skip them in Pass 1,
  // handle them in Pass 3 via click-to-open + option selection.
  function isWorkdayCombobox(el: Element): boolean {
    const container = el.closest('[data-automation-id]')
    if (!container) return false
    const aid = container.getAttribute('data-automation-id') ?? ''
    return instructions.comboboxInstructions.some((ci) => new RegExp(ci.aidPattern, 'i').test(aid))
  }

  let filled = 0
  let skipped = 0
  const filledKeys: string[] = []

  // Field-level logging — visible in the page's DevTools console.
  const log = (msg: string) => console.log(`[charles] ${msg}`)
  const trunc = (v: string) => (v.length > 60 ? `${v.slice(0, 57)}…` : v)

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio'])

  // --- Pass 1: text inputs, textareas, native selects ---
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select'
  ).forEach((el) => {
    if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return
    if (isWorkdayCombobox(el)) { skipped++; return }
    const key = classify(el)
    if (!key) { skipped++; return }
    log(`${key} detected (text)`)
    const value = instructions.textValues[key]
    if (!value) { log(`${key} skipped — no stored value`); skipped++; return }
    try {
      if (el instanceof HTMLSelectElement) {
        el.value = value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        fillInput(el, value)
      }
      if (!filledKeys.includes(key)) filledKeys.push(key)
      log(`${key} filled ✓ = "${trunc(value)}"`)
      filled++
    } catch { log(`${key} skipped — fill error`); skipped++ }
  })

  // --- Pass 2a: radio groups ---

  function getGroupLabel(radios: HTMLInputElement[]): string {
    for (const r of radios) {
      const legend = r.closest('fieldset')?.querySelector('legend')
      if (legend?.textContent) return legend.textContent.toLowerCase()
    }
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

  const radioGroups = new Map<string, HTMLInputElement[]>()
  document.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => {
    const key = r.name || r.id || Math.random().toString()
    if (!radioGroups.has(key)) radioGroups.set(key, [])
    radioGroups.get(key)!.push(r)
  })

  radioGroups.forEach((radios) => {
    const groupLabel = getGroupLabel(radios)
    for (const instr of instructions.radioInstructions) {
      if (!new RegExp(instr.groupRe, 'i').test(groupLabel)) continue
      log(`${instr.key} detected (radio group: "${trunc(groupLabel)}")`)
      const storedValue = instr.value
      if (storedValue === null || storedValue === undefined) break

      let target: HTMLInputElement | null = null
      for (const radio of radios) {
        const radioLabel = getRadioLabel(radio)
        const radioVal   = (radio.value ?? '').toLowerCase()
        if (instr.isBool) {
          if (matchesBoolValue(radioLabel, storedValue as boolean) ||
              matchesBoolValue(radioVal,   storedValue as boolean)) {
            target = radio; break
          }
        } else {
          const stored = (storedValue as string).toLowerCase()
          if (radioLabel === stored || radioVal === stored) {
            target = radio; break
          }
        }
      }
      if (target && !target.checked) {
        try {
          target.click()
          target.dispatchEvent(new Event('change', { bubbles: true }))
          if (!filledKeys.includes(instr.key)) filledKeys.push(instr.key)
          log(`${instr.key} filled ✓ = ${storedValue}`)
          filled++
        } catch { log(`${instr.key} skipped — click error`); skipped++ }
      } else if (!target) {
        log(`${instr.key} skipped — no radio option matched ${storedValue}`)
      } else {
        log(`${instr.key} already set = ${storedValue}`)
      }
      break
    }
  })

  // --- Pass 2b: standalone checkboxes ---
  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    const allText = [
      cb.getAttribute('name') ?? '',
      cb.id,
      cb.getAttribute('aria-label') ?? '',
      document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.textContent ?? '',
      cb.closest('label')?.textContent ?? '',
    ].join(' ').toLowerCase()

    for (const instr of instructions.checkboxInstructions) {
      if (!new RegExp(instr.groupRe, 'i').test(allText)) continue
      log(`${instr.key} detected (checkbox)`)
      const storedValue = instr.value
      if (storedValue === null || storedValue === undefined) break
      try {
        if (storedValue === true && !cb.checked) {
          cb.click()
          cb.dispatchEvent(new Event('change', { bubbles: true }))
          if (!filledKeys.includes(instr.key)) filledKeys.push(instr.key)
          log(`${instr.key} filled ✓ = checked`)
          filled++
        } else if (storedValue === false && cb.checked) {
          cb.click()
          cb.dispatchEvent(new Event('change', { bubbles: true }))
          if (!filledKeys.includes(instr.key)) filledKeys.push(instr.key)
          log(`${instr.key} filled ✓ = unchecked`)
          filled++
        } else {
          log(`${instr.key} already set`)
        }
      } catch { log(`${instr.key} skipped — click error`); skipped++ }
      break
    }
    if (!classify(cb)) skipped++
  })

  // --- Pass 3: Workday-style custom select widgets ---
  // These React comboboxes need click-to-open + option selection.
  // Pass 1 deliberately skips them to avoid triggering broken internal fetches.
  // Workday forms vary: some use data-automation-id="selectWidget", others just
  // have a plain <button> inside the formField container. We handle both.
  for (const ci of instructions.comboboxInstructions) {
    const value = instructions.textValues[ci.key]
    if (!value) { skipped++; continue }

    // Find the form field container by aidPattern — no longer requires selectWidget child
    let container: Element | null = null
    for (const el of document.querySelectorAll<Element>('[data-automation-id]')) {
      const aid = el.getAttribute('data-automation-id') ?? ''
      if (new RegExp(ci.aidPattern, 'i').test(aid)) {
        container = el; break
      }
    }
    if (!container) { skipped++; continue }
    log(`${ci.key} detected (combobox)`)

    // Trigger: prefer selectWidget, fall back to first button in container
    const trigger = (
      container.querySelector<HTMLElement>('[data-automation-id="selectWidget"]') ??
      container.querySelector<HTMLElement>('button')
    )
    if (!trigger) { log(`${ci.key} skipped — no dropdown trigger`); skipped++; continue }

    trigger.click()
    await new Promise(r => setTimeout(r, 400))

    // Find options — try each selector in order of Workday specificity.
    // li[role="option"] targets the standard single-select dropdown list (no aid).
    // [data-automation-id="promptOption"] covers older Workday combobox forms.
    // Avoid bare [role="option"] first since it also matches unrelated pills (DIV role=option).
    let options = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
    if (options.length === 0)
      options = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'))
    if (options.length === 0)
      options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .filter(el => !el.getAttribute('data-automation-id'))

    // If still no options, try typing into the search input to trigger filtering
    if (options.length === 0) {
      const searchInput = (
        container.querySelector<HTMLInputElement>('input') ??
        document.querySelector<HTMLInputElement>('input[data-automation-id="searchBox"]')
      )
      if (searchInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(searchInput, value)
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 500))
        options = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'))
        if (options.length === 0)
          options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      }
    }

    const val = value.toLowerCase()
    const match = (
      options.find(o => (o.textContent ?? '').trim().toLowerCase() === val) ??
      options.find(o => (o.textContent ?? '').trim().toLowerCase().startsWith(val)) ??
      options.find(o => val.startsWith((o.textContent ?? '').trim().toLowerCase().replace(/\s+/g, ' ')))
    )

    if (match) {
      match.click()
      await new Promise(r => setTimeout(r, 100))
      filledKeys.push(ci.key)
      log(`${ci.key} filled ✓ = "${trunc(value)}"`)
      filled++
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      log(`${ci.key} skipped — no option matched "${value}" (${options.length} options)`)
      skipped++
    }
  }

  // --- Pass 4: Add-and-fill structured sections (Work Experience, Education, etc.) ---
  // Finds the Add button for each section by matching the nearest heading text,
  // clicks it, waits for new fields to appear, then fills by id prefix.
  function findSectionAddButton(headingRe: string): HTMLElement | null {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="add-button"]'))
    for (const btn of btns) {
      let node: Element | null = btn.parentElement
      for (let k = 0; k < 12 && node; k++, node = node.parentElement) {
        const heading = node.querySelector('h1,h2,h3,h4,[role="heading"]')
        if (heading && new RegExp(headingRe, 'i').test(heading.textContent ?? '')) return btn
      }
    }
    return null
  }

  for (const section of instructions.sections) {
    for (let idx = 0; idx < section.entries.length; idx++) {
      const entry = section.entries[idx]
      const tag = `${section.headingRe}[${idx}]`
      const addBtn = findSectionAddButton(section.headingRe)
      if (!addBtn) { log(`${tag} skipped — no Add button found`); continue }

      const existingIds = new Set(
        Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[id], textarea[id]'))
          .map((el) => el.id)
      )

      addBtn.click()
      await new Promise((r) => setTimeout(r, 700))

      const newEls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[id], textarea[id]'))
        .filter((el) => el.id && !existingIds.has(el.id))
      if (!newEls.length) { log(`${tag} skipped — no new fields after Add`); continue }

      const prefix = newEls[0].id.split('--')[0]
      log(`${tag} detected (section, prefix=${prefix})`)

      for (const [name, value] of Object.entries(entry.namedFields)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${name}`) as HTMLInputElement | null
        if (el) { fillInput(el, value); log(`${tag}.${name} filled ✓ = "${trunc(value)}"`); filled++ }
        else log(`${tag}.${name} skipped — field not found`)
      }

      for (const [name, checked] of Object.entries(entry.namedCheckboxes)) {
        const el = document.getElementById(`${prefix}--${name}`) as HTMLInputElement | null
        if (el && el.checked !== checked) {
          el.click()
          el.dispatchEvent(new Event('change', { bubbles: true }))
          log(`${tag}.${name} filled ✓ = ${checked ? 'checked' : 'unchecked'}`)
        }
      }

      for (const [suffix, value] of Object.entries(entry.dateSuffixes)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${suffix}`) as HTMLInputElement | null
        if (!el) continue
        // Month must be filled without focusout — firing it before year is set
        // causes Workday to validate "08/" (incomplete) and show an error.
        // focusout on the year field validates the full "08/2020" pair.
        const isYear = suffix.includes('Year')
        fillInput(el, value, isYear)
        log(`${tag}.${suffix} filled ✓ = "${value}"`)
        filled++
      }

      for (const [suffix, value] of Object.entries(entry.textareaSuffixes)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${suffix}`) as HTMLInputElement | HTMLTextAreaElement | null
        if (el) { fillInput(el, value); log(`${tag}.${suffix} filled ✓ = "${trunc(value)}"`); filled++ }
      }

      // Typeahead fields: focus, type (input event only — no blur, which clears the field),
      // wait for suggestions, click best match or press Enter to confirm.
      for (const [suffix, value] of Object.entries(entry.typeaheadFields)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${suffix}`) as HTMLInputElement | null
        if (!el) continue
        el.focus()
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        if (setter) setter.call(el, value); else el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 700))
        const opts = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
        const val = value.toLowerCase()
        const match = (
          opts.find(o => (o.textContent ?? '').trim().toLowerCase() === val) ??
          opts.find(o => (o.textContent ?? '').trim().toLowerCase().includes(val))
        )
        if (match) {
          match.click()
          log(`${tag}.${suffix} filled ✓ = "${trunc(value)}" (typeahead match)`)
        } else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
          el.dispatchEvent(new KeyboardEvent('keyup',  { key: 'Enter', keyCode: 13, bubbles: true }))
          log(`${tag}.${suffix} filled ✓ = "${trunc(value)}" (typeahead, Enter fallback)`)
        }
        await new Promise((r) => setTimeout(r, 200))
        filled++
      }

      // Container fields: locate input via parent data-automation-id
      for (const [aid, value] of Object.entries(entry.containerFields)) {
        if (!value) continue
        const container = document.querySelector<HTMLElement>(`[data-automation-id="${aid}"]`)
        const input = container?.querySelector<HTMLInputElement>('input')
        if (input) { fillInput(input, value); log(`${tag}.${aid} filled ✓ = "${trunc(value)}"`); filled++ }
      }

      // Combobox fields: click button to open dropdown, pick li[role=option] by text
      for (const [aid, value] of Object.entries(entry.comboboxFields)) {
        if (!value) continue
        const container = document.querySelector<HTMLElement>(`[data-automation-id="${aid}"]`)
        const trigger = container?.querySelector<HTMLElement>('button')
        if (!trigger) continue
        trigger.click()
        await new Promise((r) => setTimeout(r, 400))
        const opts = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
        const val = value.toLowerCase()
        const match = (
          opts.find(o => (o.textContent ?? '').trim().toLowerCase() === val) ??
          opts.find(o => (o.textContent ?? '').trim().toLowerCase().startsWith(val))
        )
        if (match) {
          match.click()
          await new Promise((r) => setTimeout(r, 200))
          log(`${tag}.${aid} filled ✓ = "${trunc(value)}" (combobox)`)
          filled++
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
          log(`${tag}.${aid} skipped — no option matched "${value}"`)
        }
      }

      filledKeys.push(tag)
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  // --- Pass 5: Skills multiselect (fixed id: skills--skills) ---
  // Workday's skills box ("monikerSearchBox") runs a debounced REMOTE search and renders
  // results as div[data-automation-id="menuItem"][role="option"] inside a ReactVirtualized
  // list. The search is triggered by keyboard events and committed by Enter, so for each
  // skill we: prefill the value + fire one keystroke, press Enter, wait for the remote
  // results to replace the "No Items." placeholder, then click the inner promptOption node
  // (React listens for pointer events, not a bare .click() on the outer menuItem).
  function setNativeValue(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(el, value); else el.value = value
  }

  // Trigger exactly ONE remote search: silently prefill all but the last character
  // (no events → no search), then "type" the final character with a full key+input
  // sequence. Workday's search is bound to keyboard events, so this one keystroke
  // fires a single search for the complete term — avoiding the rapid-fire race that
  // overwrites good results with a stale "No Items." response.
  async function typeQuery(el: HTMLInputElement, text: string): Promise<void> {
    el.focus()
    el.click()
    const head = text.slice(0, -1)
    const last = text.slice(-1)
    const code = last.toUpperCase().charCodeAt(0)
    setNativeValue(el, head)                                   // silent prefill, no events
    el.dispatchEvent(new KeyboardEvent('keydown',  { key: last, keyCode: code, bubbles: true, cancelable: true }))
    el.dispatchEvent(new KeyboardEvent('keypress', { key: last, keyCode: code, bubbles: true, cancelable: true }))
    setNativeValue(el, text)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: last, inputType: 'insertText' }))
    el.dispatchEvent(new KeyboardEvent('keyup',  { key: last, keyCode: code, bubbles: true }))
  }

  function optionLabel(o: HTMLElement): string {
    const p = o.querySelector('[data-automation-id="promptOption"]')
    return (p?.getAttribute('data-automation-label') ?? p?.textContent ?? o.textContent ?? '').trim()
  }

  // "No Items.", loading and empty states render as a menuItem before the remote
  // search resolves — they are not selectable skills.
  function isPlaceholder(label: string): boolean {
    return label === '' || /^no items|^no results|^loading|^searching/i.test(label)
  }

  // Poll until at least one REAL (non-placeholder) option appears, or timeout.
  async function pollForOptions(maxMs: number): Promise<HTMLElement[]> {
    const start = Date.now()
    for (;;) {
      const all = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="menuItem"][role="option"]'))
      const real = all.filter((o) => !isPlaceholder(optionLabel(o)))
      if (real.length) return real
      if (Date.now() - start >= maxMs) return []
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  for (const skill of instructions.skills) {
    const el = document.getElementById('skills--skills') as HTMLInputElement | null
    if (!el) { log('skills skipped — input #skills--skills not found'); break }
    log(`skill "${skill}" detected (searching)`)
    await typeQuery(el, skill)
    // Enter commits the query and kicks off the remote search.
    el.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    el.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', keyCode: 13, bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    const opts = await pollForOptions(3000)
    const first = opts[0] ?? null
    if (!first) { log(`skill "${skill}" skipped — no search results`); skipped++; continue }
    // The click target is the inner promptOption/promptLeafNode, not the outer
    // menuItem. React listens for pointer events, so fire the full sequence.
    const target =
      first.querySelector<HTMLElement>('[data-automation-id="promptOption"]') ??
      first.querySelector<HTMLElement>('[data-automation-id="promptLeafNode"]') ??
      first
    const evInit: MouseEventInit = { bubbles: true, cancelable: true, view: window }
    target.dispatchEvent(new PointerEvent('pointerdown', evInit))
    target.dispatchEvent(new MouseEvent('mousedown', evInit))
    target.dispatchEvent(new PointerEvent('pointerup', evInit))
    target.dispatchEvent(new MouseEvent('mouseup', evInit))
    target.dispatchEvent(new MouseEvent('click', evInit))
    await new Promise((r) => setTimeout(r, 300))
    log(`skill "${skill}" filled ✓ → selected "${optionLabel(first)}"`)
    filled++
    await new Promise((r) => setTimeout(r, 300))
  }
  if (instructions.skills.length) filledKeys.push('skills')

  // --- Pass 6: Resume file upload ---
  // Workday's upload widget hides a real <input type="file" data-automation-id=
  // "file-upload-input-ref"> behind a dropzone. We can't drive the OS picker, but we
  // CAN assign files programmatically via DataTransfer, then dispatch change so
  // Workday's handler picks it up and uploads.
  if (instructions.resumeFile) {
    const input = (
      document.querySelector<HTMLInputElement>('input[type="file"][data-automation-id="file-upload-input-ref"]') ??
      document.querySelector<HTMLInputElement>('input[type="file"]')
    )
    if (!input) {
      log('resume skipped — no file input found on page')
    } else {
      try {
        const bin = atob(instructions.resumeFile.base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], instructions.resumeFile.filename, { type: 'application/pdf' })
        const dt = new DataTransfer()
        dt.items.add(file)
        input.files = dt.files
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        // Fallback for dropzone-based widgets: fire a drop carrying the same file.
        const dropZone = input.closest('[data-automation-id="attachments-FileUpload"]')
          ?.querySelector('[data-automation-id="file-upload-drop-zone"]')
        if (dropZone) {
          const dropDt = new DataTransfer()
          dropDt.items.add(file)
          dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropDt }))
        }
        log(`resume filled ✓ = "${instructions.resumeFile.filename}"`)
        filledKeys.push('resume')
        filled++
        await new Promise((r) => setTimeout(r, 500))
      } catch (e) {
        log(`resume skipped — ${e instanceof Error ? e.message : 'upload error'}`)
        skipped++
      }
    }
  }

  const filledSet = new Set(filledKeys)
  const skippedFields = instructions.allDataKeys.filter(k => !filledSet.has(k))

  log(`done — ${filled} filled, ${skipped} skipped | filled keys: [${filledKeys.join(', ')}]`)
  return { filled, skipped, filledFields: filledKeys, skippedFields }
}

function showDetails(filledFields: string[], skippedFields: string[]) {
  const el = document.getElementById('details')!
  el.innerHTML = ''

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
  if (skippedFields.length) renderSection(`✗ Skipped (${skippedFields.length})`, 'err', skippedFields, 'chip-err')
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
      const instructions = buildFillInstructions(merged, profile)

      // Attach the resume PDF (base64) so Pass 6 can drop it into the upload box.
      const filename = select.options[select.selectedIndex]?.text ?? 'resume.pdf'
      instructions.resumeFile = await fetchResumeFile(resumeId, filename)

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillPageFields,
        args: [instructions],
      })

      const { filled, skipped, filledFields, skippedFields } = results[0].result as { filled: number; skipped: number; filledFields: string[]; skippedFields: string[] }
      setStatus(`Filled ${filled} field(s)${skipped ? `, skipped ${skipped}` : ''}`, filled > 0 ? 'ok' : 'err')
      showDetails(filledFields, skippedFields)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'err')
    }

    fillBtn.disabled = false
  })
}

init()
