// Shared types for the autofill engine.
//
// Three layers collaborate:
//   Detector    — recognizes fields in the DOM → DetectedField[] (role + widget + handle)
//   FillStrategy — operates ONE widget type; keyed by widget, not by field
//   Dispatcher  — loop: detect → look up value by role → pick strategy → fill → collect

export type WidgetType =
  | 'text'
  | 'native-select'
  | 'radio-group'
  | 'checkbox'
  | 'wd-checkbox-group'
  | 'wd-combobox'
  | 'wd-combobox-question'
  | 'wd-multiselect'
  | 'wd-section'
  | 'wd-date'
  | 'file-upload'

export interface DetectedField {
  /** Semantic role: a FIELDS key/fillKey, or 'experience' | 'education' | 'skills' | 'resume'. */
  role: string
  widget: WidgetType
  /** The element a strategy operates on (input, container, group, Add button, …). */
  handle: HTMLElement
}

export type FillStatus = 'filled' | 'skipped' | 'failed'

export interface FillResult {
  /** Chip/label key for the popup details panel. */
  role: string
  status: FillStatus
  detail?: string
}

// Semantic profile data sent from the popup. Workday-specific field mapping lives
// in the section strategy, NOT here.
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
}

export interface FillContext {
  req: FillRequest
  log: (msg: string) => void
}

export interface FillStrategy {
  widget: WidgetType
  /** Lower runs first. Encodes the old pass order: cheap/synchronous before async/click-driven. */
  priority: number
  fill(field: DetectedField, ctx: FillContext): Promise<FillResult[]>
}

export interface Detector {
  ats: string
  detectFields(doc: Document): DetectedField[]
}

export interface FillSummary {
  filled: number
  skipped: number
  filledFields: string[]
  skippedFields: string[]
  /** Filled with a best-guess default — the user should verify these on the form. */
  doubleCheckFields: string[]
  /** Post-fill review: required empty fields on the page (outlined red). */
  needsYou: string[]
  /** Post-fill review: fields we had an answer for but couldn't fill (outlined amber). */
  didntLand: string[]
}
