'use strict';
// Icons, session state, shared UI helpers, and screen navigation (push/pop animations, swipe back).

// ---------- icons ----------
const I = {
  back: '<svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  lockSm: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>',
  unlockSm: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  chev: '<svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><path d="m1 1 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  face: '<svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15v-5a4 4 0 0 1 4-4h5M33 6h5a4 4 0 0 1 4 4v5M42 33v5a4 4 0 0 1-4 4h-5M15 42h-5a4 4 0 0 1-4-4v-5"/><path d="M17 18v3M31 18v3M24 18v8h-2M18 31c3.5 3 8.5 3 12 0"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.4 1.1 4.6 3 6.2L4.2 21l3.9-1.9c1.2.4 2.5.6 3.9.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
};

// ---------- session state ----------
// S = { key, raw, vault, meta:{customFields}, clients:[], recs:Map, offline, syncedAt }
let S = null, PV = null, Q = '', F = 'All', cur = { v: 'list' }, ACT = {};
const settings = Object.assign({ lockAfter: 60, lastBackup: 0, bioOffer: true }, readLS('cv-settings'));
const saveSettings = () => writeLS('cv-settings', settings);

app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACT[t.dataset.act]) { e.preventDefault(); ACT[t.dataset.act](t, e); }
});

// big: the page has its own large title; the small one fades into the bar once that scrolls away.
const bar = ({ left = '', title = '', right = '', big = false }) =>
  `<header class="bar${big ? ' has-big' : ''}"><div class="bar-row"><div>${left}</div><div class="bar-t">${esc(title)}</div><div class="bar-r">${right}</div></div></header>`;
