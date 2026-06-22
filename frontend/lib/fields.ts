export type FieldType = 'text' | 'bool' | 'string-enum'

export interface FieldDef {
  /** Matches Python ORM column name and API JSON key exactly */
  key: string
  label: string
  type: FieldType
  /** HTML input type for the frontend form */
  inputType?: 'text' | 'email' | 'tel' | 'url'
  /** Default value for EMPTY_USER_INFO */
  defaultValue: string | boolean | null
  /** True for first_name, last_name, email — non-nullable DB columns */
  required: boolean
  /** Regex source matched against the combined attribute string in classify() */
  classifyRe?: string
  /** Negative regex for classify() — if this also matches, field is rejected */
  classifyExcludeRe?: string
  /** Override for the key returned by classify() (linkedin_url returns 'linkedin') */
  fillKey?: string
  /** Workday data-automation-id regex for custom combobox widgets */
  aidPattern?: string
  /** Always fill with this exact value regardless of stored user data */
  hardcodedFillValue?: string
  /** Regex to match a radio/checkbox question group label */
  groupRe?: string
  /** ResumeProfile key to use as fallback in mergeForFill */
  profileKey?: string
  /** Filled with a best-guess default — routed to the popup's Double-Check section. */
  doubleCheck?: boolean
  /** Only filled when the user's "aggressive fill" toggle is on; rendered in the Info
   *  page's gated Aggressive Fill section rather than Common Application Questions. */
  aggressive?: boolean
  /** Value is computed by the engine at fill time (not stored, not user-editable) —
   *  e.g. worked_here, derived from the question's company + the user's company list. */
  derived?: boolean
  /** For string-enum fields: render a dropdown on the Info page. `value` is stored and
   *  matched (exact-or-prefix) against the form's option text; `label` is shown to the user.
   *  `matchRe` is an optional regex (source) matching the on-page option text for this
   *  choice — lets one stored value land on differently-worded options across ATSes
   *  (e.g. "No, I do not have a disability" → Greenhouse's "No, I don't have a disability"). */
  options?: Array<{ value: string; label: string; matchRe?: string }>
}

