// Greenhouse School typeahead probe. Run on its own (not during a fill), in the
// Greenhouse frame. Answers: what are the options we collect, does typing filter them,
// and does a "Stanford" option actually appear?
(async () => {
  const log = (...a) => console.log('%c[school-probe]', 'color:#22c55e;font-weight:bold', ...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sample = (els, n = 10) => Array.from(els).slice(0, n).map((e) => (e.textContent || '').trim().slice(0, 50));

  function fireClick(el) {
    const init = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  }
  function typeInto(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(el, text) : (el.value = text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const input = document.querySelector('input[id^="school--"]');
  if (!input) return log('✗ no school input (input[id^="school--"]) on this page/frame');
  const control = input.closest('[class*="select__control"]');
  log('input attrs', {
    id: input.id, role: input.getAttribute('role'),
    ariaControls: input.getAttribute('aria-controls'),
    ariaExpanded: input.getAttribute('aria-expanded'),
    ariaOwns: input.getAttribute('aria-owns'), class: input.className,
  });

  // 1) Open the menu.
  fireClick(control || input);
  input.focus();
  await wait(500);
  log('after open: aria-controls =', input.getAttribute('aria-controls'), '| aria-expanded =', input.getAttribute('aria-expanded'));

  const lbId = input.getAttribute('aria-controls');
  const listbox = lbId ? document.getElementById(lbId) : null;

  const docOpts = document.querySelectorAll('[class*="select__option"]');
  log('ON OPEN — document [class*=select__option] =', docOpts.length, '| sample:', sample(docOpts));
  log('ON OPEN — document [role=option] =', document.querySelectorAll('[role="option"]').length);
  if (listbox) log('ON OPEN — inside #' + lbId + ' [class*=option] =', listbox.querySelectorAll('[class*="option"]').length, '| sample:', sample(listbox.querySelectorAll('[class*="option"]')));
  log('menus present:', Array.from(document.querySelectorAll('[class*="select__menu"]')).map((m) => ({ class: m.className.replace(/css-\S+/g, '').trim(), options: m.querySelectorAll('[class*="option"]').length })));

  // 2) Type "Stanford" and see whether the list narrows.
  typeInto(input, 'Stanford');
  await wait(1200);
  const after = document.querySelectorAll('[class*="select__option"]');
  log('AFTER typing "Stanford" — [class*=select__option] =', after.length, '| sample:', sample(after, 12));
  const stanford = Array.from(after).find((o) => /stanford/i.test(o.textContent || ''));
  log('Stanford option present?', !!stanford, '|', stanford ? JSON.stringify(stanford.textContent.trim()) : '');

  // 3) Structure dumps to see how an option / the menu is built.
  if (after[0]) log('first option outerHTML:', after[0].outerHTML.slice(0, 350));
  const menu = document.querySelector('[class*="select__menu"]');
  if (menu) log('menu outerHTML (truncated):', menu.outerHTML.slice(0, 700));
})();
