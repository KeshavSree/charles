export type FieldType = 'text' | 'bool' | 'string-enum'

// The field CATALOG: identity, type, options, labels, and value metadata for each field —
// shared by the frontend (renders the Info inputs), the backend (UserInfo schema/columns),
// and the extension popup (builds fill values). It deliberately holds NO detection logic:
// how each field is recognized/filled per ATS lives in the extension registry
// (extension/content/engine/registry.ts). Adding a stored field = one entry here + one
// UserInfo line below (+ schema/model on the backend); wiring detection is a registry edit.
export interface FieldDef {
  /** UserInfo key / ORM column / API JSON key (for stored fields). */
  key: string
  label: string
  type: FieldType
  /** HTML input type for the frontend form */
  inputType?: 'text' | 'email' | 'tel' | 'url'
  /** Default value for EMPTY_USER_INFO */
  defaultValue: string | boolean | null
  /** True for first_name, last_name, email — non-nullable DB columns */
  required: boolean
  /** Override for the fill-value/role key (linkedin_url fills under 'linkedin'). */
  fillKey?: string
  /** Always fill with this exact value regardless of stored user data */
  hardcodedFillValue?: string
  /** ResumeProfile key to use as fallback in mergeForFill */
  profileKey?: string
  /** Filled with a best-guess default — routed to the popup's Double-Check section. */
  doubleCheck?: boolean
  /** Only filled when the user's "aggressive fill" toggle is on; rendered in the Info
   *  page's gated Aggressive Fill section rather than Common Application Questions. */
  aggressive?: boolean
  /** Value is computed (popup/engine), not user-editable — hidden from the Info page.
   *  e.g. worked_here, current_employer, degree_pursuing. */
  derived?: boolean
  /** For string-enum fields: render a dropdown on the Info page. `value` is stored and
   *  matched against the form's option text; `label` is shown to the user. `matchRe` is an
   *  optional regex (source) matching the on-page option text for this choice — used by the
   *  engine's enum matcher so one stored value lands on differently-worded options. */
  options?: Array<{ value: string; label: string; matchRe?: string }>
}