export const FIELDS: FieldDef[] = [
  {
    key: 'first_name', label: 'First Name', type: 'text',
    defaultValue: '', required: true,
    classifyRe: String.raw`given.?name|first.?name|\bfname\b|legalname.*first|legalname--first`,
    profileKey: 'first_name',
  },
  {
    key: 'last_name', label: 'Last Name', type: 'text',
    defaultValue: '', required: true,
    classifyRe: String.raw`family.?name|last.?name|\blname\b|legalname.*last|legalname--last`,
    profileKey: 'last_name',
  },
  {
    // The form's "Chosen Name" / preferred first name. Editable on the Info page; when the
    // user hasn't set one, the popup falls back to first_name (see buildFillRequest) so a
    // required "Chosen Name" field always fills.
    key: 'chosen_name', label: 'Chosen Name', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`chosen.?name`,
  },
  {
    key: 'pronouns', label: 'Pronouns', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`pronoun`,
  },
  {
    key: 'email', label: 'Email', type: 'text', inputType: 'email',
    defaultValue: '', required: true,
    classifyRe: String.raw`\bemail\b`,
    profileKey: 'email',
  },
  {
    key: 'phone', label: 'Phone', type: 'text', inputType: 'tel',
    defaultValue: null, required: false,
    classifyRe: String.raw`\bphone\b|\bmobile\b|\btel\b`,
    classifyExcludeRe: String.raw`extension|type|country.?code|sms`,
    profileKey: 'phone',
  },
  {
    key: 'linkedin_url', label: 'LinkedIn URL', type: 'text', inputType: 'url',
    defaultValue: null, required: false,
    classifyRe: String.raw`linkedin`,
    fillKey: 'linkedin',
    profileKey: 'linkedin_url',
  },
  {
    key: 'address', label: 'Address', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`\baddress\b|\bstreet\b`,
    classifyExcludeRe: String.raw`\bcity\b|\bpostal\b|\bzip\b|\bstate\b|\bregion\b`,
  },
  {
    key: 'city', label: 'City', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`\bcity\b|\blocation\b`,
    profileKey: 'location',
  },
  {
    key: 'state', label: 'State', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`\bstate\b|\bprovince\b|\bregion\b`,
    aidPattern: String.raw`countryRegion|stateProvince`,
  },
  {
    key: 'zip_code', label: 'Zip Code', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`\bzip\b|\bpostal\b`,
  },
  {
    key: 'country', label: 'Country', type: 'text',
    defaultValue: null, required: false,
    classifyRe: String.raw`\bcountry\b`,
    aidPattern: String.raw`\bcountry\b(?!Phone|Region)`,
    hardcodedFillValue: 'United States of America',
  },
  {
    // Present/current work authorization. Country-agnostic — the question may name the US
    // ("authorized to work in the United States") or the country of application ("…in the
    // country in which you are applying"); we treat both the same, since applicants apply
    // where they can work. Still NOT matching bare "work authorization" — that phrase
    // belongs to the future/sponsorship question (requires_sponsorship) below.
    key: 'work_authorized', label: 'Currently authorized to work?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`authorized.?to.?work|legally.?authorized|eligible.?to.?work`,
  },
  {
    // Future work authorization — sponsorship OR "will you require assistance with work
    // authorization now or in the future?". Country-agnostic. The "assist … work authoriz"
    // patterns catch the assistance phrasing (which has no "sponsor" word) and stay distinct
    // from the present work_authorized question above ("authorized to work", not "work
    // authorization assistance").
    key: 'requires_sponsorship', label: 'Need sponsorship / future work auth?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`sponsorship|visa.?sponsor|require.*sponsor|assist\w*.{0,30}work.{0,20}authoriz|work.{0,20}authoriz\w*.{0,30}assist`,
  },
  {
    key: 'gender', label: 'Gender', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`\bgender\b`,
    options: [
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
    ],
  },
  {
    key: 'ethnicity', label: 'Race / Ethnicity', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`ethnicity|race|racial`,
    // matchRe lets the canonical value land on each ATS's shorter/differently-worded
    // option (e.g. "Asian, not Hispanic or Latino" → an option simply labeled "Asian").
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
    key: 'veteran_status', label: 'Veteran Status', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`veteran`,
    options: [
      { value: 'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE', label: 'I am a protected veteran', matchRe: String.raw`one or more|^\s*i identify as one|^\s*i am a protected veteran` },
      { value: 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN', label: 'Veteran, not protected', matchRe: String.raw`just not a protected|not a protected veteran` },
      { value: 'I AM NOT A VETERAN', label: 'Not a veteran', matchRe: String.raw`not a (?:protected )?veteran` },
      { value: 'I DO NOT WISH TO SELF-IDENTIFY', label: 'Decline to self-identify', matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'disability_status', label: 'Disability Status', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`disability|disabled`,
    // matchRe handles phrasing drift between ATSes ("do not" vs "don't", extra parentheticals).
    options: [
      { value: 'Yes, I have a disability', label: 'Yes, I have a disability (or had one)', matchRe: String.raw`^\s*yes\b` },
      { value: 'No, I do not have a disability', label: 'No, I do not have a disability', matchRe: String.raw`^\s*no\b` },
      { value: 'I do not want to answer', label: 'Decline to answer', matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'hispanic_latino', label: 'Hispanic / Latino?', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`hispanic|latin`,
    options: [
      { value: 'Yes', label: 'Yes', matchRe: String.raw`^\s*yes\b` },
      { value: 'No', label: 'No', matchRe: String.raw`^\s*no\b` },
      { value: "I don't wish to answer", label: "I don't wish to answer", matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'transgender', label: 'Identify as transgender?', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`transgender`,
    options: [
      { value: 'Yes', label: 'Yes', matchRe: String.raw`^\s*yes\b` },
      { value: 'No', label: 'No', matchRe: String.raw`^\s*no\b` },
      { value: "I don't wish to answer", label: "I don't wish to answer", matchRe: String.raw`wish|decline|prefer not|do(?:n.?t| not) want|rather not` },
    ],
  },
  {
    key: 'would_relocate', label: 'Would you consider relocating?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`relocat`,
    doubleCheck: true,
  },
  {
    key: 'non_compete', label: 'Subject to non-compete / non-solicitation?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`non.?compete|non.?solicitation`,
  },
  {
    key: 'us_gov_employee', label: 'Current/former U.S. government employee?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`employee of.{0,30}government`,
  },
  {
    key: 'gov_contracting', label: 'Government contracting responsibilities?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`contracting responsibilit`,
  },
  {
    key: 'export_restricted', label: 'Citizen/resident of Iran, Cuba, N. Korea, Syria, Crimea, DNR/LNR?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`iran.{0,20}cuba|export.?control`,
  },
  {
    key: 'f1_student', label: 'Are you an F-1 student?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`f-?1 student|f-?1 visa`,
  },
  {
    key: 'enrolled_returning', label: 'Enrolled and returning to school after the internship?', type: 'bool',
    defaultValue: null, required: false,
    // Distinct from the other "enrolled in a university or program" questions (grad date /
    // degree pursuing) — keyed on the "return … upon completion" clause.
    groupRe: String.raw`return to the program|will return.*upon completion|enrolled.*will return`,
  },
  {
    // Aggressive: a privacy-consent question we answer with the user's stored Yes/No.
    key: 'privacy_ack', label: 'Applicant Privacy Acknowledgement', type: 'bool',
    defaultValue: null, required: false,
    aggressive: true,
    groupRe: String.raw`applicant privacy|privacy ack|privacy.?(statement|policy|notice)|acknowledg.*privacy`,
  },
  {
    // Aggressive + derived: "Have you worked at <company>?" — answered by the engine by
    // matching the question's company against the user's company list (no stored value).
    key: 'worked_here', label: 'Have you worked here before? (auto)', type: 'bool',
    defaultValue: null, required: false,
    aggressive: true, derived: true,
    groupRe: String.raw`have you (ever )?worked (at|for)|previously (worked|employed)|former employee`,
  },
  {
    // Derived from the résumé's most-recent education degree (not user-set).
    key: 'degree_pursuing', label: 'Degree currently pursuing (auto)', type: 'string-enum',
    defaultValue: null, required: false,
    derived: true,
    groupRe: String.raw`degree are you (currently )?pursuing|what degree.*pursuing|degree.*currently pursuing`,
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
    // Derived from the résumé's most-recent education grad month+year, normalized to the
    // nearest June/December term (e.g. "May 2028" → "June 2028"). No stored value.
    key: 'grad_date', label: 'Expected graduation (auto)', type: 'string-enum',
    defaultValue: null, required: false,
    derived: true,
    groupRe: String.raw`expect to graduate|graduate or complete your program|when do you expect to (graduate|complete)`,
  },
  {
    // Derived (like full_name) from the résumé's most-recent job — a current role if any,
    // else the entry with the latest end date. Computed in the popup's buildFillRequest;
    // not stored, so there's no UserInfo/backend column and it's hidden from the Info page.
    key: 'current_employer', label: 'Current/Previous Employer (auto)', type: 'text',
    defaultValue: null, required: false, derived: true,
    classifyRe: String.raw`\bemployer\b`,
  },
  {
    key: 'current_title', label: 'Current/Previous Job Title (auto)', type: 'text',
    defaultValue: null, required: false, derived: true,
    classifyRe: String.raw`job.?title|(current|previous|most.?recent).{0,20}\btitle\b`,
  },
  {
    key: 'twitter', label: 'Twitter', type: 'text', inputType: 'url',
    defaultValue: null, required: false,
    classifyRe: String.raw`twitter`,
  },
  {
    key: 'facebook', label: 'Facebook', type: 'text', inputType: 'url',
    defaultValue: null, required: false,
    classifyRe: String.raw`facebook`,
  },
]

// Explicit interface alongside the registry — both live in one file.
// Adding a field: add one entry to FIELDS above + one line here.
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
  linkedin: 'LinkedIn',  // alias for linkedin_url — classify() returns 'linkedin'
  skills: 'Skills',
  websites: 'Websites',
  resume: 'Resume',
  date: "Today's date",
}
