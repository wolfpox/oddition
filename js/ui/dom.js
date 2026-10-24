/* Oddition — small DOM helpers: escaping, toasts, dialogs, popovers, files. */
(function (Odd) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------- toasts ----------------
  function toast(message, opts) {
    const o = opts || {};
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast' + (o.kind ? ' toast-' + o.kind : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="toast-msg">' + esc(message) + '</span>';
    if (o.action) {
      const b = document.createElement('button');
      b.className = 'toast-action';
      b.textContent = o.action.label;
      b.addEventListener('click', () => { o.action.run(); remove(); });
      el.appendChild(b);
    }
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    const timer = setTimeout(remove, o.duration || 3200);
    function remove() {
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    }
    return remove;
  }

  // ---------------- modal dialogs ----------------
  let lastFocus = null;

  /**
   * dialog({ title, body (html), actions: [{ label, value, kind, primary }], onOpen(el), wide })
   * resolves with the chosen action value (or null when dismissed). Actions may
   * return false from `validate(el)` to keep the dialog open.
   */
  function dialog(opts) {
    return new Promise((resolve) => {
      const host = $('#overlay');
      lastFocus = document.activeElement;
      host.innerHTML =
        '<div class="scrim" data-dismiss></div>' +
        '<div class="dialog' + (opts.wide ? ' dialog-wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-title">' +
        '<h2 id="dlg-title" class="dialog-title">' + esc(opts.title) + '</h2>' +
        '<div class="dialog-body">' + (opts.body || '') + '</div>' +
        '<div class="dialog-actions">' +
        (opts.actions || [{ label: 'OK', value: true, primary: true }]).map((a, i) =>
          '<button type="button" class="btn ' + (a.primary ? 'btn-primary' : '') + (a.kind === 'danger' ? ' btn-danger' : '') +
          '" data-i="' + i + '">' + esc(a.label) + '</button>').join('') +
        '</div></div>';
      host.hidden = false;
      const dlg = $('.dialog', host);
      const actions = opts.actions || [{ label: 'OK', value: true, primary: true }];

      function close(value) {
        host.hidden = true;
        host.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* gone */ }
        resolve(value);
      }
      function choose(i) {
        const a = actions[i];
        if (a.validate && a.validate(dlg) === false) return;
        close(typeof a.value === 'function' ? a.value(dlg) : a.value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
          const pi = actions.findIndex((a) => a.primary);
          if (pi >= 0) { e.preventDefault(); e.stopPropagation(); choose(pi); }
        } else if (e.key === 'Tab') {
          const f = $$('button, input, select, textarea, [tabindex="0"]', dlg).filter((x) => !x.disabled);
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
        e.stopPropagation();
      }
      document.addEventListener('keydown', onKey, true);
      host.addEventListener('click', function handler(e) {
        if (e.target.hasAttribute('data-dismiss')) { host.removeEventListener('click', handler); close(null); return; }
        const b = e.target.closest('.dialog-actions button');
        if (b) choose(Number(b.dataset.i));
      });
      if (opts.onOpen) opts.onOpen(dlg);
      const first = $('input, select, textarea', dlg) || $('.btn-primary', dlg) || $('button', dlg);
      if (first) first.focus();
      if (first && first.select && first.type === 'text') first.select();
    });
  }

  function confirmDialog(title, message, okLabel, danger) {
    return dialog({
      title,
      body: '<p>' + esc(message) + '</p>',
      actions: [
        { label: 'Cancel', value: false },
        { label: okLabel || 'OK', value: true, primary: true, kind: danger ? 'danger' : '' },
      ],
    });
  }

  function promptDialog(title, label, value, okLabel) {
    return dialog({
      title,
      body: '<label class="field"><span>' + esc(label) + '</span><input type="text" id="dlg-input" maxlength="80" value="' + esc(value) + '"></label>',
      actions: [
        { label: 'Cancel', value: null },
        { label: okLabel || 'Save', primary: true, value: (el) => $('#dlg-input', el).value.trim() || null },
      ],
    });
  }

  // ---------------- popover menus ----------------
  let openMenu = null;

  /** menu(anchorEl, [{ label, run, kind, disabled, hint } | '-' ], { align }) */
  function menu(anchor, items, opts) {
    closeMenu();
    const o = opts || {};
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = items.map((it, i) => {
      if (it === '-') return '<div class="menu-sep" role="separator"></div>';
      if (it.heading) return '<div class="menu-heading">' + esc(it.heading) + '</div>';
      return '<button type="button" role="menuitem" class="menu-item' + (it.kind === 'danger' ? ' danger' : '') +
        (it.checked ? ' checked' : '') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' +
        '<span>' + esc(it.label) + '</span>' + (it.hint ? '<kbd>' + esc(it.hint) + '</kbd>' : '') + '</button>';
    }).join('');
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let left = o.align === 'right' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    openMenu = { el, anchor };
    anchor.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.menu-item');
      if (!b || b.disabled) return;
      const it = items[Number(b.dataset.i)];
      closeMenu();
      if (it && it.run) it.run();
    });
    const firstItem = el.querySelector('.menu-item:not([disabled])');
    if (firstItem && o.focus !== false) firstItem.focus();
    return el;
  }

  function closeMenu() {
    if (!openMenu) return;
    openMenu.anchor.setAttribute('aria-expanded', 'false');
    openMenu.el.remove();
    openMenu = null;
  }

  if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!openMenu) return;
    if (e.key === 'Escape') { closeMenu(); e.stopPropagation(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = $$('.menu-item:not([disabled])', openMenu.el);
      const i = items.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      if (items[n]) items[n].focus();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  window.addEventListener('resize', closeMenu);
  }

  // ---------------- files ----------------

  /** hand bytes to the browser as a file download */
  function download(filename, data, mime) {
    if (Odd.platform && Odd.platform.download) return Odd.platform.download(filename, data, mime);
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return Promise.resolve(true);
  }

  /** open a file picker; resolves with { name, bytes, text } or null */
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          const bytes = new Uint8Array(reader.result);
          let text = '';
          try { text = new TextDecoder().decode(bytes); } catch (e) { /* binary */ }
          resolve({ name: f.name, bytes, text });
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(f);
      });
      input.click();
    });
  }

  function base64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  Odd.dom = { $, $$, esc, toast, dialog, confirm: confirmDialog, prompt: promptDialog, menu, closeMenu, download, pickFile, base64 };
})(globalThis.Odd = globalThis.Odd || {});