export const FIELDS: FieldDef[] = [
  { key: 'first_name', label: 'First Name', type: 'text', defaultValue: '', required: true, profileKey: 'first_name' },
  { key: 'last_name', label: 'Last Name', type: 'text', defaultValue: '', required: true, profileKey: 'last_name' },
  {
    // The form's "Chosen Name" / preferred first name. Editable on the Info page; when the
    // user hasn't set one, the popup falls back to first_name so a required field still fills.
    key: 'chosen_name', label: 'Chosen Name', type: 'text', defaultValue: null, required: false,
  },
  { key: 'pronouns', label: 'Pronouns', type: 'text', defaultValue: null, required: false },
  { key: 'email', label: 'Email', type: 'text', inputType: 'email', defaultValue: '', required: true, profileKey: 'email' },
  { key: 'phone', label: 'Phone', type: 'text', inputType: 'tel', defaultValue: null, required: false, profileKey: 'phone' },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'text', inputType: 'url', defaultValue: null, required: false, fillKey: 'linkedin', profileKey: 'linkedin_url' },
  { key: 'address', label: 'Address', type: 'text', defaultValue: null, required: false },
  { key: 'city', label: 'City', type: 'text', defaultValue: null, required: false, profileKey: 'location' },
  { key: 'state', label: 'State', type: 'text', defaultValue: null, required: false },
  { key: 'zip_code', label: 'Zip Code', type: 'text', defaultValue: null, required: false },
  { key: 'country', label: 'Country', type: 'text', defaultValue: null, required: false, hardcodedFillValue: 'United States of America' },
  { key: 'work_authorized', label: 'Currently authorized to work?', type: 'bool', defaultValue: null, required: false },
  { key: 'requires_sponsorship', label: 'Need sponsorship / future work auth?', type: 'bool', defaultValue: null, required: false },
  {
    key: 'gender', label: 'Gender', type: 'string-enum', defaultValue: null, required: false,
    options: [
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
    ],
  },
  {
    key: 'ethnicity', label: 'Race / Ethnicity', type: 'string-enum', defaultValue: null, required: false,
    // matchRe lets the canonical value land on each ATS's shorter/differently-worded option.
    options: [
      { value: 'American Indian or Alaskan Native, not Hispanic or Latino', label: 'American Indian or Alaskan Native', matchRe: String.raw`american indian|alaska` },
      { value: 'Asian, not Hispanic or Latino', label: 'Asian', matchRe: String.raw`\basian\b` },
      { value: 'Black, not Hispanic or Latino', label: 'Black', matchRe: String.raw`black|african american` },
      { value: 'Hispanic or Latino', label: 'Hispanic or Latino', matchRe: String.raw`hispanic|latin` },
      { value: 'Native Hawaiian or Other Pacific Islander, not Hispanic or Latino', label: 'Native Hawaiian or Other Pacific Islander', matchRe: String.raw`hawaiian|pacific islander` },
      { value: 'Two or More Races, not Hispanic or Latino', label: 'Two or More Races', matchRe: String.raw`two or more|multiracial|multi-racial` },
      { value: 'White, not Hispanic or Latino', label: 'White', matchRe: String.raw`\bwhite\b|caucasian` },
      { value: 'Decline to Answer', label: 'Decline to Answer', matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'veteran_status', label: 'Veteran Status', type: 'string-enum', defaultValue: null, required: false,
    options: [
      { value: 'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE', label: 'I am a protected veteran', matchRe: String.raw`one or more|^\s*i identify as one|^\s*i am a protected veteran` },
      { value: 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN', label: 'Veteran, not protected', matchRe: String.raw`just not a protected|not a protected veteran` },
      { value: 'I AM NOT A VETERAN', label: 'Not a veteran', matchRe: String.raw`not a (?:protected )?veteran` },
      { value: 'I DO NOT WISH TO SELF-IDENTIFY', label: 'Decline to self-identify', matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'disability_status', label: 'Disability Status', type: 'string-enum', defaultValue: null, required: false,
    // matchRe handles phrasing drift between ATSes ("do not" vs "don't", extra parentheticals).
    options: [
      { value: 'Yes, I have a disability', label: 'Yes, I have a disability (or had one)', matchRe: String.raw`^\s*yes\b` },
      { value: 'No, I do not have a disability', label: 'No, I do not have a disability', matchRe: String.raw`^\s*no\b` },
      { value: 'I do not want to answer', label: 'Decline to answer', matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'hispanic_latino', label: 'Hispanic / Latino?', type: 'string-enum', defaultValue: null, required: false,
    options: [
      { value: 'Yes', label: 'Yes', matchRe: String.raw`^\s*yes\b` },
      { value: 'No', label: 'No', matchRe: String.raw`^\s*no\b` },
      { value: "I don't wish to answer", label: "I don't wish to answer", matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'transgender', label: 'Identify as transgender?', type: 'string-enum', defaultValue: null, required: false,
    options: [
      { value: 'Yes', label: 'Yes', matchRe: String.raw`^\s*yes\b` },
      { value: 'No', label: 'No', matchRe: String.raw`^\s*no\b` },
      { value: "I don't wish to answer", label: "I don't wish to answer", matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  { key: 'would_relocate', label: 'Would you consider relocating?', type: 'bool', defaultValue: null, required: false, doubleCheck: true },
  { key: 'non_compete', label: 'Subject to non-compete / non-solicitation?', type: 'bool', defaultValue: null, required: false },
  { key: 'us_gov_employee', label: 'Current/former U.S. government employee?', type: 'bool', defaultValue: null, required: false },
  { key: 'gov_contracting', label: 'Government contracting responsibilities?', type: 'bool', defaultValue: null, required: false },
  { key: 'export_restricted', label: 'Citizen/resident of Iran, Cuba, N. Korea, Syria, Crimea, DNR/LNR?', type: 'bool', defaultValue: null, required: false },
  { key: 'f1_student', label: 'Are you an F-1 student?', type: 'bool', defaultValue: null, required: false },
  { key: 'enrolled_returning', label: 'Enrolled and returning to school after the internship?', type: 'bool', defaultValue: null, required: false },
  { key: 'privacy_ack', label: 'Applicant Privacy Acknowledgement', type: 'bool', defaultValue: null, required: false, aggressive: true },
  {
    // Aggressive + derived: "Have you worked at <company>?" — the engine derives the answer
    // from the question's company + the user's company list (no stored value).
    key: 'worked_here', label: 'Have you worked here before? (auto)', type: 'bool', defaultValue: null, required: false, aggressive: true, derived: true,
  },
  {
    // Derived from the résumé's most-recent education degree (computed in the popup).
    key: 'degree_pursuing', label: 'Degree currently pursuing (auto)', type: 'string-enum', defaultValue: null, required: false, derived: true,
    options: [
      { value: "Bachelor's", label: "Bachelor's", matchRe: String.raw`bachelor|undergrad|\bb\.?\s?[sa]\b` },
      { value: "Master's", label: "Master's", matchRe: String.raw`master|\bm\.?\s?[sa]\b|m\.?eng` },
      { value: 'MBA', label: 'MBA', matchRe: String.raw`\bmba\b` },
      { value: 'PhD', label: 'PhD', matchRe: String.raw`ph\.?\s?d|doctor` },
      { value: 'Other', label: 'Other', matchRe: String.raw`\bother\b` },
      { value: 'N/A', label: 'N/A', matchRe: String.raw`n\/?a|not applicable` },
    ],
  },
  {
    // Derived from the résumé's most-recent grad month+year, normalized to a June/December
    // term (computed in the popup).
    key: 'grad_date', label: 'Expected graduation (auto)', type: 'string-enum', defaultValue: null, required: false, derived: true,
  },
  {
    // Derived (like full_name) from the résumé's most-recent job — computed in the popup;
    // not stored, so there's no UserInfo/backend column and it's hidden from the Info page.
    key: 'current_employer', label: 'Current/Previous Employer (auto)', type: 'text', defaultValue: null, required: false, derived: true,
  },
  { key: 'current_title', label: 'Current/Previous Job Title (auto)', type: 'text', defaultValue: null, required: false, derived: true },
  { key: 'twitter', label: 'Twitter', type: 'text', inputType: 'url', defaultValue: null, required: false },
  { key: 'facebook', label: 'Facebook', type: 'text', inputType: 'url', defaultValue: null, required: false },
]

// Explicit interface alongside the catalog — both live in one file.
// Adding a stored field: add one entry to FIELDS above + one line here.
export interface UserInfo {
  first_name: string
  last_name: string
  chosen_name: string | null
  pronouns: string | null
  email: string
  phone: string | null
  linkedin_url: string | null
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  work_authorized: boolean | null
  requires_sponsorship: boolean | null
  gender: string | null
  ethnicity: string | null
  veteran_status: string | null
  disability_status: string | null
  hispanic_latino: string | null
  transgender: string | null
  would_relocate: boolean | null
  non_compete: boolean | null
  us_gov_employee: boolean | null
  gov_contracting: boolean | null
  export_restricted: boolean | null
  f1_student: boolean | null
  enrolled_returning: boolean | null
  privacy_ack: boolean | null
  worked_here: boolean | null
  degree_pursuing: string | null
  grad_date: string | null
  twitter: string | null
  facebook: string | null
  // Aggressive-fill settings (not in FIELDS — like skills/websites).
  aggressive_fill: boolean
  worked_companies: string[]
  skills: string[]
  websites: string[]
}

export const EMPTY_USER_INFO: UserInfo = {
  ...(Object.fromEntries(FIELDS.map((f) => [f.key, f.defaultValue])) as Omit<UserInfo, 'skills' | 'websites' | 'aggressive_fill' | 'worked_companies'>),
  aggressive_fill: false,
  worked_companies: [],
  skills: [],
  websites: [],
}

export const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.label])),
  full_name: 'Full Name',
  linkedin: 'LinkedIn',  // alias for linkedin_url — fills under 'linkedin'
  skills: 'Skills',
  websites: 'Websites',
  resume: 'Resume',
  date: "Today's date",
}
