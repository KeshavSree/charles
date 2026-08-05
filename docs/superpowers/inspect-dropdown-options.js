// Open ONE dropdown (Gender / Ethnicity / Veteran Status) so its options are visible,
// then run this. Re-run after opening each dropdown.

// Identify which question's dropdown is open (its trigger has aria-expanded="true").
const openBtn = document.querySelector('[aria-expanded="true"]')
const ff = openBtn?.closest('[data-automation-id^="formField"]')
const question = ff ? (ff.querySelector('label')?.textContent ?? ff.textContent ?? '').trim().slice(0, 70) : '(open-dropdown container not found)'
console.log('question:', JSON.stringify(question))

// Dump the option labels (these are what your stored value must match).
const opts = Array.from(document.querySelectorAll('li[role="option"], [data-automation-id="promptOption"]'))
console.log(`options: ${opts.length}`)
opts.forEach((o, i) => {
  const label = o.getAttribute('data-automation-label') ?? (o.textContent ?? '').trim()
  console.log(`[${i}] ${JSON.stringify(label)}`)
})
