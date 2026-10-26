/* Oddition — adapter for hosts that frame the page and expose `window.claude`
 * capabilities (the claude.ai artifact viewer). Only the hosted build includes
 * this file; the plain app never loads it.
 *
 * - downloads: files go through the viewer's save prompt. Types the viewer does
 *   not accept (.mid, .wav) are delivered inside a .zip.
 * - db + user: the workspace syncs to the viewer's private store, one document
 *   per shelf part, per idea and per session, so work survives across devices.
 */
(function (Odd) {
  'use strict';
  const P = (Odd.platform = Odd.platform || {});
  const hasHost = () => typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function';
  const use = (name) => (hasHost() ? window.claude.use(name).catch(() => null) : Promise.resolve(null));

  // ---------------- downloads ----------------
  const ACCEPTED = /\.(zip|json|txt|md|csv|html|pdf|png|svg)$/i;
  let downloads = null;

  P.download = async function (filename, data, mime) {
    if (!downloads) downloads = use('downloads');
    const dl = await downloads;
    if (!dl) {
      Odd.dom.toast('Saving files is not available in this view. The full app on your computer can export everything.', { kind: 'warn', duration: 6000 });
      return false;
    }
    let name = filename;
    let bytes = data;
    if (bytes instanceof Blob) bytes = new Uint8Array(await bytes.arrayBuffer());
    if (!ACCEPTED.test(name)) {
      bytes = Odd.zip.create([{ name, data: bytes }]);
      name = name.replace(/\.[^.]+$/, '') + '.zip';
    }
    try {
      await dl.save({ filename: name, data: bytes });
      return true;
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return false;
      if (code === 'rate_limited') Odd.dom.toast('A save is already waiting for you. Finish that one first.');
      else Odd.dom.toast('Could not save ' + name + (e && e.message ? ': ' + e.message : ''), { kind: 'warn' });
      return false;
    }
  };

  // ---------------- workspace sync ----------------
  const MAX_DOC = 250 * 1024;
  let col = null;
  let ready = false;
  const written = new Map(); // doc id -> JSON last written or loaded
  let timer = null;
  let pending = null;
  let flushing = false;
  let warnedSize = false;
  let failed = false;

  function partDoc(p) { return { kind: 'part', created: p.created || 0, body: p }; }

  function sameMusic(a, b) {
    return a && b && a.role === b.role && a.bars === b.bars && a.base === b.base &&
      JSON.stringify(a.notes) === JSON.stringify(b.notes) && JSON.stringify(a.ctx) === JSON.stringify(b.ctx);
  }

  // slots hold copies of shelf parts; store a reference when the copy still matches
  function packSession(s, libById) {
    const copy = JSON.parse(JSON.stringify(s));
    for (const sec of copy.sections) {
      for (const k of Object.keys(sec.slots)) {
        const slot = sec.slots[k];
        const lib = slot.sourceId && libById.get(slot.sourceId);
        if (lib && sameMusic(lib, slot.part)) {
          sec.slots[k] = { ref: slot.sourceId, name: slot.part.name, sourceId: slot.sourceId, oct: slot.oct || 0, refit: slot.refit !== false };
        }
      }
    }
    return copy;
  }

  function unpackSession(s, libById) {
    for (const sec of s.sections || []) {
      for (const k of Object.keys(sec.slots || {})) {
        const slot = sec.slots[k];
        if (slot && slot.ref) {
          const lib = libById.get(slot.ref);
          if (!lib) { delete sec.slots[k]; continue; }
          const part = JSON.parse(JSON.stringify(lib));
          part.name = slot.name || part.name;
          sec.slots[k] = { part, sourceId: slot.ref, oct: slot.oct || 0, refit: slot.refit !== false };
        }
      }
    }
    return s;
  }

  function buildDocs(ws) {
    const libById = new Map(ws.library.map((p) => [p.id, p]));
    const docs = new Map();
    for (const p of ws.library) docs.set(p.id, partDoc(p));
    for (const idea of ws.ideas || []) docs.set(idea.id, { kind: 'idea', created: idea.created || 0, body: idea });
    for (const s of ws.sessions) docs.set(s.id, { kind: 'session', created: s.created || 0, body: packSession(s, libById) });
    docs.set('meta', {
      kind: 'meta',
      created: 0,
      savedAt: ws.savedAt || Date.now(),
      currentId: ws.currentId,
      prefs: ws.prefs || {},
      sessions: ws.sessions.map((s) => s.id),
      version: ws.version || 1,
    });
    return docs;
  }

  // every doc carries `created`, so one ordered, paged pass reads them all
  async function readAll() {
    const seen = new Map();
    let last = null;
    for (let page = 0; page < 100; page++) {
      const q = last == null
        ? col.orderBy('created').limit(500)
        : col.where('created', '>=', last).orderBy('created').limit(500);
      const snap = await q.get();
      let fresh = 0;
      for (const d of snap.docs) {
        if (!seen.has(d.id)) { seen.set(d.id, d.data()); fresh++; }
      }
      if (snap.size < 500 || !fresh) break;
      last = snap.docs[snap.docs.length - 1].data().created;
    }
    return seen;
  }

  function assemble(docs) {
    const meta = docs.get('meta');
    if (!meta) return null;
    const library = [];
    const ideas = [];
    const sessions = new Map();
    for (const [id, d] of docs) {
      if (!d || !d.body) continue;
      if (d.kind === 'part') library.push(JSON.parse(JSON.stringify(d.body)));
      else if (d.kind === 'idea') ideas.push(JSON.parse(JSON.stringify(d.body)));
      else if (d.kind === 'session') sessions.set(id, JSON.parse(JSON.stringify(d.body)));
    }
    library.sort((a, b) => (b.created || 0) - (a.created || 0));
    ideas.sort((a, b) => (b.created || 0) - (a.created || 0));
    const libById = new Map(library.map((p) => [p.id, p]));
    const ordered = (meta.sessions || []).map((id) => sessions.get(id)).filter(Boolean);
    for (const [id, s] of sessions) if (!(meta.sessions || []).includes(id)) ordered.push(s);
    const ws = Odd.model.migrate({
      version: meta.version || 1,
      library,
      ideas,
      sessions: ordered.map((s) => unpackSession(s, libById)),
      currentId: meta.currentId,
      prefs: meta.prefs || {},
    });
    if (ws) ws.savedAt = meta.savedAt || 0;
    return ws;
  }

  async function flush() {
    if (flushing || !pending || !col) return;
    flushing = true;
    const ws = pending;
    pending = null;
    try {
      const docs = buildDocs(ws);
      for (const [id, body] of docs) {
        const json = JSON.stringify(body);
        if (written.get(id) === json) continue;
        if (json.length > MAX_DOC) {
          if (!warnedSize) {
            warnedSize = true;
            Odd.dom.toast('One session is too large to sync to your account. It is still saved in this browser; use Save project file to keep a copy.', { kind: 'warn', duration: 8000 });
          }
          continue;
        }
        await col.doc(id).set(body);
        written.set(id, json);
      }
      for (const id of Array.from(written.keys())) {
        if (!docs.has(id)) {
          await col.doc(id).delete();
          written.delete(id);
        }
      }
    } catch (e) {
      const code = e && e.code;
      if (code === 'revoked' || code === 'not_granted' || code === 'invalid_argument') {
        col = null; // view-only or signed out: keep working locally
      } else if (!failed) {
        failed = true;
        Odd.dom.toast('Could not sync to your account just now. Your work is still saved in this browser.', { kind: 'warn' });
      }
      if (col) pending = pending || ws;
    } finally {
      flushing = false;
      if (pending && col) schedule(4000);
    }
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  P.sync = {
    /**
     * Connect and read what the viewer has stored. Resolves with a workspace
     * to switch to (when the stored one should win) or null.
     * `local` is the workspace the app is showing right now.
     */
    async start(getLocal) {
      const [db, user] = await Promise.all([use('db'), use('user')]);
      if (!db || !user) return null;
      let uid = null;
      try { uid = await user.id(); } catch (e) { uid = null; }
      if (!uid) return null;
      try {
        col = db.collection('data/users/' + uid);
        const docs = await readAll();
        for (const [id, d] of docs) written.set(id, JSON.stringify(d));
        const remote = assemble(docs);
        const local = getLocal();
        ready = true;
        if (remote && (local.fresh || (remote.savedAt || 0) > (local.savedAt || 0))) return remote;
        P.sync.save(local); // first visit with this account, or local is newer
        return null;
      } catch (e) {
        col = null;
        return null;
      }
    },
    save(ws) {
      if (!ready || !col) return;
      pending = ws;
      schedule(1500);
    },
    flush() { if (pending) flush(); },
    get connected() { return !!col && ready; },
  };
})(globalThis.Odd = globalThis.Odd || {});
