// RAJNEETI — casual mobile game interface. One big card, a few big buttons.

const UI = { screen: 'title', reveal: null, setup: null, toastT: null, deal: null, pdeal: null, card: 0 };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* not supported */ } };

const PROMISE_ICON = { loanwaiver: '🚜', msp: '🌾', taxcut: '💸', jobs: '👷', ops: '👴', cash: '👩', health: '🏥', corptax: '🏢', prices: '🧅', infra: '🛣️', lokpal: '🕵️', skills: '🛠️' };
const REFORM_ICON = { gst: '🧾', labour: '🏭', farmmkt: '🌽', msp: '🌾', loanwaiver: '🚜', pli: '📱', disinvest: '🏷️', bankrecap: '🏦', health: '🏥', cash: '👩', ops: '👴', itsimple: '📄', green: '☀️', dpi: '📲', lokpal: '🕵️', land: '🏗️', urbanjobs: '🧱', skills: '🛠️', demo: '💵', onoe: '🗳️' };

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(UI.toastT);
  UI.toastT = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function handle(res) {
  if (!res) return;
  if (res.err) { toast(res.err, 'bad'); buzz(40); }
  else if (res.msg) { toast(res.msg, res.fail ? 'bad' : 'good'); buzz(15); }
  render();
}

// 👍🌾 👎💼 — who likes / dislikes something, as emoji only
function fans(blocs) {
  const up = [], down = [];
  for (const [b, v] of Object.entries(blocs)) (v > 0 ? up : down).push(BLOCS.find(x => x.id === b).icon);
  return `<div class="fans">${up.length ? `<span class="like">👍 ${up.join('')}</span>` : ''}${down.length ? `<span class="dislike">👎 ${down.join('')}</span>` : ''}</div>`;
}

function tug(you, A, label = 'Need 272 to win') {
  const w = x => (x / TOTAL_SEATS * 100).toFixed(1) + '%';
  return `<div class="tug">
    <div class="tugtop"><span class="who"><i class="av" style="background:${G.color}">${G.symbol}</i><b>${you}</b></span><span class="need">${label}</span><span class="who right"><b>${A}</b><i class="av" style="background:${RIVALS.A.color}">🔥</i></span></div>
    <div class="tugbar"><i class="me" style="width:${w(you)};background:${G.color}"></i><i class="them" style="width:${w(A)};background:${RIVALS.A.color}"></i><span class="crown">👑</span></div>
  </div>`;
}

function topbar(chips) {
  return `<header class="top">${chips.map(c => `<span class="chip">${c}</span>`).join('')}<button class="menu" data-a="menu" aria-label="Menu">☰</button></header>`;
}

// ---------------- title & setup ----------------
function renderTitle() {
  return `<div class="screen title">
    <div class="logo-art">🏛️</div>
    <h1 class="logo">RAJNEETI</h1>
    <p class="sub">Become Prime Minister!</p>
    <div class="spacer"></div>
    ${hasSave() ? '<button class="gbtn green big" data-a="continue">▶ CONTINUE</button>' : ''}
    <button class="gbtn ${hasSave() ? 'blue' : 'green'} big" data-a="newgame">${hasSave() ? 'NEW GAME' : '▶ PLAY'}</button>
    <button class="gbtn ghost" data-a="help">How to play</button>
  </div>`;
}

function renderSetup() {
  const s = UI.setup;
  return `<div class="screen title">
    <h2 class="white">Who are you?</h2>
    <input id="f-leader" class="bigin" maxlength="22" value="${esc(s.leader)}" placeholder="Your name">
    <p class="white small">Pick your party symbol</p>
    <div class="symbols">${PARTY_SYMBOLS.map((x, i) => `<button class="symb ${s.symbol === x ? 'on' : ''}" style="background:${PARTY_COLORS[i % PARTY_COLORS.length]}" data-a="setsym" data-v="${x}" data-c="${PARTY_COLORS[i % PARTY_COLORS.length]}">${x}</button>`).join('')}</div>
    <div class="spacer"></div>
    <button class="gbtn green big" data-a="start">START ▶</button>
  </div>`;
}

