// THE MAP. ATS → widget → { field: rule }. The single place that shows, per ATS, which
// fields are supported and how each is recognized. Each leaf pairs a widget module (which
// owns detect + fill + isEmpty) with the fields it carries, keyed by field role to a
// recognition rule. Rules are defined once below and listed per-leaf (shorthand or via the
// GROUP_* sets), so a field's presence is visible at the leaf while the regex stays
// single-sourced; any leaf may override inline (fuzzy/resolve, or a different rule — e.g.
// Workday's combobox matches country/state by data-automation-id, not by label).
//
// A field missing from an ATS = a visible gap (no leaf carries it). The runtime walks
// REGISTRY[ats] in order: container/dropdown/section widgets are listed before the plain
// text/checkbox widgets so their elements get claimed first (claimed-subtree logic in
// runtime.ts), reproducing the old "housing" exclusions.

import type { Leaf, LeafRule, Ats } from './types'
import { textWidget } from './widgets/text'
import { radioWidget } from './widgets/radio'
import { checkboxWidget } from './widgets/checkbox'
import { fileWidget } from './widgets/file'
import { reactSelectWidget } from './widgets/greenhouse/reactSelect'
import { educationWidget } from './widgets/greenhouse/education'
import { comboboxWidget } from './widgets/workday/combobox'
import { comboboxQuestionWidget } from './widgets/workday/comboboxQuestion'
import { checkboxGroupWidget } from './widgets/workday/checkboxGroup'
import { multiselectWidget } from './widgets/workday/multiselect'
import { dateWidget } from './widgets/workday/date'
import { sectionWidget } from './widgets/workday/section'
import { deriveWorkedHere, workedHereRank } from './helpers/workedHere'

// --- Recognition rules (single-sourced; mirror the old fields.ts classifyRe/groupRe) ---

// Text / classify rules (matched against a control's combined attribute text).
const full_name: LeafRule = {
  match: (label, c) =>
    c.handle.getAttribute('autocomplete') === 'name' ||
    c.handle.getAttribute('name') === 'name' ||
    /\bfull.?name\b/i.test(label),
}
const first_name = /given.?name|first.?name|\bfname\b|legalname.*first|legalname--first/i
const last_name = /family.?name|last.?name|\blname\b|legalname.*last|legalname--last/i
const chosen_name = /chosen.?name/i
const pronouns = /pronoun/i
const email = /\bemail\b/i
const phone: LeafRule = { match: /\bphone\b|\bmobile\b|\btel\b/i, exclude: /extension|type|country.?code|sms/i }
const linkedin = /linkedin/i
const address: LeafRule = { match: /\baddress\b|\bstreet\b/i, exclude: /\bcity\b|\bpostal\b|\bzip\b|\bstate\b|\bregion\b/i }
const city = /\bcity\b|\blocation\b/i
const state = /\bstate\b|\bprovince\b|\bregion\b/i
const zip_code = /\bzip\b|\bpostal\b/i
const country = /\bcountry\b/i
const current_employer = /\bemployer\b/i
const current_title = /job.?title|(current|previous|most.?recent).{0,20}\btitle\b/i
const twitter = /twitter/i
const facebook = /facebook/i
const school = /college|university|institution|\bschool\b/i
const github = /github/i
const website = /\bwebsite\b|portfolio|personal.?site/i

// Workday combobox aid patterns (matched against the container's data-automation-id).
const countryAid = /\bcountry\b(?!Phone|Region)/i
const stateAid = /countryRegion|stateProvince/i

// Group / question rules (matched against a choice question's label text).
const work_authorized = /authorized.?to.?work|legally.?authorized|eligible.?to.?work/i
const requires_sponsorship = /sponsorship|visa.?sponsor|require.*sponsor|assist\w*.{0,30}work.{0,20}authoriz|work.{0,20}authoriz\w*.{0,30}assist/i
const gender = /\bgender\b/i
// Race question. Excludes the Hispanic/Latino question's phrasing so it isn't stolen when the
// shared EEO section heading ("Race/Ethnicity") bleeds into the Hispanic question's label.
const ethnicity: LeafRule = {
  match: /ethnicity|\brace\b|racial/i,
  exclude: /are you.{0,15}hispanic|hispanic origin/i,
}
const veteran_status = /veteran/i
const disability_status = /disability|disabled/i
// Hispanic/Latino Yes/No question. Excludes the "identify your race" question's phrasing so
// it isn't stolen when "hispanic" bleeds into the race question's label from the shared section.
const hispanic_latino: LeafRule = {
  match: /hispanic|latin/i,
  exclude: /\byour race\b/i,
}
const transgender = /transgender/i
const would_relocate = /relocat/i
const non_compete = /non.?compete|non.?solicitation/i
const us_gov_employee = /employee of.{0,30}government/i
const gov_contracting = /contracting responsibilit/i
const export_restricted = /iran.{0,20}cuba|export.?control/i
const f1_student = /f-?1 student|f-?1 visa/i
const enrolled_returning = /return to the program|will return.*upon completion|enrolled.*will return/i
const privacy_ack = /applicant privacy|privacy ack|privacy.?(statement|policy|notice)|acknowledg.*privacy/i
const job_alerts = /similar jobs|job alerts|receive.{0,20}alert/i
const degree_pursuing = /degree are you (currently )?pursuing|what degree.*pursuing|degree.*currently pursuing/i
const grad_date = /expect.{0,4}graduat|graduation date|anticipated graduation|graduate or complete your program|when do you (expect to )?(graduate|complete)/i
const workedHereRe = /have you (ever )?worked (at|for)|been employed|employed (at|by)|previously (worked|employed)|former employee/i

