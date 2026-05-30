export function detectFieldsAshby(): Record<string, HTMLElement | null> {
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)

  function byLabel(text: string): HTMLElement | null {
    for (const label of Array.from(document.querySelectorAll('label'))) {
      if (label.textContent?.toLowerCase().includes(text.toLowerCase())) {
        const id = label.getAttribute('for')
        if (id) return document.getElementById(id)
        return label.nextElementSibling as HTMLElement | null
      }
    }
    return null
  }

  return {
    first_name: q('input[autocomplete="given-name"]')   ?? byLabel('first name'),
    last_name:  q('input[autocomplete="family-name"]')  ?? byLabel('last name'),
    email:      q('input[type="email"]')                ?? byLabel('email'),
    phone:      q('input[type="tel"]')                  ?? byLabel('phone'),
    linkedin:   byLabel('linkedin'),
    location:   byLabel('location') ?? byLabel('city'),
  }
}
