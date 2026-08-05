(function () {
  const seen = new Set();
  const fields = [];

  function getLabel(el) {
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
    const lby = el.getAttribute('aria-labelledby');
    if (lby) {
      const t = lby.split(' ').map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    const wl = el.closest('label');
    if (wl?.textContent?.trim()) return wl.textContent.trim().slice(0, 80);
    if (el.placeholder?.trim()) return `placeholder: "${el.placeholder.trim()}"`;
    if (el.name?.trim()) return `name: "${el.name.trim()}"`;
    const legend = el.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
    if (legend) return `legend: "${legend}"`;
    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const text = Array.from(node.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        .map(n => n.textContent.trim()).join(' ');
      if (text) return `nearby: "${text.slice(0, 60)}"`;
      const heading = node.querySelector('label, legend, h1, h2, h3, h4, [class*="label" i], [class*="title" i]');
      if (heading && heading !== el && heading.textContent?.trim()) return `nearby: "${heading.textContent.trim().slice(0, 60)}"`;
    }
    return '(no label found)';
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function shortSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const aid = node.getAttribute('data-automation-id') || node.getAttribute('data-testid') || node.getAttribute('data-field');
      if (aid) {
        const attr = node.hasAttribute('data-automation-id') ? 'data-automation-id' : node.hasAttribute('data-testid') ? 'data-testid' : 'data-field';
        parts.unshift(`[${attr}="${aid}"]`); break;
      }
      const cls = Array.from(node.classList).slice(0, 2).join('.');
      if (cls) part += `.${cls}`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function add(el, kind, extra = {}) {
    if (seen.has(el) || !isVisible(el)) return;
    seen.add(el);
    fields.push({ kind, label: getLabel(el), selector: shortSelector(el), ...extra });
  }

  document.querySelectorAll('input').forEach(el => {
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)) return;
    add(el, `input[${el.type || 'text'}]`, {
      name: el.name || undefined,
      required: el.required || undefined,
      value: (el.type === 'checkbox' || el.type === 'radio') ? el.checked : (el.value?.slice(0, 40) || undefined),
    });
  });
  document.querySelectorAll('select').forEach(el => {
    add(el, 'select', { name: el.name || undefined, options: el.options.length, value: el.value || undefined });
  });
  document.querySelectorAll('textarea').forEach(el => {
    add(el, 'textarea', { name: el.name || undefined, value: el.value?.slice(0, 40) || undefined });
  });
  document.querySelectorAll('[contenteditable="true"]').forEach(el => {
    if (['input', 'select', 'textarea'].includes(el.tagName.toLowerCase())) return;
    add(el, 'contenteditable', { text: el.textContent?.slice(0, 40) || undefined });
  });
  ['textbox', 'combobox', 'listbox', 'radiogroup', 'radio', 'checkbox',
   'switch', 'spinbutton', 'searchbox', 'slider', 'option', 'menuitemcheckbox', 'menuitemradio']
    .forEach(role => {
      document.querySelectorAll(`[role="${role}"]`).forEach(el => {
        add(el, `aria[${role}]`, {
          expanded: el.getAttribute('aria-expanded') || undefined,
          checked: el.getAttribute('aria-checked') || undefined,
          selected: el.getAttribute('aria-selected') || undefined,
        });
      });
    });
  document.querySelectorAll([
    '[class*="dropzone" i]', '[class*="drop-zone" i]', '[class*="file-upload" i]',
    '[data-automation-id*="upload" i]', '[data-testid*="upload" i]',
    '[class*="uploader" i]'
  ].join(',')).forEach(el => add(el, 'upload-zone'));
  document.querySelectorAll('form [tabindex]:not([tabindex="-1"])').forEach(el => {
    if (['input','select','textarea'].includes(el.tagName.toLowerCase())) return;
    add(el, `focusable[${el.tagName.toLowerCase()}]`, { tabindex: el.getAttribute('tabindex') });
  });

  // Detect iframes — cross-origin ones can't be scanned, surface their src instead.
  const iframes = Array.from(document.querySelectorAll('iframe')).filter(f => isVisible(f));

  const byKind = {};
  fields.forEach(f => (byKind[f.kind] = byKind[f.kind] || []).push(f));

  console.group(`%cField scan — ${fields.length} field(s) found${iframes.length ? ` + ${iframes.length} iframe(s)` : ''}`, 'font-weight:bold;font-size:13px;color:#f59e0b');
  Object.entries(byKind).forEach(([kind, items]) => {
    console.group(`%c${kind}  (${items.length})`, 'color:#60a5fa;font-weight:bold');
    items.forEach(f => {
      const extras = Object.entries(f)
        .filter(([k, v]) => !['kind','label','selector'].includes(k) && v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ');
      console.log(`  %c${f.label}\n  %c${f.selector}${extras ? '\n  ' + extras : ''}`, 'color:#e2e8f0', 'color:#6b7280;font-size:11px');
    });
    console.groupEnd();
  });
  if (iframes.length) {
    console.group(`%ciframes  (${iframes.length}) — open src directly to scan`, 'color:#f59e0b;font-weight:bold');
    iframes.forEach(f => {
      const src = f.src || f.getAttribute('src') || '(no src)';
      const sameOrigin = src.startsWith(location.origin) || src.startsWith('/');
      console.log(`  %c${f.id || f.title || '(unnamed)'}  %c${sameOrigin ? '[same-origin]' : '[cross-origin — open in new tab]'}\n  %c${src}`, 'color:#e2e8f0', sameOrigin ? 'color:#34d399' : 'color:#f87171', 'color:#6b7280;font-size:11px');
    });
    console.groupEnd();
  }

  console.groupEnd();

  return fields;
})();
