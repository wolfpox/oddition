/* Oddition — optional Web MIDI output.
 * Lets the transport drive an external synth or a DAW (through a virtual
 * MIDI port) instead of, or alongside, the built-in synth. Everything fails
 * soft: without Web MIDI support or permission, every call is a no-op. */
(function (Odd) {
  'use strict';

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const supported = !!(nav && typeof nav.requestMIDIAccess === 'function');
  const MODES = ['internal', 'midi', 'both'];

  let access = null;
  let pending = null;
  let list = [];
  let selectedId = null;
  let mode = 'internal';

  function refresh() {
    list = [];
    if (access && access.outputs) {
      access.outputs.forEach((port) => {
        list.push({ id: port.id, name: port.name || port.id, manufacturer: port.manufacturer || '', state: port.state });
      });
    }
    return list.slice();
  }

  function init() {
    if (!supported) return Promise.resolve([]);
    if (access) return Promise.resolve(refresh());
    if (pending) return pending;
    try {
      pending = nav.requestMIDIAccess({ sysex: false }).then((a) => {
        access = a;
        a.onstatechange = () => {
          refresh();
          if (typeof api.onchange === 'function') {
            try { api.onchange(list.slice()); } catch (e) { console.error(e); }
          }
        };
        return refresh();
      }, () => {
        pending = null;
        return [];
      });
    } catch (e) {
      pending = null;
      return Promise.resolve([]);
    }
    return pending;
  }

  function port() {
    if (!access || !selectedId || !access.outputs) return null;
    const p = access.outputs.get(selectedId);
    return p && p.state !== 'disconnected' ? p : null;
  }

  function send(bytes, timeMs) {
    const p = port();
    if (!p) return false;
    try {
      if (timeMs == null) p.send(bytes);
      else p.send(bytes, timeMs);
      return true;
    } catch (e) {
      return false;
    }
  }

  function setMode(m) {
    if (MODES.indexOf(m) >= 0) mode = m;
    return mode;
  }

  const api = {
    supported,
    MODES,
    init,
    outputs() { return list.slice(); },
    select(id) {
      selectedId = id || null;
      return !id || !!port();
    },
    get selectedId() { return selectedId; },
    get mode() { return mode; },
    set mode(m) { setMode(m); },
    setMode,
    /** true when an output is selected and connected */
    ready() { return !!port(); },
    noteOn(ch, pitch, vel, timeMs) {
      send([0x90 | (ch & 15), pitch & 127, Math.max(1, Math.min(127, Math.round(vel) || 1))], timeMs);
    },
    noteOff(ch, pitch, timeMs) {
      send([0x80 | (ch & 15), pitch & 127, 0], timeMs);
    },
    programChange(ch, program, timeMs) {
      send([0xc0 | (ch & 15), program & 127], timeMs);
    },
    cc(ch, num, value, timeMs) {
      send([0xb0 | (ch & 15), num & 127, value & 127], timeMs);
    },
    /** drop queued (future-timestamped) messages where the browser supports it */
    clear() {
      const p = port();
      if (p && typeof p.clear === 'function') {
        try { p.clear(); } catch (e) { /* unsupported */ }
      }
    },
    panic() {
      for (let ch = 0; ch < 16; ch++) {
        send([0xb0 | ch, 64, 0]);
        send([0xb0 | ch, 123, 0]);
        send([0xb0 | ch, 120, 0]);
      }
    },
    onchange: null,
  };

  Odd.webmidi = api;
})(globalThis.Odd = globalThis.Odd || {});
