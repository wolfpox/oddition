/* Oddition — saving to browser storage, plus undo / redo snapshots. */
(function (Odd) {
  'use strict';

  const KEY = 'oddition.workspace.v1';
  let timer = null;
  let pending = null;
  let lastError = null;

  function storage() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function load() {
    const ls = storage();
    if (!ls) return null;
    try {
      const raw = ls.getItem(KEY);
      if (!raw) return null;
      return Odd.model.migrate(JSON.parse(raw));
    } catch (e) {
      lastError = e;
      return null;
    }
  }

  /** returns { ok, bytes, error } */
  function save(ws) {
    const ls = storage();
    if (!ls) return { ok: false, error: new Error('Browser storage is not available.') };
    try {
      const text = JSON.stringify(ws);
      ls.setItem(KEY, text);
      lastError = null;
      return { ok: true, bytes: text.length };
    } catch (e) {
      lastError = e;
      return { ok: false, error: e };
    }
  }

  function schedule(ws, delay, onDone) {
    pending = ws;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const res = save(pending);
      pending = null;
      if (onDone) onDone(res);
    }, delay == null ? 500 : delay);
  }

  function flush() {
    if (!pending) return null;
    clearTimeout(timer);
    const res = save(pending);
    pending = null;
    return res;
  }

  function clear() {
    const ls = storage();
    if (ls) try { ls.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  // ---------------- undo ----------------
  const LIMIT = 50;
  const past = [];
  const future = [];

  const history = {
    /** call before changing the workspace */
    record(ws, label) {
      past.push({ label: label || '', json: JSON.stringify(ws) });
      if (past.length > LIMIT) past.shift();
      future.length = 0;
    },
    undo(ws) {
      const prev = past.pop();
      if (!prev) return null;
      future.push({ label: prev.label, json: JSON.stringify(ws) });
      return { ws: JSON.parse(prev.json), label: prev.label };
    },
    redo(ws) {
      const next = future.pop();
      if (!next) return null;
      past.push({ label: next.label, json: JSON.stringify(ws) });
      return { ws: JSON.parse(next.json), label: next.label };
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get undoLabel() { return past.length ? past[past.length - 1].label : ''; },
    get redoLabel() { return future.length ? future[future.length - 1].label : ''; },
    clear() { past.length = 0; future.length = 0; },
  };

  Odd.store = { KEY, load, save, schedule, flush, clear, get lastError() { return lastError; } };
  Odd.history = history;
})(globalThis.Odd = globalThis.Odd || {});
