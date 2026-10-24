/* Oddition — inline SVG icons (stroke-based, 24px grid, currentColor). */
(function (Odd) {
  'use strict';
  const P = {
    play: '<path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
    vary: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M15 7c2.8 0 5 2.2 5 5M9 17c-2.8 0-5-2.2-5-5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    fwd: '<path d="M9 5l7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    dots: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
    star: '<path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8z"/>',
    starFill: '<path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8z" fill="currentColor"/>',
    download: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19.5h14"/>',
    undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a4.5 4.5 0 010 9h-3"/>',
    redo: '<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5H9a4.5 4.5 0 000 9h3"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
    loop: '<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 015-5h11M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 01-5 5H4"/>',
    trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
    edit: '<path d="M14.5 5.5l4 4L8 20H4v-4z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
    chevron: '<path d="M7 10l5 5 5-5"/>',
    place: '<path d="M4 4h7v7H4zM13 13h7v7h-7z"/><path d="M14 4h6v6M20 4l-6 6"/>',
    shelf: '<path d="M3.5 20h17M5 20V9M10 20V5M14 20V8M18.5 20l-2.5-11"/>',
    booth: '<rect x="8.5" y="3" width="7" height="11" rx="3.5"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7"/>',
    song: '<path d="M3 6h18M3 12h18M3 18h18M8 3v18M15 3v18"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17v.2"/>',
    midi: '<circle cx="12" cy="12" r="8.5"/><circle cx="7.7" cy="12" r=".9" fill="currentColor"/><circle cx="16.3" cy="12" r=".9" fill="currentColor"/><circle cx="9" cy="8.2" r=".9" fill="currentColor"/><circle cx="15" cy="8.2" r=".9" fill="currentColor"/><circle cx="12" cy="7" r=".9" fill="currentColor"/><path d="M10.5 18.2h3"/>',
    headphones: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  };

  function icon(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>';
  }

  Odd.icon = icon;
})(globalThis.Odd = globalThis.Odd || {});
