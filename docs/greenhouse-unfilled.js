// Greenhouse fill-state scan. Run AFTER clicking Charles "Fill", in the Greenhouse frame.
// Groups every fillable field into FILLED vs UNFILLED and prints the FULL question label
// (untruncated) so the ones that didn't fill stand out with exact wording to match on.
(function () {
  function fullLabel(el) {
    const lby = el.getAttribute('aria-labelledby');
    if (lby) {
      const t = lby.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    let node = el.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const lab = node.querySelector('label, legend, [class*="label" i]');
      if (lab && lab !== el && lab.textContent?.trim()) return lab.textContent.trim();
    }
    return el.getAttribute('name') || '(no label)';
  }
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }
  const required = (el) =>
    el.required || el.getAttribute('aria-required') === 'true' ||
    /[*]/.test(fullLabel(el).slice(-3));

  const rows = []; // { kind, label, value, filled, required, selector }
  const seen = new Set();
  const push = (el, kind, value, filled) => {
    rows.push({ kind, label: fullLabel(el), value, filled, required: required(el),
      selector: el.id ? '#' + el.id : (el.getAttribute('name') || kind) });
  };

  // react-select widgets — value lives in .select__single-value; empty/"Select…" = unfilled.
  document.querySelectorAll('input[role="combobox"]').forEach((input) => {
    if (!isVisible(input) || seen.has(input)) return;
    seen.add(input);
    const control = input.closest('[class*="select__control"]');
    const sv = control?.querySelector('[class*="single-value"], [class*="multi-value"]');
    const txt = (sv?.textContent || '').trim();
    const filled = !!txt && !/^select/i.test(txt);
    push(input, 'react-select', filled ? txt : (txt || '(empty)'), filled);
  });

  // Native inputs / textareas / selects.
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!isVisible(el) || seen.has(el)) return;
    if (el.closest('[class*="select__control"]') || el.getAttribute('role') === 'combobox') return;
    if (el instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)) return;
    seen.add(el);
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      // Group radio/checkbox by name; report once.
      const name = el.name || el.id;
      if (rows.some((r) => r.selector === '[' + name + ']')) return;
      const group = Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`));
      const checked = group.filter((g) => g.checked).map((g) => fullLabel(g));
      rows.push({ kind: `${el.type}-group`, label: fullLabel(el.closest('fieldset') || el),
        value: checked.join(', ') || '(none)', filled: checked.length > 0,
        required: false, selector: '[' + name + ']' });
      return;
    }
    if (el instanceof HTMLInputElement && el.type === 'file') {
      push(el, 'file', el.files?.length ? el.files[0].name : '(empty)', !!el.files?.length);
      return;
    }
    const v = (el.value || '').trim();
    const kind = el.tagName.toLowerCase() === 'select' ? 'native-select'
      : el.tagName.toLowerCase() === 'textarea' ? 'textarea' : `input[${el.type || 'text'}]`;
    push(el, kind, v || '(empty)', !!v);
  });

  const filled = rows.filter((r) => r.filled);
  const unfilled = rows.filter((r) => !r.filled);

  console.group(`%cGreenhouse fill-state — ${filled.length} filled, ${unfilled.length} UNFILLED @ ${location.hostname}`,
    'font-weight:bold;font-size:13px;color:#22c55e');

  console.group(`%c❌ UNFILLED (${unfilled.length}) — what still needs handling`, 'color:#f87171;font-weight:bold');
  unfilled.forEach((r) => {
    console.log(`%c${r.required ? '★ ' : ''}${r.label}`, 'color:#fca5a5;font-weight:bold');
    console.log(`   %c[${r.kind}]  ${r.selector}  current=${JSON.stringify(r.value)}`, 'color:#6b7280;font-size:11px');
  });
  console.groupEnd();

  console.group(`%c✅ FILLED (${filled.length})`, 'color:#34d399;font-weight:bold');
  filled.forEach((r) => console.log(`%c${r.label}  %c= ${JSON.stringify(r.value)}  [${r.kind}]`, 'color:#a7f3d0', 'color:#6b7280;font-size:11px'));
  console.groupEnd();

  console.groupEnd();
  window.__ghFill = { filled, unfilled };
  console.log('%cStored as window.__ghFill — copy(window.__ghFill.unfilled) to grab the unfilled JSON.', 'color:#6b7280');
  return { filled: filled.length, unfilled: unfilled.length };
})();
