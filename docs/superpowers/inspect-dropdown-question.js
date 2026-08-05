// Run this with the "Would you consider relocating for this role?" dropdown OPEN
// (click it so its options are visible on screen).

// --- A. Locate the question + its combobox container (the hook) ---
const QUESTION = /relocat/i
const hit = [...document.querySelectorAll('label,[data-automation-id],[id]')]
  .find((el) => QUESTION.test(el.textContent ?? '') && el.children.length < 10)

let ff = hit
while (ff && !/^formField/.test(ff.getAttribute?.('data-automation-id') ?? '')) ff = ff.parentElement

console.log('question text:', JSON.stringify((hit?.textContent ?? '').trim().slice(0, 90)))
console.log('formField container aid:', ff?.getAttribute('data-automation-id') ?? '(not found — show parent chain below)')

if (ff) {
  const btn = ff.querySelector('button, [data-automation-id="selectWidget"], [aria-haspopup]')
  console.log('trigger:', btn ? JSON.stringify({
    aid: btn.getAttribute('data-automation-id') ?? '',
    text: (btn.textContent ?? '').trim().slice(0, 40),
    haspopup: btn.getAttribute('aria-haspopup') ?? '',
  }) : 'none')
  console.log('inner aids:', [...ff.querySelectorAll('[data-automation-id]')]
    .map((e) => e.getAttribute('data-automation-id')).slice(0, 20))
} else if (hit) {
  // No formField ancestor matched — dump the ancestor aid chain so we can see the pattern
  let n = hit, chain = []
  for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
    const aid = n.getAttribute?.('data-automation-id') ?? ''
    if (aid) chain.push(aid)
  }
  console.log('ancestor aids:', chain)
}

// --- B. Currently-open dropdown options (query document-wide; Workday portals them) ---
const opts = [...document.querySelectorAll(
  'li[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"][role="option"]'
)]
console.log(`\nopen options: ${opts.length}`)
opts.slice(0, 25).forEach((o, i) => {
  const label = o.getAttribute('data-automation-label') ?? (o.textContent ?? '').trim()
  console.log(`  [${i}] ${JSON.stringify(label)}  (tag=${o.tagName.toLowerCase()}, aid=${o.getAttribute('data-automation-id') ?? ''})`)
})
