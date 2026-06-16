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
  /** For string-enum fields: render a dropdown on the Info page. `value` is stored and
   *  matched (exact-or-prefix) against the form's option text; `label` is shown to the user. */
  options?: Array<{ value: string; label: string }>
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
    key: 'work_authorized', label: 'Authorized to work (US)?', type: 'bool',
    defaultValue: null, required: false,
    // Intentionally NOT matching bare "work authorization" — that phrase also appears in
    // the sponsorship question ("…to maintain work authorization…"), which must resolve to
    // requires_sponsorship instead.
    groupRe: String.raw`authorized.?to.?work|legally.?authorized|eligible.?to.?work`,
  },
  {
    key: 'requires_sponsorship', label: 'Requires Sponsorship?', type: 'bool',
    defaultValue: null, required: false,
    groupRe: String.raw`sponsorship|visa.?sponsor|require.*sponsor`,
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
    // Values omit the "(United States of America)" suffix — startsWith matching still hits.
    options: [
      { value: 'American Indian or Alaskan Native, not Hispanic or Latino', label: 'American Indian or Alaskan Native' },
      { value: 'Asian, not Hispanic or Latino', label: 'Asian' },
      { value: 'Black, not Hispanic or Latino', label: 'Black' },
      { value: 'Hispanic or Latino', label: 'Hispanic or Latino' },
      { value: 'Native Hawaiian or Other Pacific Islander, not Hispanic or Latino', label: 'Native Hawaiian or Other Pacific Islander' },
      { value: 'Two or More Races, not Hispanic or Latino', label: 'Two or More Races' },
      { value: 'White, not Hispanic or Latino', label: 'White' },
      { value: 'Decline to Answer', label: 'Decline to Answer' },
    ],
  },
  {
    key: 'veteran_status', label: 'Veteran Status', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`veteran`,
    options: [
      { value: 'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE', label: 'I am a protected veteran' },
      { value: 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN', label: 'Veteran, not protected' },
      { value: 'I AM NOT A VETERAN', label: 'Not a veteran' },
      { value: 'I DO NOT WISH TO SELF-IDENTIFY', label: 'Decline to self-identify' },
    ],
  },
  {
    key: 'disability_status', label: 'Disability Status', type: 'string-enum',
    defaultValue: null, required: false,
    groupRe: String.raw`disability|disabled`,
    // Values are prefixes of Workday's checkbox labels — startsWith matching hits them.
    options: [
      { value: 'Yes, I have a disability', label: 'Yes, I have a disability (or had one)' },
      { value: 'No, I do not have a disability', label: 'No, I do not have a disability' },
      { value: 'I do not want to answer', label: 'Decline to answer' },
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
  would_relocate: boolean | null
  non_compete: boolean | null
  us_gov_employee: boolean | null
  gov_contracting: boolean | null
  export_restricted: boolean | null
  twitter: string | null
  facebook: string | null
  skills: string[]
  websites: string[]
}

export const EMPTY_USER_INFO: UserInfo = {
  ...(Object.fromEntries(FIELDS.map((f) => [f.key, f.defaultValue])) as Omit<UserInfo, 'skills' | 'websites'>),
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