function helpHTML() {
  return `<h2>How to play</h2>
  <div class="howto">
    <div><span>🃏</span><p>Pick a card each turn.</p></div>
    <div><span>🤝</span><p>Make friends with local parties — they bring seats.</p></div>
    <div><span>👑</span><p>Get <b>272 seats</b> to become PM.</p></div>
    <div><span>👉</span><p>As PM, swipe right to say yes, left to say no.</p></div>
    <div><span>😀</span><p>Keep people happy. Win again!</p></div>
  </div>
  <button class="gbtn green" data-a="closemodal">OK!</button>`;
}

// ---------------- campaign ----------------
function dealCampaign() {
  const C = G.camp, cards = [];
  const sh = s => stateShares(s);
  const battle = STATES.filter(s => s.seats >= 10).map(s => { const x = sh(s); return { s, v: s.seats * (1.2 - Math.abs(x[0] - x[1])) * (1 + rand() * .6) }; }).sort((a, b) => b.v - a.v);
  if (C.funds >= 15) cards.push({ k: 'rally', s: battle[0].s.id });
  const allies = STATES.filter(s => s.reg && C.alliances[s.id] !== 'you' && !actionBlocked('alliance', s.id))
    .map(s => ({ s, v: allianceChance(s.id) * s.seats * (1 + rand() * .8) })).sort((a, b) => b.v - a.v);
  if (allies.length) cards.push({ k: 'alliance', s: allies[0].s.id });
  if (C.funds < 40) cards.push({ k: 'fundraise' });
  else cards.push({ k: rand() < .65 ? 'ads' : 'attack' });
  if (cards.length < 3 && !cards.some(c => c.k === 'fundraise')) cards.push({ k: 'fundraise' });
  if (cards.length < 3 && C.funds >= 15) cards.push({ k: 'rally', s: battle[1].s.id });
  UI.deal = cards;
}

function moveCard(c, i) {
  const s = c.s ? stateById(c.s) : null;
  let icon, title, sub, badge;
  if (c.k === 'rally') { icon = '📣'; title = `Rally in ${s.name}`; sub = `${s.seats} seats`; badge = '₹15'; }
  if (c.k === 'alliance') { icon = '🤝'; title = `Team up with ${s.reg.short}`; sub = `${s.name} · ${s.seats} seats`; badge = Math.round(allianceChance(s.id) * 100) + '%'; }
  if (c.k === 'ads') { icon = '📺'; title = 'TV Ads everywhere'; sub = 'Boost in every state'; badge = '₹40'; }
  if (c.k === 'attack') { icon = '⚔️'; title = 'Attack the RSP'; sub = 'Risky!'; badge = '₹10'; }
  if (c.k === 'fundraise') { icon = '💰'; title = 'Raise money'; sub = 'Get ₹50+'; badge = 'FREE'; }
  const blocked = actionBlocked(c.k, c.s);
  return `<button class="mcard" data-a="move" data-i="${i}" ${blocked ? 'disabled' : ''} style="animation-delay:${i * 60}ms">
    <span class="mi">${icon}</span><span class="mt"><b>${title}</b><small>${sub}</small></span><span class="badge">${badge}</span></button>`;
}

function renderCampaign() {
  const C = G.camp;
  const last = C.polls[C.polls.length - 1];
  if (!C.manifestoDone && !C.promises.length) return renderManifesto(last);
  if (!UI.deal) dealCampaign();
  const ev = C.event && CAMPAIGN_EVENTS.find(e => e.id === C.event.id);
  return `<div class="screen">
    ${topbar([`📅 Week ${C.week}/${C.weeks}`, `💰 ₹${Math.round(C.funds)}`])}
    ${tug(last.youBloc, last.aBloc)}
    ${ev ? eventCard(ev, C.event.ctx, 'cev') : `
    <div class="stage">
      <p class="prompt">Choose your move <span class="dots">${'●'.repeat(C.ap)}${'○'.repeat(C.apMax - C.ap)}</span></p>
      <div class="mcards">${UI.deal.map(moveCard).join('')}</div>
    </div>`}
  </div>`;
}

