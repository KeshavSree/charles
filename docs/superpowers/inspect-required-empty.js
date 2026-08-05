// Run on a Workday form AFTER clicking Fill (so some fields are filled, some empty).
// Validates the review-pass heuristics: how "required" is marked, and how "empty vs
// answered" reads per widget. Paste the output back.

const ffs = Array.from(document.querySelectorAll('[data-automation-id^="formField"]'))
console.log(`formField containers: ${ffs.length}`)

ffs.slice(0, 50).forEach((ff, i) => {
  const aid = ff.getAttribute('data-automation-id')
  const labelEl = ff.querySelector('label')
  const labelText = (labelEl?.textContent ?? '').trim()
  const label = (labelText || (ff.textContent ?? '').trim()).slice(0, 55)

  // Required signals
  const ariaRequired = !!ff.querySelector('[aria-required="true"]')
  const starInLabel = labelText.includes('*')
  const requiredAttr = !!ff.querySelector('[data-automation-id*="required" i], abbr[title*="required" i]')

  // Answered/empty signals
  const inputs = Array.from(ff.querySelectorAll('input, textarea, select')).map((el) => ({
    type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
    val: (el.value ?? '').slice(0, 18),
    checked: el.checked,
  }))
  const btn = ff.querySelector('[data-automation-id="selectWidget"], button[aria-haspopup], button')
  const btnText = btn ? (btn.textContent ?? '').trim().slice(0, 28) : null
  const haspopup = btn?.getAttribute('aria-haspopup') ?? null
  const hasSelectedItem = !!ff.querySelector('[data-automation-id="selectedItem"]')

  console.log(`[${i}] ` + JSON.stringify({
    aid, label,
    required: { ariaRequired, starInLabel, requiredAttr },
    inputs, btnText, haspopup, hasSelectedItem,
  }))
})
