export function detectFieldsGreenhouse(): Record<string, HTMLElement | null> {
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)
  return {
    first_name: q('[name="job_application[first_name]"]'),
    last_name:  q('[name="job_application[last_name]"]'),
    email:      q('[name="job_application[email]"]'),
    phone:      q('[name="job_application[phone]"]'),
    linkedin:   q('[name="job_application[linkedin_profile]"]')
              ?? q('input[id*="linkedin"]'),
    location:   q('[name="job_application[location]"]')
              ?? q('input[id*="location"]'),
  }
}
