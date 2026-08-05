// Run in the Workday tab console with the Websites section OPEN
// (click its "Add" once so a URL field + "Add Another" button are visible).

// 1. Locate the Websites section container via its heading
let section = null
for (const h of document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')) {
  if (/websites/i.test(h.textContent ?? '')) {
    // walk up a few levels to a container that holds the inputs/buttons
    let n = h
    for (let i = 0; i < 6 && n; i++) n = n.parentElement
    section = n ?? h.parentElement
    console.log('heading found:', JSON.stringify((h.textContent ?? '').trim()))
    break
  }
}
const scope = section ?? document
console.log('scope tag:', scope.tagName, 'aid:', scope.getAttribute?.('data-automation-id') ?? '')

// 2. Buttons within the section (Add / Add Another / Remove)
console.log('\n--- buttons in section ---')
scope.querySelectorAll('button, [role="button"]').forEach((b) => {
  console.log(JSON.stringify({
    aid: b.getAttribute('data-automation-id') ?? '',
    text: (b.textContent ?? '').trim().slice(0, 40),
    ariaLabel: b.getAttribute('aria-label') ?? '',
    id: b.id || '',
  }))
})

// 3. Inputs within the section (the URL field) — id pattern is the key
console.log('\n--- inputs/textareas in section ---')
scope.querySelectorAll('input, textarea').forEach((el) => {
  console.log(JSON.stringify({
    id: el.id || '',
    aid: el.getAttribute('data-automation-id') ?? '',
    type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
    ariaLabel: el.getAttribute('aria-label') ?? '',
    placeholder: el.getAttribute('placeholder') ?? '',
    prefix: el.id ? el.id.split('--')[0] : '',
    suffix: el.id && el.id.includes('--') ? el.id.split('--').slice(1).join('--') : '',
  }))
})

// 4. Global sanity: every add-style button on the page (compare Add vs Add Another aids)
console.log('\n--- global add/add-another buttons ---')
document.querySelectorAll('button, [role="button"]').forEach((b) => {
  const aid = b.getAttribute('data-automation-id') ?? ''
  const text = (b.textContent ?? '').trim()
  if (/add/i.test(aid) || /^add(\s+another)?$/i.test(text)) {
    console.log(JSON.stringify({ aid, text: text.slice(0, 40) }))
  }
})
