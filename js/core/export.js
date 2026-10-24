/* Oddition — export builders: parts, sections, songs, stem bundles, projects. */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const R = Odd.render;

  function safeName(s) {
    return String(s || 'untitled').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled';
  }

  function gmFor(patch) {
    const p = Odd.synth && Odd.synth.PATCHES && Odd.synth.PATCHES[patch];
    return p ? p.gm : 0;
  }

  function keyLabel(session) {
    const sc = T.SCALES[session.scale];
    return T.NOTE_NAMES[session.tonic] + ' ' + (sc ? sc.label.toLowerCase() : session.scale);
  }

  function lanesToTracks(session, events) {
    const byLane = new Map();
    for (const e of events) {
      if (!byLane.has(e.track)) byLane.set(e.track, []);
      byLane.get(e.track).push(e);
    }
    const tracks = [];
    for (const lane of session.lanes) {
      const notes = byLane.get(lane.id);
      if (!notes || !notes.length) continue;
      tracks.push({
        name: lane.name,
        channel: lane.channel,
        program: lane.role === 'drums' ? null : gmFor(lane.patch),
        notes,
        lane,
      });
    }
    return tracks;
  }

  /** one part as a single-track .mid, in the session's key over the part's own chords */
  function partMidi(part, session, laneLike) {
    const lane = laneLike || (session && Odd.model.laneForRole(session, part.role)) || null;
    const tonic = session ? session.tonic : part.ctx.tonic;
    const scale = session ? session.scale : part.ctx.scale;
    const length = part.bars * T.BAR;
    let events = R.partEvents(part, { tonic, scale, prog: part.ctx.prog, length });
    events = R.applySwing(events, session ? session.swing : 0);
    const role = part.role;
    return Odd.midiFile.write({
      name: part.name,
      bpm: session ? session.bpm : 120,
      tonic, scale, length,
      tracks: [{
        name: part.name,
        channel: role === 'drums' ? 9 : lane ? lane.channel : 0,
        program: role === 'drums' ? null : gmFor(lane ? lane.patch : Odd.model.roleInfo(role).defaultPatch),
        notes: events,
      }],
    });
  }

  function sectionMidi(session, section) {
    const length = section.bars * T.BAR;
    const events = R.applySwing(R.sectionEvents(session, section), session.swing);
    const tonic = T.mod(session.tonic + (section.transpose || 0), 12);
    return Odd.midiFile.write({
      name: session.name + ' - ' + section.name,
      bpm: session.bpm, tonic, scale: session.scale, length,
      markers: [{ t: 0, text: section.name }],
      tracks: lanesToTracks(session, events),
    });
  }

  function songMidi(session) {
    const song = R.songEvents(session);
    const events = R.applySwing(song.events, session.swing);
    return Odd.midiFile.write({
      name: session.name,
      bpm: session.bpm, tonic: session.tonic, scale: session.scale, length: song.length,
      markers: song.markers.map((m) => ({ t: m.start, text: m.name })),
      tracks: lanesToTracks(session, events),
    });
  }

  function readme(session, extra) {
    const song = R.songEvents(session);
    const lines = [
      session.name,
      '',
      'Tempo: ' + session.bpm + ' BPM (4/4)',
      'Key: ' + keyLabel(session),
      'Length: ' + Odd.model.songBars(session) + ' bars',
      'Arrangement: ' + song.markers.map((m) => m.name).join(' > '),
      '',
      'Every stem starts at bar 1 and runs the full length of the song,',
      'so dropping them all into a DAW at the same position lines them up.',
      'Drums are on MIDI channel 10 using the General MIDI drum map.',
    ];
    if (extra) lines.push('', extra);
    lines.push('', 'Made with Oddition.');
    return lines.join('\n') + '\n';
  }

  /** zip: one .mid per lane + the full song .mid + a readme */
  function stemsZip(session) {
    const song = R.songEvents(session);
    const events = R.applySwing(song.events, session.swing);
    const tracks = lanesToTracks(session, events);
    const folder = safeName(session.name);
    const files = [];
    tracks.forEach((tr, i) => {
      const bytes = Odd.midiFile.write({
        name: tr.name,
        bpm: session.bpm, tonic: session.tonic, scale: session.scale, length: song.length,
        markers: song.markers.map((m) => ({ t: m.start, text: m.name })),
        tracks: [{ name: tr.name, channel: tr.channel, program: tr.program, notes: tr.notes }],
      });
      files.push({ name: folder + '/' + String(i + 1).padStart(2, '0') + ' ' + safeName(tr.name) + '.mid', data: bytes });
    });
    files.push({ name: folder + '/' + folder + ' (full song).mid', data: songMidi(session) });
    files.push({ name: folder + '/README.txt', data: readme(session) });
    return { bytes: Odd.zip.create(files), count: tracks.length };
  }

  /**
   * zip of rendered audio: one .wav per lane + the full mix.
   * Needs Odd.audio.renderOffline (browser only). onProgress(done, total, label)
   */
  async function stemsWav(session, onProgress) {
    if (!Odd.audio || !Odd.audio.renderOffline) throw new Error('Audio rendering is not available here.');
    const song = R.songEvents(session);
    const lanesWithNotes = session.lanes.filter((l) => song.events.some((e) => e.track === l.id));
    const folder = safeName(session.name);
    const files = [];
    const total = lanesWithNotes.length + 1;
    let done = 0;
    const tick = (label) => { if (onProgress) onProgress(done, total, label); };

    for (const lane of lanesWithNotes) {
      tick(lane.name);
      const evs = song.events.filter((e) => e.track === lane.id);
      const tracks = R.tracksFor(session);
      for (const k in tracks) { tracks[k].solo = false; tracks[k].mute = k !== lane.id; }
      tracks[lane.id].mute = false;
      const seq = R.sequence(session, evs, song.length, false);
      seq.tracks = tracks;
      const buf = await Odd.audio.renderOffline(seq, { tailSec: 2.5 });
      files.push({
        name: folder + '/' + String(files.length + 1).padStart(2, '0') + ' ' + safeName(lane.name) + '.wav',
        data: Odd.audio.encodeWav(buf),
      });
      done++;
    }
    tick('Full mix');
    const mixSeq = R.sequence(session, song.events, song.length, false);
    const mix = await Odd.audio.renderOffline(mixSeq, { tailSec: 2.5 });
    files.push({ name: folder + '/' + folder + ' (mix).wav', data: Odd.audio.encodeWav(mix) });
    files.push({ name: folder + '/README.txt', data: readme(session, 'Audio rendered with Oddition\'s built-in synth at 44.1 kHz / 16-bit.') });
    done++;
    tick('Done');
    return { bytes: Odd.zip.create(files), count: lanesWithNotes.length };
  }

  // ---------------- projects ----------------

  function projectJson(ws) {
    return JSON.stringify({ app: 'oddition', exported: new Date().toISOString(), workspace: ws });
  }

  function sessionJson(ws, session) {
    return JSON.stringify({ app: 'oddition', exported: new Date().toISOString(), session });
  }

  /** returns { workspace } or { session } or throws */
  function parseProject(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== 'oddition') throw new Error('This file is not an Oddition project.');
    if (data.workspace) {
      const ws = Odd.model.migrate(data.workspace);
      if (!ws) throw new Error('The project file is missing its sessions.');
      return { workspace: ws };
    }
    if (data.session) {
      const ws = Odd.model.migrate({ sessions: [data.session], library: [] });
      if (!ws) throw new Error('The session in this file is empty.');
      return { session: ws.sessions[0] };
    }
    throw new Error('The file has no workspace or session in it.');
  }

  /**
   * MIDI file -> shelf parts (one per track with notes), read as scale degrees
   * of the given session's key. Each becomes a looping clip of whole bars.
   */
  function importMidi(bytes, session, fileName) {
    const mf = Odd.midiFile.read(bytes);
    const scaleTicks = T.PPQ / (mf.ppq || T.PPQ);
    const parts = [];
    mf.tracks.forEach((tr, i) => {
      if (!tr.notes.length) return;
      const isDrum = tr.notes.every((n) => n.ch === 9);
      const notes = tr.notes.map((n) => ({ t: Math.round(n.t * scaleTicks), d: Math.max(15, Math.round(n.d * scaleTicks)), p: n.p, v: n.v }));
      const end = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
      let bars = Math.max(1, Math.ceil(end / T.BAR - 0.01));
      bars = [1, 2, 4, 8, 16, 32].find((b) => b >= bars) || 32;
      const length = bars * T.BAR;
      const avg = notes.reduce((s, n) => s + n.p, 0) / notes.length;
      const role = isDrum ? 'drums' : avg < 50 ? 'bass' : guessRole(tr, notes, avg);
      const base = isDrum ? null : Math.round((avg - 6) / 12) * 12;
      const out = [];
      for (const n of notes) {
        if (n.t >= length) continue;
        const d = Math.min(n.d, length - n.t);
        if (isDrum) out.push({ t: n.t, d, v: n.v, p: n.p });
        else {
          const dg = T.degreeOf(n.p, session.tonic, session.scale, base);
          out.push({ t: n.t, d, v: n.v, deg: dg.deg, acc: dg.acc });
        }
      }
      parts.push({
        role,
        name: (tr.name || (fileName || 'Imported').replace(/\.midi?$/i, '')) + (mf.tracks.length > 2 ? ' ' + (i + 1) : ''),
        style: session.style,
        seed: 0,
        bars,
        params: {},
        // imported clips have no chord map of their own: play them as written
        ctx: { tonic: session.tonic, scale: session.scale, prog: [{ deg: 0, beats: bars * 4 }] },
        base,
        notes: out,
        tags: ['imported'],
        imported: true,
      });
    });
    return parts;
  }

  function guessRole(tr, notes, avg) {
    const name = (tr.name || '').toLowerCase();
    for (const r of ['bass', 'pad', 'arp', 'lead', 'chord']) if (name.includes(r)) return r === 'chord' ? 'chords' : r;
    // count notes that start together
    const starts = new Map();
    for (const n of notes) starts.set(n.t, (starts.get(n.t) || 0) + 1);
    const poly = notes.length / starts.size;
    if (poly > 2.2) return avg < 64 ? 'pad' : 'chords';
    return 'lead';
  }

  Odd.exporter = {
    safeName, gmFor, keyLabel, partMidi, sectionMidi, songMidi, stemsZip, stemsWav,
    projectJson, sessionJson, parseProject, importMidi,
  };
})(globalThis.Odd = globalThis.Odd || {});