// Catch-all for widgets whose single field carries no field text (resume input, the
// education section, the skills box) — detection presence is the signal, not a label match.
const always: LeafRule = { match: () => true }

// All choice questions, in FIELDS order (radios, GH dropdown, WD combobox-question).
const GROUP_ALL: Record<string, LeafRule> = {
  // hispanic_latino before ethnicity: the "Are you Hispanic/Latino?" Yes/No question often
  // resolves a label containing "race/ethnicity" (section heading), so the broader ethnicity
  // rule would otherwise steal it.
  work_authorized, requires_sponsorship, gender, hispanic_latino, ethnicity, veteran_status,
  disability_status, transgender, would_relocate, non_compete, us_gov_employee, gov_contracting,
  export_restricted, f1_student, enrolled_returning, privacy_ack, job_alerts, degree_pursuing, grad_date,
}
// Bool-only subset (standalone checkboxes).
const GROUP_BOOL: Record<string, LeafRule> = {
  work_authorized, requires_sponsorship, would_relocate, non_compete, us_gov_employee,
  gov_contracting, export_restricted, f1_student, enrolled_returning, privacy_ack, job_alerts,
}
// Enum-only subset (Workday mutually-exclusive checkbox groups).
const GROUP_ENUM: Record<string, LeafRule> = {
  gender, hispanic_latino, ethnicity, veteran_status, disability_status, transgender,
  degree_pursuing, grad_date,
}

// --- Shared-widget leaf builders (identical wiring across ATSes) ---

const textLeaf = (): Leaf => ({
  widget: textWidget,
  fields: {
    full_name, first_name, last_name, chosen_name, pronouns, email, phone, linkedin,
    address, city, state, zip_code, country, current_employer, current_title, school,
    twitter, facebook, github, website,
  },
})
const radioLeaf = (): Leaf => ({ widget: radioWidget, fields: { ...GROUP_ALL } })
const checkboxLeaf = (): Leaf => ({ widget: checkboxWidget, fields: { ...GROUP_BOOL } })
const fileLeaf = (): Leaf => ({ widget: fileWidget, fields: { resume: always } })

// worked_here: derive value (and rank multi-way options) from the question's company.
const workedHereLeafRule: LeafRule = {
  match: workedHereRe,
  resolve: (c, req) => {
    const st = deriveWorkedHere(c.handle, req)
    if (!st) return { value: null }
    return { value: st.worked, opts: { rank: workedHereRank(st) } }
  },
}

export const REGISTRY: Record<Ats, Record<string, Leaf>> = {
  greenhouse: {
    // Dropdown lists group questions BEFORE country/city so "…authorized to work in the
    // country…" resolves to work_authorized, not country (first match). Phone country-code
    // selectors fill via matchOption's dial-code tier (no special-casing).
    dropdown: {
      widget: reactSelectWidget,
      fields: {
        ...GROUP_ALL, worked_here: workedHereLeafRule, country,
        city: { match: city, fillOpts: { fuzzy: true } },
        // Standalone "What college/university do you attend?" dropdown. Reject the education
        // section's school--N/degree--N selects (handled by the education widget).
        school: { match: school, reject: (c) => /^(school|degree)--/.test(c.handle.id), fillOpts: { fuzzy: true } },
      },
    },
    education: { widget: educationWidget, fields: { education: always } },
    radio: radioLeaf(),
    checkbox: checkboxLeaf(),
    text: textLeaf(),
    file: fileLeaf(),
  },
  workday: {
    combobox: { widget: comboboxWidget, fields: { country: countryAid, state: stateAid } },
    comboboxQuestion: { widget: comboboxQuestionWidget, fields: { ...GROUP_ALL } },
    checkboxGroup: { widget: checkboxGroupWidget, fields: { ...GROUP_ENUM } },
    section: { widget: sectionWidget, fields: { experience: /work.?experience/i, education: /education/i, websites: /websites/i } },
    date: {
      widget: dateWidget,
      fields: { date: { match: (label, c) => /^date\s*\*?$/.test(label.trim()) || c.handle.querySelector('[name="date" i]') !== null } },
    },
    multiselect: { widget: multiselectWidget, fields: { skills: always } },
    radio: radioLeaf(),
    checkbox: checkboxLeaf(),
    text: textLeaf(),
    file: fileLeaf(),
  },
}