const backBtn = (label, act) => `<button class="nav-btn back" data-act="${act}">${I.back}<span>${esc(label)}</span></button>`;
const sw = (on, act, extra = '') => `<button type="button" class="switch" role="switch" aria-checked="${!!on}" data-act="${act}"${extra}></button>`;
const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const hue = n => { let h = 0; for (const ch of n || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const avatar = (n, big) => `<div class="avatar${big ? ' big' : ''}" style="--h:${hue(n)}" aria-hidden="true">${esc(initials(n))}</div>`;

// ---------- navigation ----------
// Like iOS: a deeper screen slides in from the right over the previous one ("push") and slides
// back out ("pop"); the edit screen rises as a sheet ("present") and drops away ("dismiss").
// The outgoing screen is copied into a layer so both are visible while they move.
const DEPTH = { list: 0, due: 0, dash: 0, settings: 0, detail: 2, bulk: 2, ext: 2, templates: 2, csvimport: 2, changepw: 2, import: 2, edit: 3, task: 3, comp: 3, fees: 3, wa: 4, login: 4, doc: 4, firm: 5 };
// Where "back" (and swipe-back) goes from each screen.
const toDetailOr = (a, v, arg) => a.back === v ? { v, arg } : { v: 'detail', arg: a.id };
const PARENT = {
  detail: () => ({ v: DETAIL_BACK }), due: () => ({ v: 'list' }), dash: () => ({ v: 'list' }), settings: () => ({ v: 'list' }),
  edit: id => id ? { v: 'detail', arg: id } : { v: 'list' }, comp: id => ({ v: 'detail', arg: id }), fees: id => ({ v: 'detail', arg: id }),
  task: a => a.back === 'detail' ? { v: 'detail', arg: a.id } : { v: 'due' }, bulk: () => ({ v: 'due' }), ext: a => ({ v: a?.back || 'due' }), doc: a => ({ v: 'fees', arg: a.id }), firm: a => a?.back ? { v: 'doc', arg: a.back } : { v: 'settings' },
  wa: a => a.back === 'task' ? { v: 'task', arg: a.task } : toDetailOr(a, 'fees', a.id),
  login: a => a.back === 'task' ? { v: 'task', arg: a.task } : { v: 'detail', arg: a.id },
  changepw: () => ({ v: 'settings' }), import: () => ({ v: 'settings' }), templates: () => ({ v: 'settings' }), csvimport: () => ({ v: 'settings' }),
};
let DETAIL_BACK = 'list';
const snaps = {}; // last look of each screen, shown underneath while swiping back
const EASE = 'cubic-bezier(.32,.72,0,1)', DUR = 460;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let skipAnim = false, finishTransition = null;

function makeLayer(kind, nodes) {
  const layer = document.createElement('div');
  layer.className = 'layer ' + kind;
  layer.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('div');
  inner.className = 'layer-in';
  inner.append(...nodes);
  // The copy is just a picture: drop ids so lookups like $('#list') can't land in it.
  inner.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  const dim = document.createElement('div');
  dim.className = 'dim';
  layer.append(inner, dim);
  return layer;
}
// cloneNode keeps what was typed into inputs, so a closing form doesn't flash old values.
const copyOfApp = kind => makeLayer(kind, [...app.childNodes].map(n => n.cloneNode(true)));

function transition(mode, layer, y) {
  finishTransition?.();
  const below = mode === 'push' || mode === 'present';
  document.body.insertBefore(layer, below ? app : app.nextSibling);
  layer.scrollTop = y;
  if (mode === 'dismiss') layer.classList.add('sheet');
  // Scale around the middle of what's on screen, not the middle of a long page.
  app.style.transformOrigin = `50% ${scrollY + innerHeight / 2}px`;
  const o = { duration: DUR, easing: EASE };
  const move = (el, a, b) => el.animate([{ transform: a }, { transform: b }], o);
  const fade = (el, a, b) => el.animate([{ opacity: a }, { opacity: b }], o);
  const dim = layer.lastChild;
  const anims =
    mode === 'push' ? [move(app, 'translateX(100%)', 'none'), move(layer, 'none', 'translateX(-30%)'), fade(dim, 0, .1)]
    : mode === 'pop' ? [move(app, 'translateX(-30%)', 'none'), move(layer, 'none', 'translateX(100%)')]
    : mode === 'present' ? [move(app, 'translateY(100%)', 'none'), move(layer, 'none', 'scale(.94)'), fade(dim, 0, .2)]
    : [move(layer, 'none', 'translateY(100%)'), move(app, 'scale(.94)', 'none')];
  document.body.classList.add('animating', 'anim-' + mode);
  const done = () => {
    finishTransition = null;
    anims.forEach(a => a.cancel());
    layer.remove();
    app.style.transformOrigin = '';
    document.body.classList.remove('animating', 'anim-' + mode);
  };
  finishTransition = done;
  const end = () => { if (finishTransition === done) done(); };
  Promise.all(anims.map(a => a.finished)).then(end, () => {});
  setTimeout(end, DUR + 400); // never leave the screen untappable if the animation is paused
}

function go(v, arg, keepScroll) {
  const from = cur.v, live = !!(from && app.querySelector('.bar'));
  if (live) snaps[from] = { html: app.innerHTML, y: scrollY, arg: cur.arg };
  const mode = !live || keepScroll || skipAnim || from === v || reduceMotion() ? ''
    : v === 'edit' ? 'present' : from === 'edit' ? 'dismiss'
    : DEPTH[v] > DEPTH[from] ? 'push' : DEPTH[v] < DEPTH[from] ? 'pop' : '';
  const layer = mode && copyOfApp(mode === 'push' || mode === 'present' ? 'under' : 'over'), y = scrollY;
  if (v === 'detail' && DETAIL_BACK_LABEL[from]) DETAIL_BACK = from;
  cur = { v, arg }; ACT = {};
  ({ list: renderList, detail: renderDetail, edit: renderEdit, settings: renderSettings, changepw: renderChangePw, import: renderImport,
    due: renderDue, task: renderTask, comp: renderComp, fees: renderFees, wa: renderWa, bulk: renderBulk, login: renderLogin,
    templates: renderTemplates, csvimport: renderCsvImport, dash: renderDash, ext: renderExt, doc: renderDoc, firm: renderFirm })[v](arg);
  if (!keepScroll) scrollTo(0, 0);
  // Switching between tabs cross-fades instead of sliding.
  const fade = !mode && live && !keepScroll && !skipAnim && from !== v && TABS.has(from) && TABS.has(v) && !reduceMotion();
  // Start after any scroll restore by goBack(), but before the browser paints.
  queueMicrotask(() => {
    if (layer) transition(mode, layer, y);
    if (fade) app.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    updateBar(); updateTabs();
  });
}
// Going back returns to where you were scrolled, e.g. the same spot in a long client list.
function goBack(v, arg) {
  const s = snaps[v];
  go(v, arg);
  if (s && s.arg === arg) scrollTo(0, s.y);
}

// Hairline under the bar once content scrolls beneath it, and the small title once the large one is gone.
function updateBar() {
  const b = app.querySelector('.bar');
  if (!b) return;
  b.classList.toggle('edge', scrollY > 1);
  const big = app.querySelector('[data-big]');
  if (big) b.classList.toggle('collapsed', big.getBoundingClientRect().bottom < b.getBoundingClientRect().bottom + 4);
}
addEventListener('scroll', updateBar, { passive: true });

// Swipe right from the left edge to go back, with the previous screen showing underneath.
let swipe = null;
addEventListener('touchstart', e => {
  swipe = null;
  const t = e.touches[0];
  if (!S || e.touches.length !== 1 || t.clientX > 28 || !PARENT[cur.v] || !(ACT.back || ACT.cancel)) return;
  swipe = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, dir: null, layer: null };
}, { passive: true });
addEventListener('touchmove', e => {
  const s = swipe;
  if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (!s.dir) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    s.dir = dx > Math.abs(dy) ? 'h' : 'v';
    if (s.dir === 'v') { swipe = null; return; }
    startSwipe(s);
  }
  e.preventDefault();
  s.dx = Math.max(0, dx);
  paintSwipe(s, s.dx, false);
}, { passive: false });
addEventListener('touchend', endSwipe);
addEventListener('touchcancel', endSwipe);
function startSwipe(s) {
  finishTransition?.();
  const target = PARENT[cur.v](cur.arg), snap = snaps[target.v];
  const ok = snap && (target.arg === undefined || snap.arg === target.arg);
  const tpl = document.createElement('template');
  tpl.innerHTML = ok ? snap.html : '';
  s.layer = makeLayer('under', [...tpl.content.childNodes]);
  document.body.insertBefore(s.layer, app);
  if (ok) s.layer.scrollTop = snap.y;
  document.body.classList.add('swiping');
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function paintSwipe(s, dx, animate) {
  const p = Math.min(1, dx / innerWidth), tr = animate ? `transform .35s ${EASE}, opacity .35s` : 'none';
  app.style.transition = tr; app.style.transform = `translateX(${dx}px)`;
  s.layer.style.transition = tr; s.layer.style.transform = `translateX(${(p - 1) * 30}%)`;
  s.layer.lastChild.style.transition = tr; s.layer.lastChild.style.opacity = (0.1 * (1 - p)).toFixed(3);
}
function endSwipe() {
  const s = swipe;
  swipe = null;
  if (!s || s.dir !== 'h') return;
  const speed = s.dx / Math.max(1, Date.now() - s.t);
  const done = s.dx > innerWidth * 0.35 || (speed > 0.45 && s.dx > 30);
  paintSwipe(s, done ? innerWidth : 0, true);
  setTimeout(() => {
    s.layer.remove(); document.body.classList.remove('swiping');
    if (done) { const back = ACT.back || ACT.cancel; skipAnim = true; try { back?.(); } finally { skipAnim = false; } }
    app.style.transition = ''; app.style.transform = '';
  }, 350);
}

// ---------- tab bar (phone) / sidebar (wide screens) ----------
// The four main screens. On a phone they sit in a bar at the bottom; from 900px wide they become
// a sidebar. The bar hides on forms (anything with Cancel / Done), so a half-filled form isn't left by accident.
const TABS = new Set(['list', 'due', 'dash', 'settings']);
const FORMS = new Set(['edit', 'comp', 'templates', 'firm', 'changepw', 'import', 'csvimport', 'task']);
let TAB = 'list';
const tabsEl = $('#tabs');
function updateTabs() {
  const on = !!S && !!cur.v;
  document.body.classList.toggle('unlocked', on);
  document.body.classList.toggle('in-form', on && FORMS.has(cur.v));
  if (!on) return;
  if (TABS.has(cur.v)) TAB = cur.v;
  $$('[data-tab]', tabsEl).forEach(b => { const here = b.dataset.tab === TAB; b.classList.toggle('on', here); here ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  const n = dueLists().overdue.length, badge = $('[data-tab="due"] .tbadge', tabsEl);
  badge.hidden = !n; badge.textContent = n > 99 ? '99+' : n;
  $('[data-tab="due"]', tabsEl).setAttribute('aria-label', n ? `Due dates, ${plural(n, 'overdue filing')}` : 'Due dates');
}
tabsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b || !S || FORMS.has(cur.v)) return;
  if (b.dataset.tab === 'lock') return lock();
  if (b.dataset.tab === cur.v) return scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  if (b.dataset.tab === 'due') DUEF = 'open';
  go(b.dataset.tab);
});

// ---------- keyboard ----------
// Esc goes back (or cancels a form); "/" or Ctrl/⌘+K jumps to the client search.
addEventListener('keydown', e => {
  if (!S || e.defaultPrevented || e.isComposing) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if (typing && e.target.value) return; // first Esc in a search box clears it (browser default)
    const back = ACT.cancel || ACT.back;
    if (back) { e.preventDefault(); back(); }
  } else if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    if (FORMS.has(cur.v)) return;
    if (cur.v !== 'list') go('list');
    $('#q')?.focus();
  }
});
