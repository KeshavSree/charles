export function detectFieldsLever(): Record<string, HTMLElement | null> {
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)
  return {
    full_name:  q('input[name="name"]'),           // Lever unified name field
    first_name: q('input[autocomplete="given-name"]'),
    last_name:  q('input[autocomplete="family-name"]'),
    email:      q('input[name="email"]'),
    phone:      q('input[name="phone"]'),
    linkedin:   q('input[name="urls[LinkedIn]"]')
              ?? q('input[placeholder*="LinkedIn"]'),
    location:   q('input[name="location"]'),
  }
}
