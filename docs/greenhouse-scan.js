// Greenhouse application-form DOM probe.
//
// Run in the console ON THE GREENHOUSE FORM ITSELF. If a company page embeds the form
// in a cross-origin <iframe>, this won't reach into it from the parent — open the
// iframe's src in its own tab (this script prints the src if it finds an embed) and run
// it there. The one question it's built to answer: for each field, is it a NATIVE
// control (input/select/textarea — already handled) or a CUSTOM widget (react-select /
// aria combobox — needs a gh-* strategy)? And for custom dropdowns, is there a hidden
// native <select> backing it (which would make the strategy trivial)?
(function () {
  const DEMO_RE = /gender|race|ethnic|hispanic|latino|veteran|disab|sexual|orientation|transgender|pronoun/i;

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function getLabel(el) {
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
    const lby = el.getAttribute('aria-labelledby');
    if (lby) {
      const t = lby.split(' ').map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim().slice(0, 80);
    }
    const wrap = el.closest('label');
    if (wrap?.textContent?.trim()) return wrap.textContent.trim().slice(0, 80);
    // Greenhouse wraps each question; climb to find the nearest label/legend/heading.
    let node = el.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const lab = node.querySelector('label, legend, [class*="label" i]');
      if (lab && lab !== el && lab.textContent?.trim()) return lab.textContent.trim().slice(0, 80);
    }
    if (el.name?.trim()) return `name: "${el.name.trim()}"`;
    return '(no label found)';
  }

  function shortSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      let part = node.tagName.toLowerCase();
      const cls = Array.from(node.classList).filter((c) => !/^css-/.test(c)).slice(0, 2).join('.');
      if (cls) part += `.${cls}`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function attrs(el) {
    const pick = ['id', 'name', 'type', 'role', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-labelledby', 'required', 'aria-required', 'placeholder'];
    const out = {};
    for (const a of pick) { const v = el.getAttribute(a); if (v !== null && v !== '') out[a] = v; }
    const cls = Array.from(el.classList).filter((c) => !/^css-/.test(c));
    if (cls.length) out.class = cls.join(' ');
    return out;
  }

  // A "custom dropdown" trigger: react-select control, an aria combobox, or a button
  // that opens a listbox. We dedupe by the nearest field container so we report one
  // entry per question, not per inner node.
  function findCustomDropdowns() {
    const triggers = new Set();
    document.querySelectorAll('[class*="select__control"], [class*="-control"]').forEach((el) => {
      // react-select control: has a value-container / placeholder / single-value child.
      if (el.querySelector('[class*="value-container"], [class*="placeholder"], [class*="single-value"], [class*="singleValue"]')) triggers.add(el);
    });
    document.querySelectorAll('[role="combobox"]').forEach((el) => triggers.add(el));
    document.querySelectorAll('[aria-haspopup="listbox"]').forEach((el) => triggers.add(el));
    return Array.from(triggers).filter(isVisible);
  }

  function describeCustom(trigger) {
    const container =
      trigger.closest('[class*="select__"], [class*="field"], [class*="question"]')?.parentElement ??
      trigger.parentElement ?? trigger;
    // The hidden input react-select uses to hold the typed/selected text.
    const innerInput = trigger.querySelector('input') ?? container.querySelector('input[role="combobox"], input[type="text"]');
    // A hidden native <select> backing the widget would mean we can just set .value.
    const backingSelect = container.querySelector('select');
    const valueText = (
      trigger.querySelector('[class*="single-value"], [class*="singleValue"]')?.textContent ??
      trigger.querySelector('[class*="placeholder"]')?.textContent ??
      trigger.textContent ?? ''
    ).trim().slice(0, 40);
    return {
      controlType: trigger.getAttribute('role') === 'combobox' ? 'aria-combobox'
        : /select__control|-control/.test(trigger.className) ? 'react-select'
        : 'button-listbox',
      label: getLabel(trigger),
      selector: shortSelector(trigger),
      trigger: attrs(trigger),
      innerInput: innerInput ? attrs(innerInput) : null,
      backingSelect: backingSelect ? attrs(backingSelect) : null,
      currentValue: valueText || undefined,
      demographic: DEMO_RE.test(getLabel(trigger)) || undefined,
    };
  }

  const fields = { native: [], custom: [], file: [] };
  const seen = new Set();

  // Native controls.
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!isVisible(el) || seen.has(el)) return;
    if (el instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)) return;
    if (el instanceof HTMLInputElement && el.type === 'file') {
      seen.add(el);
      fields.file.push({ label: getLabel(el), selector: shortSelector(el), ...attrs(el) });
      return;
    }
    // Skip the inner input of a custom dropdown — it's reported under custom instead.
    if (el.closest('[class*="select__control"], [role="combobox"]')) return;
    seen.add(el);
    const kind = el.tagName.toLowerCase() === 'select' ? 'native-select'
      : el.tagName.toLowerCase() === 'textarea' ? 'native-textarea'
      : `native-input[${el.type || 'text'}]`;
    fields.native.push({
      controlType: kind,
      label: getLabel(el),
      selector: shortSelector(el),
      ...attrs(el),
      options: el.tagName.toLowerCase() === 'select' ? el.options.length : undefined,
      demographic: DEMO_RE.test(getLabel(el)) || undefined,
    });
  });

  // Custom dropdowns.
  findCustomDropdowns().forEach((t) => fields.custom.push(describeCustom(t)));

  // Embed iframes (so you know where to run this if you're on the wrapper page).
  const greenhouseIframes = Array.from(document.querySelectorAll('iframe'))
    .filter(isVisible)
    .map((f) => f.src || f.getAttribute('src') || '')
    .filter((src) => /greenhouse/i.test(src));

  // --- Output ---
  const onGreenhouse = /greenhouse\.io/i.test(location.hostname);
  console.group(`%cGreenhouse scan @ ${location.hostname}`, 'font-weight:bold;font-size:13px;color:#22c55e');
  if (!onGreenhouse) {
    console.log('%c⚠ Not on a *.greenhouse.io host — this may be the wrapper page.', 'color:#f59e0b;font-weight:bold');
    if (greenhouseIframes.length) {
      console.log('%cFound Greenhouse embed iframe(s) — open the src in a new tab and re-run there:', 'color:#f59e0b');
      greenhouseIframes.forEach((src) => console.log(`  %c${src}`, 'color:#60a5fa'));
    } else {
      console.log('%cNo Greenhouse iframe found either — is the form loaded?', 'color:#f87171');
    }
  }

  console.group(`%cNATIVE controls (${fields.native.length}) — already handled by classifyRole`, 'color:#60a5fa;font-weight:bold');
  fields.native.forEach((f) => console.log(`${f.demographic ? '⚧ ' : ''}${f.label}\n   %c${f.controlType}  ${JSON.stringify({ ...f, label: undefined, controlType: undefined, demographic: undefined })}`, 'color:#6b7280;font-size:11px'));
  console.groupEnd();

  console.group(`%cCUSTOM dropdowns (${fields.custom.length}) — THESE need a gh-* strategy`, 'color:#f59e0b;font-weight:bold');
  fields.custom.forEach((f) => {
    console.log(`%c${f.demographic ? '⚧ ' : ''}${f.label}  %c[${f.controlType}]${f.backingSelect ? '  ✅ HAS BACKING <select>' : ''}`, 'color:#e2e8f0;font-weight:bold', 'color:#f59e0b');
    console.log('   %c' + JSON.stringify({ selector: f.selector, trigger: f.trigger, innerInput: f.innerInput, backingSelect: f.backingSelect, currentValue: f.currentValue }, null, 0), 'color:#6b7280;font-size:11px');
  });
  console.groupEnd();

  console.group(`%cFILE inputs (${fields.file.length})`, 'color:#a78bfa;font-weight:bold');
  fields.file.forEach((f) => console.log(`${f.label}  %c${f.selector}  ${JSON.stringify({ ...f, label: undefined, selector: undefined })}`, 'color:#6b7280;font-size:11px'));
  console.groupEnd();

  console.log(
    `%cSummary: ${fields.native.length} native, ${fields.custom.length} custom dropdowns` +
    `${fields.custom.some((f) => f.backingSelect) ? ' (some have a backing <select> → easy)' : ''}` +
    `${fields.custom.some((f) => f.demographic) ? ', incl. demographic/EEO' : ''}.`,
    'color:#22c55e;font-weight:bold',
  );
  console.groupEnd();

  window.__ghScan = fields;
  console.log('%cStored as window.__ghScan — copy(window.__ghScan) to grab the JSON.', 'color:#6b7280');
  return fields;
})();