function renderManifesto(last) {
  const C = G.camp;
  if (!UI.pdeal) {
    const chosen = UI.picked || [];
    UI.pdeal = PROMISES.filter(p => !chosen.includes(p.id)).sort(() => rand() - .5).slice(0, 3).map(p => p.id);
  }
  const n = (UI.picked || []).length;
  return `<div class="screen">
    ${topbar([`📜 Promise ${n + 1} of 3`])}
    ${tug(last.youBloc, last.aBloc)}
    <div class="stage">
      <p class="prompt">What do you promise India?</p>
      <div class="mcards">${UI.pdeal.map((id, i) => {
        const p = PROMISES.find(x => x.id === id);
        return `<button class="mcard" data-a="promise" data-id="${id}" style="animation-delay:${i * 60}ms"><span class="mi">${PROMISE_ICON[id]}</span><span class="mt"><b>${p.name}</b>${fans(p.blocs)}</span></button>`;
      }).join('')}</div>
    </div>
  </div>`;
}

function eventCard(ev, ctx, kind) {
  const choices = ev.choices(G, ctx);
  return `<div class="stage">
    <div class="bigcard news">
      <div class="emo">${ev.icon}</div><h2>${ev.title}</h2><p>${esc(ev.text(G, ctx))}</p>
    </div>
    <div class="answers">${choices.map((c, i) => `<button class="gbtn ${['blue', 'orange', 'red'][i]}" data-a="${kind}" data-i="${i}">${c.label}${c.cost ? ` <small>₹${c.cost}</small>` : ''}${c.pc ? ` <small>${c.pc}⭐</small>` : ''}</button>`).join('')}</div>
  </div>`;
}

// ---------------- results ----------------
function renderResults() {
  const r = G.result;
  const order = STATES.slice().sort((a, b) => a.seats - b.seats);
  if (!UI.reveal) {
    UI.reveal = { n: 0 };
    const step = () => {
      if (!UI.reveal || G.phase !== 'results') return;
      UI.reveal.n++; buzz(5);
      render();
      if (UI.reveal.n < order.length) UI.reveal.timer = setTimeout(step, 180);
    };
    UI.reveal.timer = setTimeout(step, 500);
  }
  let you = 0, A = 0;
  for (const s of order.slice(0, UI.reveal.n)) {
    const x = r.byState[s.id], al = r.alliances[s.id];
    you += x.you + (al === 'you' ? x.R : 0); A += x.A + (al === 'A' ? x.R : 0);
  }
  const done = UI.reveal.n >= order.length;
  const latest = order[Math.min(UI.reveal.n, order.length) - 1];
  let verdict = '';
  if (done) {
    if (r.youBloc >= MAJORITY) verdict = '<div class="verdict win">🎉 YOU WIN! 🎉</div>';
    else if (r.aBloc >= MAJORITY) verdict = '<div class="verdict lose">😢 YOU LOST</div>';
    else verdict = '<div class="verdict">⚖️ NO WINNER YET</div>';
  }
  return `<div class="screen">
    ${topbar(['🗳️ Counting votes'])}
    <div class="stage">
      <div class="bignums"><div style="color:${G.color}"><b>${you}</b><small>${G.symbol} YOU</small></div><div class="vsx">VS</div><div style="color:${RIVALS.A.color}"><b>${A}</b><small>🔥 RSP</small></div></div>
      ${tug(you, A, '272 to win')}
      ${!done && latest ? `<p class="prompt">${latest.name}…</p>` : verdict}
    </div>
    <div class="bottom">${done ? '<button class="gbtn green big" data-a="afterresults">NEXT ▶</button>' : '<button class="gbtn ghost" data-a="skipreveal">Skip ⏩</button>'}</div>
  </div>`;
}

