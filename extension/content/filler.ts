export function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('input',  { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur',   { bubbles: true }))
}

export function fillSelect(el: HTMLSelectElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export function fillElement(el: HTMLElement | null, value: string): boolean {
  if (!el || !value) return false
  if (el instanceof HTMLSelectElement) {
    fillSelect(el, value)
    return true
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    fillInput(el, value)
    return true
  }
  return false
}
