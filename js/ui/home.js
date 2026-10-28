/* Oddition — the home screen: the logo, and Bobby Beatdown waving you over.
 *
 * Tap Bobby and he opens his menu: Idea Builder (Bones to Gold), Song Builder,
 * Session Takeover (the studio). Picking one plays a short riff and goes there.
 * With an empty idea book, the Song Builder points you to the Idea Builder.
 *
 * Odd.home.mount(el, host) once; host = { go(screen), stats(), stopAll() }.
 *   stats() -> { ideas, session } for the line under the menu.
 * Odd.home.show(on) when the screen changes.
 */
(function (Odd) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const GO_MS = 650; // Bobby's line and the riff, then the screen changes
  const LINES = {
    hello: ['Hey, boss, come here, I’ve got great stuff to show you!', 'Psst. Boss. Over here. You’re gonna love this.'],
    menu: 'Here’s what I’ve got. Where do you want to start?',
    menuFirst: 'Here’s what I’ve got. New here? Start with an idea.',
    bones: 'Idea Builder. Let’s dig up some bones and turn them gold.',
    song: 'Song Builder. Grab an idea from your book and we’ll make it a song.',
    studio: 'Session Takeover. The band’s warmed up. The desk is yours.',
  };
  const ARROW = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // little pictures of each place
  const PIC = {
    bones: '<svg width="220" height="96" viewBox="0 0 220 96" aria-hidden="true" focusable="false">' +
      [[10, 70, 16, 0], [52, 58, 28, 8], [94, 44, 42, 18], [136, 28, 58, 34], [178, 10, 76, 76]].map(([x, y, h, g]) =>
        '<rect x="' + x + '" y="' + y + '" width="30" height="' + h + '" rx="3" fill="var(--b-bone)"/>' +
        (g ? '<rect x="' + x + '" y="' + y + '" width="30" height="' + g + '" rx="3" fill="var(--b-gold)"/>' : '')).join('') +
      '<path d="M14 62 L60 50 L102 36 L144 20 L186 4" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="3 4" fill="none"/></svg>',
    song: '<svg width="220" height="96" viewBox="0 0 220 96" aria-hidden="true" focusable="false">' +
      '<rect x="8" y="34" width="44" height="40" rx="5" fill="var(--raised)" stroke="var(--line)"/>' +
      '<rect x="8" y="34" width="8" height="40" rx="3" fill="var(--r-pad)" opacity=".55"/>' +
      '<rect x="60" y="22" width="48" height="52" rx="5" fill="var(--raised)" stroke="var(--b-gold)"/>' +
      '<rect x="100" y="22" width="8" height="52" rx="3" fill="var(--r-arp)" opacity=".55"/>' +
      '<rect x="116" y="42" width="38" height="32" rx="5" fill="var(--raised)" stroke="var(--line)"/>' +
      '<rect x="162" y="16" width="50" height="58" rx="5" fill="var(--raised)" stroke="var(--line)"/>' +
      '<rect x="162" y="16" width="10" height="58" rx="3" fill="var(--r-pad)" opacity=".55"/>' +
      [['lead', 32, 26], ['chords', 42, 22], ['bass', 52, 28], ['drums', 62, 18]].map(([r, y, w]) => '<rect x="68" y="' + y + '" width="' + w + '" height="5" rx="2" fill="var(--r-' + r + ')"/>').join('') +
      '</svg>',
    studio: '<svg width="220" height="96" viewBox="0 0 220 96" aria-hidden="true" focusable="false">' +
      [['drums', 10, [[8, 40], [56, 40], [104, 40], [152, 60]]], ['perc', 23, [[8, 88], [152, 60]]], ['bass', 36, [[8, 64], [80, 64], [152, 60]]],
        ['chords', 49, [[56, 156]]], ['pad', 62, [[8, 136]]], ['lead', 75, [[104, 108]]]].map(([r, y, bs]) =>
        bs.map(([x, w]) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="9" rx="2" fill="var(--r-' + r + ')"/>').join('')).join('') +
      '<rect x="122" y="4" width="2" height="88" fill="var(--tally)"/></svg>',
  };
  const PLACES = [
    { id: 'bones', kick: 'Bones to Gold', name: 'Idea Builder', desc: 'Start from bare bones. I play you three takes at a time, you pick, and we climb until it’s gold.', go: 'Make an idea' },
    { id: 'song', kick: 'Ideas into a song', name: 'Song Builder', desc: 'Bring an idea or two from your book. We grow it into verses, choruses and hooks, one section at a time.', go: 'Build a song' },
    { id: 'studio', kick: 'The full band, live', name: 'Session Takeover', desc: 'The band’s already jamming. Step up to the desk, audition takes lane by lane, and keep what grooves.', go: 'Take over' },
  ];

  let root = null, host = {}, shown = false;
  const S = { open: false, pick: '', n: 0, timer: 0 };

  // ---------------------------------------------------------------- sound
  const RIFFS = {
    open: { patch: 'lead-soft', notes: [[62, 0], [65, 1], [69, 2], [72, 3.5], [74, 4]], kicks: [0, 4] },
    bones: { patch: 'bell', notes: [[62, 0], [69, 1], [74, 2]], kicks: [0] },
    song: { patch: 'keys', notes: [[65, 0], [69, 1], [72, 2], [77, 3]], kicks: [0, 2] },
    studio: { patch: 'bass-pluck', notes: [[38, 0], [38, 1.5], [45, 2], [48, 3]], kicks: [0, 2] },
  };
  function riff(name) {
    const r = RIFFS[name];
    if (!r || !Odd.audio || !Odd.synth) return;
    Odd.audio.ensure().then((ctx) => {
      const t0 = ctx.currentTime + 0.04, s = 0.13;
      r.notes.forEach(([p, i]) => Odd.synth.play(r.patch, p, 100, t0 + i * s, 0.28));
      r.kicks.forEach((i) => Odd.synth.play('kit-lofi', 36, 110, t0 + i * s, 0.1));
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- drawing
  function line() {
    if (S.pick) return LINES[S.pick];
    if (S.open) return firstRun() ? LINES.menuFirst : LINES.menu;
    return LINES.hello[S.n % LINES.hello.length];
  }
  function firstRun() { const st = stats(); return !st.ideas; }
  function stats() { try { return (host.stats && host.stats()) || {}; } catch (e) { return {}; } }

  function card(p, i) {
    const start = p.id === 'bones' && firstRun();
    return '<button type="button" class="h-card' + (S.pick === p.id ? ' on' : '') + (p.soon ? ' soon' : '') + '" data-act="go" data-to="' + p.id + '" style="animation-delay:' + (i * 0.08) + 's">' +
      '<span class="h-pic">' + PIC[p.id] + '</span>' +
      '<span class="h-body">' +
        '<span class="h-kick">' + esc(p.kick) + (start ? '<em>Start here</em>' : '') + '</span>' +
        '<span class="h-name">' + esc(p.name) + '</span>' +
        '<span class="h-desc">' + esc(p.desc) + '</span>' +
        '<span class="h-go">' + esc(p.go) + (p.soon ? '' : ARROW) + '</span>' +
      '</span>' +
    '</button>';
  }

  function recent() {
    const st = stats();
    const ideas = st.ideas ? 'Your idea book: ' + st.ideas + (st.ideas === 1 ? ' idea' : ' ideas') : 'Your idea book is empty';
    const songs = st.songs ? ' · ' + st.songs + (st.songs === 1 ? ' song' : ' songs') : '';
    return ideas + songs + (st.session ? ' · Last session: ' + esc(st.session) : '');
  }

  function render() {
    if (!root || !shown) return;
    root.innerHTML =
      '<div class="home' + (S.open ? ' is-open' : '') + '">' +
        '<header class="h-logo">' +
          '<div class="h-lockup">' + Odd.brand.mark(96) + '<h1 class="h-word">' + Odd.brand.wordmark() + '</h1></div>' +
          '<p class="h-tag">a band that auditions for you</p>' +
        '</header>' +
        '<section class="h-bobby">' +
          '<div class="h-bubble"><span class="b-who">Bobby Beatdown</span><span class="h-say" aria-live="polite">' + esc(line()) + '</span></div>' +
          '<button type="button" class="h-bob" data-act="bobby" aria-expanded="' + S.open + '" aria-label="' + (S.open ? 'Close Bobby’s menu' : 'Talk to Bobby Beatdown') + '">' + Odd.brand.BOBBY + '</button>' +
          (S.open ? '' : '<p class="h-hint">Tap Bobby</p>') +
        '</section>' +
        (S.open ? '<nav class="h-menu" aria-label="Where to">' + PLACES.map(card).join('') + '</nav><p class="h-recent">' + recent() + '</p>' : '') +
      '</div>';
  }

  /** Bobby's line and the picked card change without redrawing (keeps the cards' entrance) */
  function patch() {
    if (!root) return;
    const say = root.querySelector('.h-say');
    if (say) say.textContent = line();
    root.querySelectorAll('.h-card').forEach((el) => el.classList.toggle('on', el.dataset.to === S.pick));
  }

  // ---------------------------------------------------------------- actions
  function toggle() {
    clearTimeout(S.timer);
    if (!S.open) riff('open');
    else S.n++;
    S.open = !S.open;
    S.pick = '';
    render();
    if (S.open) {
      const first = root.querySelector('.h-card');
      if (first) first.focus({ preventScroll: true });
    }
  }

  function go(to) {
    clearTimeout(S.timer);
    S.pick = to;
    riff(to);
    patch();
    const place = PLACES.find((p) => p.id === to);
    if (!place || place.soon) return;
    S.timer = setTimeout(() => {
      S.pick = '';
      if (host.go) host.go(to);
    }, GO_MS);
  }

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    if (el.dataset.act === 'bobby') toggle();
    else if (el.dataset.act === 'go') go(el.dataset.to);
  }

  /** Escape closes the menu. true when handled */
  function onKey(e) {
    if (e.key === 'Escape' && S.open) { toggle(); const b = root.querySelector('.h-bob'); if (b) b.focus(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- outside
  function mount(el, h) {
    root = el;
    host = h || {};
    root.addEventListener('click', onClick);
  }

  function show(on) {
    shown = !!on;
    clearTimeout(S.timer);
    if (!shown) { if (root) root.innerHTML = ''; return; }
    S.pick = '';
    render();
  }

  Odd.home = {
    mount, show, onKey, LINES, PLACES,
    get state() { return { open: S.open, pick: S.pick }; },
  };
})(globalThis.Odd = globalThis.Odd || {});