// ---------------- coalition ----------------
function renderCoalition() {
  const c = G.coal, t = coalTotals();
  const k = c.kingmakers.find(x => !x.side && !x.tried);
  return `<div class="screen">
    ${topbar([`🤝 Deal time · Round ${Math.min(c.round, c.rounds)}/${c.rounds}`])}
    ${tug(t.you, t.A)}
    ${k ? `<div class="stage">
      <div class="bigcard"><div class="emo">🤝</div><h2>${esc(k.short)}</h2><p>${esc(k.name)} has <b>${k.seats} seats</b>. Will they join you?</p></div>
      <div class="answers">
        <button class="gbtn blue" data-a="offer" data-k="${k.key}" data-o="ask">🙏 Just ask</button>
        <button class="gbtn orange" data-a="offer" data-k="${k.key}" data-o="berth" ${c.berths ? '' : 'disabled'}>🏛️ Make them minister</button>
        <button class="gbtn green" data-a="offer" data-k="${k.key}" data-o="package">🎁 Money for their state</button>
      </div></div>`
    : `<div class="stage"><p class="prompt">Waiting for the others…</p></div><div class="bottom"><button class="gbtn green big" data-a="coalround">NEXT ▶</button></div>`}
  </div>`;
}

// ---------------- governance ----------------
function meter(icon, good) {
  const g = clamp(good, 0, 1);
  const col = g >= .6 ? '#4ade80' : g >= .35 ? '#facc15' : '#f87171';
  return `<div class="meter"><div class="mfill"><i style="height:${Math.max(6, g * 100)}%;background:${col}"></i><span>${icon}</span></div></div>`;
}

function renderGov() {
  const g = G.gov, e = G.eco;
  if (!g.hand) dealHand();
  const ev = g.events[0];
  const budgetDue = isBudgetQuarter() && g.lastBudgetQ !== g.q;
  let stage;
  if (ev) stage = eventCard(GOV_EVENTS.find(x => x.id === ev.id), ev.ctx, 'gev');
  else if (budgetDue) stage = budgetStage();
  else if (!g.played && UI.card < g.hand.length) stage = ideaStage(g.hand[UI.card]);
  else stage = `<div class="stage"><div class="bigcard"><div class="emo">⏳</div><h2>Time passes…</h2></div></div><div class="bottom"><button class="gbtn green big" data-a="endq">NEXT ▶</button></div>`;
  return `<div class="screen">
    ${topbar([`📅 Year ${Math.floor(g.q / 4) + 1}/5`, `⭐ ${g.pc}`])}
    <div class="meters" data-a="stats">
      ${meter('😀', (overallApproval() - 25) / 45)}
      ${meter('💰', (e.growth - 2) / 7)}
      ${meter('🛒', 1 - (e.infl - 3.5) / 6)}
      ${meter('🏦', 1 - (e.deficit - 3.5) / 4.5)}
    </div>
    ${stage}
  </div>`;
}

function budgetStage() {
  const icons = { populist: 'green', balanced: 'blue', growth: 'orange', austerity: 'red' };
  return `<div class="stage">
    <div class="bigcard"><div class="emo">📒</div><h2>Budget Day!</h2><p>How will you spend India's money this year?</p></div>
    <div class="grid2">${Object.entries(BUDGET_PRESETS).map(([k, p]) => `<button class="gbtn ${icons[k]}" data-a="preset" data-k="${k}">${p.icon} ${p.name}</button>`).join('')}</div>
    <p class="tiny">🎁 happy people, more debt · ✂️ less debt, angry people · 🏗️ growth later</p>
  </div>`;
}

