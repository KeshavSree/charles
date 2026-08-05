// Scan the mutually-exclusive disability-status checkboxes. Run on the page with them.

// 1. Find the tightest container that holds the disability text + checkbox(es).
const candidates = Array.from(
  document.querySelectorAll('fieldset, [role="group"], [role="radiogroup"], [data-automation-id^="formField"]'),
).filter((el) => /disab/i.test(el.textContent ?? '') && el.querySelector('input[type="checkbox"], [role="checkbox"]'))
const scope = candidates.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0] ?? null

console.log('scope:', scope
  ? `<${scope.tagName.toLowerCase()} aid="${scope.getAttribute('data-automation-id') ?? ''}" role="${scope.getAttribute('role') ?? ''}">`
  : '(not found — dumping all checkboxes on page)')

// 2. The question/legend prompt
const legend = scope?.querySelector('legend, [data-automation-id*="label" i]')
console.log('prompt:', JSON.stringify((legend?.textContent ?? '').trim().slice(0, 90)))

// 3. Each checkbox-like element + its option label
const root = scope ?? document
const cbs = Array.from(root.querySelectorAll('input[type="checkbox"], [role="checkbox"]'))
console.log(`checkbox-like elements: ${cbs.length}`)
cbs.forEach((cb, i) => {
  let label = ''
  if (cb.id) label = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.textContent?.trim() ?? ''
  if (!label) label = cb.closest('label')?.textContent?.trim() ?? ''
  if (!label) { const lb = cb.getAttribute('aria-labelledby'); if (lb) label = document.getElementById(lb)?.textContent?.trim() ?? '' }
  if (!label) label = cb.getAttribute('aria-label') ?? ''
  console.log(`[${i}] ` + JSON.stringify({
    tag: cb.tagName.toLowerCase(),
    id: cb.id || '',
    aid: cb.getAttribute('data-automation-id') || '',
    name: cb.getAttribute('name') || '',
    role: cb.getAttribute('role') || '',
    checked: cb.checked ?? cb.getAttribute('aria-checked') ?? '',
    label: label.slice(0, 90),
    wrapperAid: cb.closest('[data-automation-id]')?.getAttribute('data-automation-id') || '',
  }))
})

// 4. Structure of the first option (so we know what to click)
if (cbs[0]) console.log('first option outerHTML:', (cbs[0].closest('[data-automation-id]') ?? cbs[0]).outerHTML.slice(0, 400))
