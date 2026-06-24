// Shared types for the autofill engine. See registry.ts (the ATS × widget × field map),
// the widget modules (detect/fill/isEmpty per widget), and runtime.ts (the generic loop).

export type FillStatus = 'filled' | 'skipped' | 'failed'

export interface FillResult {
  /** Chip/label key for the popup details panel. */
  role: string
  status: FillStatus
  detail?: string
}

// Semantic profile data sent from the popup. Workday-specific field mapping lives
// in the section widget, NOT here.
export interface ExperienceEntry {
  company: string
  title: string
  location: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  display_order: number
}

export interface EducationEntry {
  institution: string
  degree: string | null
  major: string | null
  gpa: string | null
  grad_year: string | null
  grad_month: string | null
  display_order: number
}

// Plain, serializable user data computed by the popup and handed to the engine.
export interface FillRequest {
  /** role → value, for text / combobox / radio / checkbox fields (incl. full_name). */
  values: Record<string, string | boolean | null>
  experience: ExperienceEntry[]
  education: EducationEntry[]
  websites: string[]
  skills: string[]
  resume: { base64: string; filename: string } | null
  /** "Aggressive fill" toggle — gates aggressive-marked roles (privacy_ack, worked_here). */
  aggressive: boolean
  /** Companies the user has worked at — used to derive "have you worked at X?" answers. */
  workedCompanies: string[]
}

export interface FillContext {
  req: FillRequest
  log: (msg: string) => void
}

export interface FillSummary {
  filled: number
  filledFields: string[]
  /** Filled with a best-guess default — the user should verify these on the form. */
  doubleCheckFields: string[]
  /** Every empty field on the page, by its question text (the "Not filled" list). */
  unanswered: string[]
  /** The amber subset of unanswered — fields we had an answer for but couldn't fill. */
  didntLand: string[]
  /** role → on-page question text for each detected field (for filled/double-check chips). */
  questions: Record<string, string>
}

// ---------------------------------------------------------------------------
// Registry-based engine (ATS × widget × field).
//
// A Widget owns one widget type end-to-end: detect (find candidates), label
// (text to match rules against), fill, and isEmpty (review). The REGISTRY
// (registry.ts) maps each ATS's widgets to the fields they carry, each field
// keyed to a recognition rule (the per-leaf rule). The generic runtime
// (runtime.ts) walks the registry for the current ATS, detects candidates per
// widget, matches each to a field by its rule, and fills it.
// ---------------------------------------------------------------------------

export type Ats = 'greenhouse' | 'workday'

/** One detected DOM unit of a widget type. `handle` is the element the widget operates on. */
export interface Candidate {
  handle: HTMLElement
}

/** Per-field fill tuning carried on a leaf (or produced by its resolve()). */
export interface FillOpts {
  /** react-select typeahead: type-to-search + closest-token fallback. */
  fuzzy?: boolean
  /** Score on-page option text (higher = better) — multi-way questions (worked_here). */
  rank?: (text: string) => number
}

/** Field value + resolved fill options for one detected candidate. */
export interface FillInput {
  field: string
  value: string | boolean | null
  opts: FillOpts
}

/** A registry leaf's recognition rule: a bare RegExp, or an object with quirks. */
export type LeafRule = RegExp | FieldRule

export interface FieldRule {
  /** Match the candidate's label/attr text. A predicate also gets the raw candidate. */
  match: RegExp | ((label: string, c: Candidate) => boolean)
  /** Negative label regex — if this also matches, reject (mirrors classifyExcludeRe). */
  exclude?: RegExp
  /** Reject an otherwise-matching candidate by DOM (e.g. a phone country-code dropdown). */
  reject?: (c: Candidate) => boolean
  /** Compute value + opts at fill time from the DOM + request (e.g. worked_here). */
  resolve?: (c: Candidate, req: FillRequest) => { value: string | boolean | null; opts?: FillOpts }
  /** Static fill options for this leaf (e.g. fuzzy: true for a typeahead). */
  fillOpts?: FillOpts
}

export interface Widget {
  name: string
  /** Lower runs first (cheap/sync before async/click-driven). Mirrors old strategy priority. */
  priority: number
  detect(doc: Document): Candidate[]
  /** Text used to match leaf rules: combined attrs for inputs, question text for groups. */
  label(c: Candidate): string
  fill(c: Candidate, input: FillInput, ctx: FillContext): Promise<FillResult[]>
  /** For the review pass: is this candidate still unfilled? */
  isEmpty(c: Candidate): boolean
}

/** A registry leaf: a widget + the fields it carries, keyed by field with a rule. */
export interface Leaf {
  widget: Widget
  fields: Record<string, LeafRule>
}