function ideaStage(c) {
  const g = G.gov;
  let icon, title, desc, extra = '', cost, can;
  if (c.type === 'pm') {
    const a = PM_ACTIONS[c.id];
    icon = a.icon; title = a.name; desc = a.desc; cost = a.pc; can = g.pc >= a.pc && !g[a.once];
  } else {
    const r = REFORMS.find(x => x.id === c.id), st = billStatus(r.id);
    const promised = g.promises.some(id => PROMISES.find(p => p.id === id).check.toString().includes(`'${r.id}'`));
    icon = REFORM_ICON[r.id] || '📜'; title = r.name; desc = r.desc; cost = r.pc; can = g.pc >= r.pc;
    extra = `${promised ? '<div class="promised">📜 You promised this!</div>' : ''}${fans(r.blocs)}${st.objectors.length ? `<div class="warnline">😠 ${st.objectors.map(a => a.short).join(', ')} won't like it</div>` : ''}`;
  }
  return `<div class="stage">
    <div class="bigcard swipe" data-can="${can ? 1 : 0}">
      <div class="stamp yes">YES</div><div class="stamp no">NO</div>
      <span class="costtag ${can ? '' : 'poor'}">${cost} ⭐</span>
      <div class="emo">${icon}</div><h2>${title}</h2><p>${desc}</p>${extra}
    </div>
    <div class="yesno">
      <button class="round red" data-a="skipcard" aria-label="No">✖</button>
      <span class="tiny">${can ? 'swipe or tap' : 'Not enough ⭐'}</span>
      <button class="round green" data-a="playcard" ${can ? '' : 'disabled'} aria-label="Yes">✔</button>
    </div>
  </div>`;
}

// ---------------- end screens ----------------
function renderReport() {
  const r = G.report;
  return `<div class="screen title">
    <div class="logo-art">📋</div><h2 class="white">5 years done!</h2>
    <div class="bigcard">
      <p>😀 Popularity <b>${r.approval}%</b></p><p>💰 Growth <b>${r.growth}%</b></p>
      <p>✅ Promises kept <b>${r.kept.length}</b> · ❌ broken <b>${r.broken.length}</b></p>
    </div>
    <div class="spacer"></div>
    <button class="gbtn green big" data-a="reelect">ELECTION TIME ▶</button>
  </div>`;
}

function renderGameOver() {
  const L = legacyScore();
  const lostFirst = G.quartersAsPM === 0;
  return `<div class="screen title">
    <div class="logo-art">${lostFirst ? '😢' : '🏆'}</div>
    <h2 class="white">${lostFirst ? 'So close! Try again.' : `You ruled for ${L.yrs} years!`}</h2>
    <div class="bigcard"><small>YOUR TITLE</small><h2>${L.title}</h2><div class="score">⭐ ${L.score}</div></div>
    <div class="spacer"></div>
    <button class="gbtn green big" data-a="newgame">PLAY AGAIN ▶</button>
  </div>`;
}

// ---------------- router ----------------
function render() {
  let html;
  if (UI.screen === 'setup') html = renderSetup();
  else if (!G || UI.screen === 'title') html = renderTitle();
  else if (G.phase === 'campaign') html = renderCampaign();
  else if (G.phase === 'results') html = renderResults();
  else if (G.phase === 'coalition') html = renderCoalition();
  else if (G.phase === 'gov') html = renderGov();
  else if (G.phase === 'termreport') html = renderReport();
  else html = renderGameOver();
  $('#app').innerHTML = html;
  bindSwipe();
}

function openModal(html) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'modal-bg'; m.id = 'popup';
  m.innerHTML = `<div class="modal">${html}</div>`;
  $('#app').appendChild(m);
}
function closeModal() { const m = $('#popup'); if (m) m.remove(); }

// Drag the idea card: right = yes, left = no.
function bindSwipe() {
  const card = $('.swipe');
  if (!card) return;
  let x0 = null, dx = 0;
  const can = card.dataset.can === '1';
  card.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', e => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    if (!can && dx > 0) dx = Math.min(dx, 30);
    card.style.transform = `translateX(${dx}px) rotate(${dx / 16}deg)`;
    card.querySelector('.yes').style.opacity = clamp(dx / 80, 0, 1);
    card.querySelector('.no').style.opacity = clamp(-dx / 80, 0, 1);
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    card.style.transition = 'transform .25s';
    if (dx > 80 && can) flyOut(card, 1, () => ACTIONS.playcard());
    else if (dx < -80) flyOut(card, -1, () => ACTIONS.skipcard());
    else { card.style.transform = ''; card.querySelectorAll('.stamp').forEach(s => { s.style.opacity = 0; }); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function flyOut(card, dir, then) {
  buzz(15);
  card.style.transform = `translateX(${dir * 520}px) rotate(${dir * 30}deg)`;
  setTimeout(then, 200);
}

function finishQuarter() {
  const before = overallApproval();
  const r = endQuarter();
  if (r.err) { toast(r.err, 'bad'); return render(); }
  UI.card = 0;
  if (G.phase === 'gov') {
    const d = Math.round(overallApproval() - before);
    toast(`${d >= 0 ? '😀' : '😟'} People ${d >= 0 ? '+' : ''}${d}%`, d >= 0 ? 'good' : 'bad');
  }
  render();
}

const ACTIONS = {
  continue() { if (load()) { UI.screen = 'game'; UI.deal = null; UI.card = 0; render(); } },
  newgame() { UI.setup = { leader: '', symbol: PARTY_SYMBOLS[0], color: PARTY_COLORS[0] }; UI.screen = 'setup'; G = null; render(); },
  help() { openModal(helpHTML()); },
  closemodal() { closeModal(); },
  setsym(d) { UI.setup.leader = $('#f-leader').value; UI.setup.symbol = d.v; UI.setup.color = d.c; buzz(8); render(); },
  start() {
    const name = ($('#f-leader').value || '').trim() || 'Asha Verma';
    const s = UI.setup;
    newGame({ leader: name, party: 'Jan Shakti Party', short: 'JSP', symbol: s.symbol, color: s.color, ideology: 'centrist', difficulty: 'normal' });
    UI.screen = 'game'; UI.reveal = null; UI.deal = null; UI.pdeal = null; UI.picked = []; UI.card = 0;
    render();
    let seen = false; try { seen = !!localStorage.getItem('rajneeti.seenHelp'); localStorage.setItem('rajneeti.seenHelp', '1'); } catch (e) { /* ignore */ }
    if (!seen) openModal(helpHTML());
  },
  promise(d) {
    buzz(10);
    UI.picked = (UI.picked || []).concat(d.id); UI.pdeal = null;
    if (UI.picked.length === 3) { choosePromises(UI.picked); UI.picked = []; toast('📣 Promises announced!', 'good'); }
    render();
  },
  move(d) {
    const c = UI.deal[+d.i];
    const before = G.camp.polls[G.camp.polls.length - 1].youBloc;
    const r = campaignAction(c.k, c.s, false);
    if (r.err) return handle(r);
    toast(r.msg, 'good'); buzz(15);
    UI.deal = null;
    if (G.camp.ap === 0) {
      const w = endWeek();
      if (!w.election) {
        const now = G.camp.polls[G.camp.polls.length - 1].youBloc;
        toast(`📊 New poll: ${now - before >= 0 ? '+' : ''}${now - before} seats`, now >= before ? 'good' : 'bad');
      } else UI.reveal = null;
    }
    render();
  },
  cev(d) { UI.deal = null; handle(resolveCampaignEvent(+d.i)); },
  skipreveal() { clearTimeout(UI.reveal.timer); UI.reveal.n = 999; render(); },
  afterresults() {
    UI.reveal = null; afterResults(); save(); UI.card = 0; render();
    if (G.phase === 'gov') welcomePM();
  },
  offer(d) { handle(coalOffer(d.k, d.o)); save(); },
  coalround() { coalEndRound(); save(); UI.card = 0; render(); if (G.phase === 'gov') welcomePM(); },
  gev(d) {
    const r = resolveGovEvent(+d.i);
    if (r.err) { toast(r.err, 'bad'); return; }
    toast(r.msg, 'good'); buzz(15);
    if (r.phaseChange) { UI.deal = null; UI.pdeal = null; UI.picked = []; }
    render();
  },
  preset(d) { handle(budgetPreset(d.k)); },
  playcard() {
    const r = playCard(UI.card);
    if (r.err) { toast(r.err, 'bad'); return render(); }
    toast(r.msg, r.fail ? 'bad' : 'good');
    finishQuarter();
  },
  skipcard() { UI.card++; if (UI.card >= G.gov.hand.length) finishQuarter(); else render(); },
  endq() { finishQuarter(); },
  stats() {
    const e = G.eco;
    openModal(`<h2>🇮🇳 India</h2>
      <div class="srow"><span>😀 People happy</span><b>${Math.round(overallApproval())}%</b></div>
      <div class="srow"><span>💰 Economy growth</span><b>${e.growth.toFixed(1)}%</b></div>
      <div class="srow"><span>🛒 Prices rising</span><b>${e.infl.toFixed(1)}%</b></div>
      <div class="srow"><span>🏦 Govt. debt (deficit)</span><b>${e.deficit.toFixed(1)}%</b></div>
      <div class="srow"><span>👷 Jobless</span><b>${e.unemp.toFixed(1)}%</b></div>
      <div class="faces">${BLOCS.map(b => `<span>${b.icon}<br>${Math.round(G.gov.approval[b.id])}%</span>`).join('')}</div>
      ${G.gov.promises.length ? `<h3>Promises</h3>${G.gov.promises.map(id => `<div class="srow"><span>${PROMISES.find(x => x.id === id).check(G) ? '✅' : '⏳'} ${PROMISES.find(x => x.id === id).name}</span></div>`).join('')}` : ''}
      <button class="gbtn green" data-a="closemodal">OK</button>`);
  },
  allies() {
    const g = G.gov;
    openModal(`<h2>🤝 Friends</h2>${g.allies.map(a => `<div class="srow"><span>${a.sat >= 50 ? '😀' : a.sat >= 30 ? '😐' : '😠'} ${esc(a.short)} · ${a.seats} seats</span><button class="gbtn small orange" data-a="pkggo" data-k="${a.key}" ${g.pc < 1 ? 'disabled' : ''}>🎁 1⭐</button></div>`).join('') || '<p>No allies.</p>'}
      <button class="gbtn green" data-a="closemodal">OK</button>`);
  },
  pkggo(d) { handle(allyPackage(d.k)); },
  reelect() { goToElection(false); UI.deal = null; UI.pdeal = null; UI.picked = []; render(); },
  menu() {
    openModal(`<h2>Menu</h2><div class="answers">
      <button class="gbtn blue" data-a="help">📖 How to play</button>
      ${G && G.phase === 'gov' ? '<button class="gbtn blue" data-a="allies">🤝 My friends</button>' : ''}
      <button class="gbtn orange" data-a="quit">🏠 Save & exit</button>
      <button class="gbtn green" data-a="closemodal">▶ Resume</button></div>`);
  },
  quit() { save(); UI.screen = 'title'; G = null; render(); },
};

function welcomePM() {
  openModal(`<div class="center"><div class="emo">🇮🇳</div><h2>You are Prime Minister!</h2>
    <p>Ideas will come to you.<br><b>Swipe right = YES</b> · <b>left = NO</b></p>
    <p>Keep the 4 meters green!</p><button class="gbtn green" data-a="closemodal">LET'S GO ▶</button></div>`);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  if ($('#popup')) { if (!el.closest('#popup')) return; closeModal(); }
  ACTIONS[el.dataset.a] && ACTIONS[el.dataset.a](el.dataset);
});

render();
