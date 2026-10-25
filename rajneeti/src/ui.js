// RAJNEETI — interface. Renders G into #app and routes clicks to the engine.

const UI = { screen: 'title', sel: null, reveal: null, setup: null, toastT: null, picks: [] };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function partyColor(k, stateId, alliances) {
  if (k === 'you') return G.color;
  if (k === 'A') return RIVALS.A.color;
  if (k === 'B') return RIVALS.B.color;
  const al = alliances && alliances[stateId];
  if (al === 'you') return mix(G.color);
  if (al === 'A') return mix(RIVALS.A.color);
  return '#8b8f9a';
}
const mix = c => `color-mix(in srgb, ${c} 55%, #e5e7eb)`;

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(UI.toastT);
  UI.toastT = setTimeout(() => { t.className = 'toast'; }, 3000);
}

function handle(res) {
  if (!res) return;
  if (res.err) toast(res.err, 'bad');
  else if (res.msg) toast(res.msg, res.fail ? 'bad' : 'good');
  render();
}

function seatBar(you, A, others, labels = true) {
  const w = x => (x / TOTAL_SEATS * 100).toFixed(2) + '%';
  return `<div class="seatbar">
    <div style="width:${w(you)};background:${G.color}"></div>
    <div style="width:${w(others)};background:#6b7280"></div>
    <div style="width:${w(A)};background:${RIVALS.A.color}"></div>
    <span class="majline" title="272 for majority"></span>
  </div>${labels ? `<div class="seatlabels"><span style="color:${G.color}">You ${you}</span><span class="muted">272 to win</span><span style="color:${RIVALS.A.color}">RSP ${A}</span></div>` : ''}`;
}

const effChips = blocs => Object.entries(blocs).map(([b, v]) => `<span class="chipfx ${v > 0 ? 'up' : 'down'}">${BLOCS.find(x => x.id === b).icon}${v > 0 ? '▲' : '▼'}</span>`).join('');
const blocLegend = () => `<div class="blegend">${BLOCS.map(b => `<span>${b.icon} ${b.name}</span>`).join('')}</div>`;
const face = v => v >= 62 ? '😀' : v >= 50 ? '🙂' : v >= 40 ? '😐' : v >= 28 ? '😠' : '🤬';

// ---------------- title & setup ----------------
function renderTitle() {
  return `<div class="title-screen">
    <div class="title-art">🏛️</div>
    <h1 class="logo">RAJNEETI</h1>
    <p class="tagline">Path to Power</p>
    <p class="intro">Win the election. Become Prime Minister. Stay in power.</p>
    <div class="title-buttons">
      ${hasSave() ? '<button class="btn primary big" data-a="continue">▶ Continue</button>' : ''}
      <button class="btn ${hasSave() ? '' : 'primary'} big" data-a="newgame">New Game</button>
      <button class="btn ghost" data-a="help">How to Play</button>
    </div>
    <p class="fine">Plays offline · Saves automatically</p>
  </div>`;
}

function renderSetup() {
  const s = UI.setup;
  return `<div class="setup">
    <h2>Start your party</h2>
    <label>Your name<input id="f-leader" maxlength="28" value="${esc(s.leader)}"></label>
    <label>Party name<input id="f-party" maxlength="36" value="${esc(s.party)}"></label>
    <div class="field"><span>Symbol & colour</span><div class="chips">${PARTY_SYMBOLS.map(x => `<button class="chip ${s.symbol === x ? 'on' : ''}" data-a="set" data-k="symbol" data-v="${x}">${x}</button>`).join('')}</div>
      <div class="chips">${PARTY_COLORS.map(c => `<button class="swatch ${s.color === c ? 'on' : ''}" style="background:${c}" data-a="set" data-k="color" data-v="${c}" aria-label="colour"></button>`).join('')}</div></div>
    <div class="field"><span>What do you stand for?</span><div class="cards3">${Object.entries(IDEOLOGIES).map(([k, v]) => `<button class="pick ${s.ideology === k ? 'on' : ''}" data-a="set" data-k="ideology" data-v="${k}"><b>${v.name}</b><small>${v.desc}</small></button>`).join('')}</div></div>
    <div class="field"><span>Difficulty</span><div class="chips">${Object.entries(DIFFICULTY).map(([k, v]) => `<button class="chip wide ${s.difficulty === k ? 'on' : ''}" data-a="set" data-k="difficulty" data-v="${k}">${v.name}</button>`).join('')}</div></div>
    <div class="row gap"><button class="btn ghost" data-a="title">Back</button><button class="btn primary big" data-a="start">Let's go →</button></div>
  </div>`;
}

function helpHTML() {
  return `<h2>How to play</h2>
  <div class="howto">
    <div><span>🗳️</span><p><b>Win the election.</b> You get 3 moves a week. Tap a state to hold a <b>rally</b> or win over its local party as an <b>ally</b>. Big states like UP (80 seats) matter most. Get 272 seats with your allies.</p></div>
    <div><span>🤝</span><p><b>Allies are the key.</b> Local parties join whoever is winning, so build momentum first. Watch out — the RSP will try to steal them.</p></div>
    <div><span>🏛️</span><p><b>Rule as PM.</b> Every quarter: handle a crisis, then play one policy card. Once a year, pick a budget.</p></div>
    <div><span>⚖️</span><p><b>Keep everyone happy.</b> Prices, jobs and growth matter. Keep your promises. Keep your allies. Then win again!</p></div>
  </div>
  <button class="btn primary" data-a="closemodal">Got it</button>`;
}

// ---------------- campaign ----------------
function renderCampaign() {
  const C = G.camp;
  const proj = projection(16);
  const last = C.polls[C.polls.length - 1];
  const sel = UI.sel ? stateById(UI.sel) : null;
  const left = C.weeks - C.week + 1;
  return `${topbar([
    ['📅', `Week ${C.week}/${C.weeks}`],
    ['💰', '₹' + Math.round(C.funds) + ' cr'],
    ['⚡', `<span class="dots">${'●'.repeat(C.ap)}${'○'.repeat(C.apMax - C.ap)}</span>`],
    ['🔥', C.momentum >= 1 ? 'Hot' : C.momentum <= -1 ? 'Cold' : 'Even'],
  ])}
  <div class="play">
    <div class="card">
      <div class="card-h"><b>📊 Poll</b><span class="muted small">${left === 1 ? 'Election next!' : left + ' weeks left'}</span></div>
      ${seatBar(last.youBloc, last.aBloc, TOTAL_SEATS - last.youBloc - last.aBloc)}
      ${trendChart(C.polls)}
      <p class="tip">${campaignTip(last)}</p>
    </div>
    <div class="card">
      ${renderMap(proj, C.alliances)}
      <div class="legend">
        <span><i style="background:${G.color}"></i>You</span><span><i style="background:${mix(G.color)}"></i>Your allies</span>
        <span><i style="background:${RIVALS.A.color}"></i>RSP</span><span><i style="background:${mix(RIVALS.A.color)}"></i>RSP allies</span><span><i style="background:#8b8f9a"></i>Others</span>
      </div>
      ${sel ? renderStateSheet(sel, proj) : '<p class="muted center small">👆 Tap a state</p>'}
    </div>
    <div class="card">
      <div class="card-h"><b>🇮🇳 National moves</b></div>
      <div class="bigbtns">${['ads', 'fundraise', 'attack'].map(id => moveBtn(id)).join('')}</div>
    </div>
    ${C.promises.length ? `<div class="card small"><b>📜 Your promises:</b> ${C.promises.map(id => PROMISES.find(p => p.id === id).name).join(' · ')}</div>` : ''}
    <div class="card news">${G.log.slice(0, 3).map(l => `<div class="logline ${l.kind}">${esc(l.msg)}</div>`).join('')}</div>
  </div>
  <div class="bottombar"><span class="muted small">${C.ap ? `${C.ap} move${C.ap > 1 ? 's' : ''} left` : 'No moves left'}</span><button class="btn primary ${C.ap ? '' : 'pulse'}" data-a="endweek">${C.week === C.weeks ? 'Election Day 🗳️' : 'Next Week →'}</button></div>
  ${!C.manifestoDone && !C.promises.length ? manifestoModal() : C.event ? eventModal(CAMPAIGN_EVENTS.find(e => e.id === C.event.id), C.event.ctx, 'cev') : ''}`;
}

function campaignTip(last) {
  const C = G.camp;
  if (C.week === 1) return '💡 Start with rallies in big states, then seek allies once the polls move.';
  if (last.youBloc >= MAJORITY) return '🎉 You are on course for a majority. Defend your lead!';
  const free = STATES.filter(s => s.reg && !C.alliances[s.id]);
  if (free.length && last.youBloc > last.aBloc - 60) return `💡 Polls are close — local parties may now say yes. Try ${free.sort((a, b) => b.seats - a.seats)[0].name}.`;
  if (C.funds < 20) return '💡 Low on money? Hold a fundraiser.';
  return `💡 You need ${MAJORITY - last.youBloc} more seats. Big states swing elections.`;
}

function trendChart(polls) {
  const w = 300, h = 54, n = Math.max(polls.length, 2);
  const x = i => (i / (Math.max(G.camp.weeks, n - 1))) * (w - 10) + 5;
  const y = v => h - 4 - (v / 400) * (h - 8);
  const line = (k, c) => `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${polls.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')}"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="trend" preserveAspectRatio="none">
    <line x1="0" x2="${w}" y1="${y(272)}" y2="${y(272)}" stroke="currentColor" stroke-dasharray="4 4" opacity=".35"/>
    ${line('aBloc', RIVALS.A.color)}${line('youBloc', G.color)}
  </svg>`;
}

function renderMap(proj, alliances) {
  return `<div class="map">${STATES.map(s => {
    const r = proj.byState[s.id];
    let best = 'you'; for (const k of PKEYS) if (r[k] > r[best]) best = k;
    const col = partyColor(best, s.id, alliances);
    const al = alliances[s.id];
    return `<button class="tile ${UI.sel === s.id ? 'sel' : ''} ${al === 'you' ? 'ally' : ''}" style="grid-column:${s.pos[0] + 1};grid-row:${s.pos[1] + 1};--c:${col}" data-a="sel" data-s="${s.id}">
      <b>${s.id}</b><small>${s.seats}</small>${al === 'you' ? '<i class="star">🤝</i>' : ''}</button>`;
  }).join('')}</div>`;
}

function renderStateSheet(s, proj) {
  const C = G.camp, sh = stateShares(s), r = proj.byState[s.id], al = C.alliances[s.id];
  const mine = Math.round(r.you + (al === 'you' ? r.R : 0));
  const parts = [[G.short, sh[0], G.color], ['RSP', sh[1], RIVALS.A.color], [s.reg ? s.reg.short : 'Others', sh[3], partyColor('R', s.id, C.alliances)], ['NBM', sh[2], RIVALS.B.color]];
  let allyBtn = '';
  if (s.reg && al !== 'you') {
    const blocked = actionBlocked('alliance', s.id, false);
    const ch = Math.round(allianceChance(s.id, false) * 100);
    allyBtn = `<button class="move" data-a="camp" data-id="alliance" data-s="${s.id}" ${blocked ? 'disabled' : ''}>
      <span class="mi">🤝</span><b>Make ${s.reg.short} an ally</b><small>${blocked && blocked.includes('time') ? 'Not talking right now' : `${ch}% chance${al === 'A' ? ' · steal from RSP' : ''}`}</small></button>`;
  }
  return `<div class="sheet">
    <div class="sheet-h"><b>${s.name}</b><span class="seats">${s.seats} seats</span><button class="x" data-a="sel" data-s="">✕</button></div>
    <div class="share">${parts.map(([n, v, c]) => `<i style="width:${(v * 100).toFixed(1)}%;background:${c}" title="${n}"></i>`).join('')}</div>
    <div class="sharelbl">${parts.slice(0, 3).map(([n, v, c]) => `<span style="color:${c}">${esc(n)} ${Math.round(v * 100)}%</span>`).join('')}</div>
    <p class="small">You'd win about <b>${mine} of ${s.seats}</b> seats here.${s.reg ? ` Local party: <b>${s.reg.name}</b>${al === 'you' ? ' — <span class="up">your ally ✓</span>' : al === 'A' ? ' — <span class="down">with RSP</span>' : ''}.` : ''}</p>
    <div class="bigbtns">${moveBtn('rally', s.id)}${allyBtn}</div>
  </div>`;
}

const MOVE_TEXT = {
  rally: ['📣', 'Hold a rally', s => `Win votes in ${s.name}`],
  ads: ['📺', 'TV ad blitz', () => 'Boost everywhere'],
  fundraise: ['💰', 'Fundraiser', () => '+₹50 cr, trust −2'],
  attack: ['⚔️', 'Attack the RSP', () => 'Risky'],
};

function moveBtn(id, stateId) {
  const a = CAMPAIGN_ACTIONS[id], [icon, name, sub] = MOVE_TEXT[id];
  const blocked = actionBlocked(id, stateId);
  return `<button class="move" data-a="camp" data-id="${id}" ${stateId ? `data-s="${stateId}"` : ''} ${blocked ? 'disabled' : ''}>
    <span class="mi">${icon}</span><b>${name}</b><small>${a.cost ? '₹' + a.cost + ' cr · ' : ''}${sub(stateId ? stateById(stateId) : null)}</small></button>`;
}

function manifestoModal() {
  const n = UI.picks.length;
  return `<div class="modal-bg"><div class="modal">
    <h2>📜 Pick 3 promises</h2>
    <p class="muted small">Promises win votes. If you become PM, you must keep them!</p>
    ${blocLegend()}
    <div class="pgrid">${PROMISES.map(p => {
      const on = UI.picks.includes(p.id);
      return `<button class="pcard ${on ? 'on' : ''}" data-a="pickp" data-id="${p.id}" ${!on && n >= 3 ? 'disabled' : ''}><b>${on ? '✅ ' : ''}${p.name}</b><span class="fx">${effChips(p.blocs)}</span></button>`;
    }).join('')}</div>
    <button class="btn primary wide" data-a="manifesto" ${n === 3 ? '' : 'disabled'}>${n === 3 ? 'Announce manifesto 📣' : `Choose ${3 - n} more`}</button>
  </div></div>`;
}

function topbar(items) {
  return `<header class="topbar">
    <span class="sym" style="background:${G.color}" title="${esc(G.party)}">${G.symbol}</span>
    <div class="stats">${items.map(([i, v]) => `<div class="stat"><span>${i}</span><b>${v}</b></div>`).join('')}</div>
    <button class="iconbtn" data-a="menu" aria-label="Menu">☰</button>
  </header>`;
}

function eventModal(ev, ctx, kind) {
  const choices = ev.choices(G, ctx);
  return `<div class="modal-bg"><div class="modal event">
    <div class="ev-icon">${ev.icon}</div>
    <h2>${ev.title}</h2>
    <p>${esc(ev.text(G, ctx))}</p>
    <div class="choices">${choices.map((c, i) => `<button class="choice" data-a="${kind}" data-i="${i}"><b>${c.label}</b><small>${[c.cost ? '₹' + c.cost + ' cr' : '', c.pc ? c.pc + ' ⭐' : '', c.hint || ''].filter(Boolean).join(' · ')}</small></button>`).join('')}</div>
  </div></div>`;
}

// ---------------- results ----------------
function renderResults() {
  const r = G.result;
  const order = STATES.slice().sort((a, b) => a.seats - b.seats);
  if (!UI.reveal) {
    UI.reveal = { n: 0 };
    const step = () => {
      if (!UI.reveal || G.phase !== 'results') return;
      UI.reveal.n++;
      render();
      if (UI.reveal.n < order.length) UI.reveal.timer = setTimeout(step, 220);
    };
    UI.reveal.timer = setTimeout(step, 600);
  }
  const shown = order.slice(0, UI.reveal.n);
  let you = 0, A = 0, oth = 0;
  for (const s of shown) {
    const x = r.byState[s.id], al = r.alliances[s.id];
    you += x.you; A += x.A; oth += x.B;
    if (al === 'you') you += x.R; else if (al === 'A') A += x.R; else oth += x.R;
  }
  const done = UI.reveal.n >= order.length;
  let verdict = '';
  if (done) {
    if (r.youBloc >= MAJORITY) verdict = `<div class="verdict good">🎉 You won! ${r.youBloc} seats for your alliance.</div>`;
    else if (r.aBloc >= MAJORITY) verdict = `<div class="verdict bad">The RSP wins again with ${r.aBloc} seats.</div>`;
    else verdict = `<div class="verdict">⚖️ Nobody has 272! Time to make deals.</div>`;
  }
  return `<div class="results">
    <h1>🗳️ Counting Day</h1>
    <div class="bigcount"><div style="color:${G.color}"><b>${you}</b><small>You + allies</small></div><div class="muted"><b>${oth}</b><small>Others</small></div><div style="color:${RIVALS.A.color}"><b>${A}</b><small>RSP + allies</small></div></div>
    ${seatBar(you, A, oth, false)}
    <div class="results-grid">${shown.slice().reverse().map((s, i) => {
      const x = r.byState[s.id], al = r.alliances[s.id];
      const y = x.you + (al === 'you' ? x.R : 0), a = x.A + (al === 'A' ? x.R : 0);
      return `<div class="rstate ${i === 0 && !done ? 'new' : ''}"><b>${s.name}</b><span><i style="color:${G.color}">${y}</i> – <i style="color:${RIVALS.A.color}">${a}</i></span></div>`;
    }).join('')}</div>
    ${verdict}
    <div class="row gap center">${done ? '<button class="btn primary big" data-a="afterresults">Continue →</button>' : '<button class="btn ghost" data-a="skipreveal">Skip ⏩</button>'}</div>
  </div>`;
}

// ---------------- coalition ----------------
function renderCoalition() {
  const c = G.coal, t = coalTotals();
  return `<div class="coalition">
    <h1>🤝 Make a Deal</h1>
    <p class="muted center">Round ${Math.min(c.round, c.rounds)} of ${c.rounds} · Win parties over before the RSP does</p>
    ${seatBar(t.you, t.A, TOTAL_SEATS - t.you - t.A)}
    <div class="kingmakers">${c.kingmakers.map(k => {
      const side = k.side === 'you' ? '<span class="tag good">With you ✓</span>' : k.side === 'A' ? '<span class="tag bad">With RSP</span>' : k.tried ? '<span class="tag">Said no</span>' : '';
      const dis = k.side || k.tried ? 'disabled' : '';
      return `<div class="card km"><div class="card-h"><b>${esc(k.name)}</b><span class="seats">${k.seats} seats</span></div>
        <div class="small">${face(k.aff * 100)} Likes you ${Math.round(k.aff * 100)}% ${side}</div>
        ${k.side ? '' : `<div class="bigbtns three">
          <button class="move" data-a="offer" data-k="${k.key}" data-o="ask" ${dis}><span class="mi">🙏</span><b>Ask</b><small>Free</small></button>
          <button class="move" data-a="offer" data-k="${k.key}" data-o="berth" ${dis || (c.berths ? '' : 'disabled')}><span class="mi">🏛️</span><b>Minister post</b><small>${c.berths} left</small></button>
          <button class="move" data-a="offer" data-k="${k.key}" data-o="package" ${dis}><span class="mi">🎁</span><b>Money for state</b><small>Costs later</small></button>
        </div>`}</div>`;
    }).join('')}</div>
    <div class="bottombar"><span class="muted small">Bigger side after round ${c.rounds} forms the government</span><button class="btn primary" data-a="coalround">Next Round →</button></div>
  </div>`;
}

// ---------------- governance ----------------
function meter(icon, label, value, good, word) {
  const g = clamp(good, 0, 1);
  const col = g >= .6 ? 'var(--good)' : g >= .35 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="meter"><div class="mh"><span>${icon} ${label}</span><b style="color:${col}">${word}</b></div>
    <div class="mbar"><i style="width:${Math.max(6, g * 100)}%;background:${col}"></i></div><small class="muted">${value}</small></div>`;
}

function renderGov() {
  const g = G.gov, e = G.eco;
  if (!g.hand) dealHand();
  const appr = overallApproval();
  const ev = g.events[0];
  const budgetDue = isBudgetQuarter() && g.lastBudgetQ !== g.q;
  const growthWord = e.growth > 7.5 ? 'Booming' : e.growth > 6 ? 'Strong' : e.growth > 4 ? 'Slowing' : e.growth > 1.5 ? 'Weak' : 'Recession';
  const priceWord = e.infl < 4.5 ? 'Stable' : e.infl < 6 ? 'Rising' : e.infl < 8 ? 'High' : 'Soaring';
  const jobWord = e.unemp < 6 ? 'Plenty' : e.unemp < 8 ? 'OK' : e.unemp < 10 ? 'Scarce' : 'Crisis';
  const cashWord = e.deficit < 4.5 ? 'Healthy' : e.deficit < 6 ? 'Stretched' : e.deficit < 8 ? 'Strained' : 'Broke';
  const apprWord = appr >= 60 ? 'Loved' : appr >= 50 ? 'Liked' : appr >= 40 ? 'Mixed' : 'Angry';
  const kept = g.promises.filter(id => PROMISES.find(p => p.id === id).check(G)).length;
  return `${topbar([
    ['📅', quarterLabel(G.calQ)],
    ['⭐', g.pc + ' power'],
    ['🏛️', govSeats() + ' MPs'],
  ])}
  <div class="play">
    <div class="card">
      <div class="card-h"><b>🇮🇳 The Nation</b><span class="muted small">Year ${Math.floor(g.q / 4) + 1} of 5 · Term ${G.term}</span></div>
      <div class="meters">
        ${meter('👍', 'Popularity', Math.round(appr) + '% approve', (appr - 25) / 45, apprWord)}
        ${meter('📈', 'Economy', e.growth.toFixed(1) + '% growth', (e.growth - 2) / 7, growthWord)}
        ${meter('🛒', 'Prices', e.infl.toFixed(1) + '% inflation', 1 - (e.infl - 3.5) / 6, priceWord)}
        ${meter('👷', 'Jobs', e.unemp.toFixed(1) + '% jobless', 1 - (e.unemp - 4.5) / 6, jobWord)}
        ${meter('🏦', 'Treasury', e.deficit.toFixed(1) + '% deficit · ' + RATINGS[e.rating], 1 - (e.deficit - 3.5) / 4.5, cashWord)}
      </div>
      <div class="people">${BLOCS.map(b => `<div class="person" title="${b.name}: ${Math.round(g.approval[b.id])}%"><span>${b.icon}</span><b>${face(g.approval[b.id])}</b><small>${b.name.split(' ')[0]}</small></div>`).join('')}</div>
    </div>

    ${budgetDue ? `<div class="card hilite">
      <div class="card-h"><b>📒 Budget Day!</b><span class="muted small">Pick this year's budget</span></div>
      <div class="hand">${Object.entries(BUDGET_PRESETS).map(([k, p]) => `<button class="pcard" data-a="preset" data-k="${k}"><span class="ci">${p.icon}</span><b>${p.name}</b><small>${p.desc}</small></button>`).join('')}</div>
    </div>` : ''}

    <div class="card">
      <div class="card-h"><b>🗂️ Cabinet proposals</b><span class="muted small">${g.played ? 'Done for this quarter' : 'Play one card'}</span></div>
      ${g.played ? '' : blocLegend()}
      ${g.played ? '<p class="muted center">✅ You made your move. Tap <b>Next Quarter</b>.</p>' : `<div class="hand">${g.hand.map((c, i) => policyCard(c, i)).join('')}</div>`}
    </div>

    <div class="card">
      <div class="card-h"><b>🤝 Allies</b><span class="muted small">${g.minority ? '⚠️ No majority!' : `Majority +${govSeats() - MAJORITY + 1}`}</span></div>
      ${g.allies.length ? `<div class="allies">${g.allies.map(a => `<button class="allychip" data-a="pkg" data-k="${a.key}"><b>${esc(a.short)}</b> ${face(a.sat)} <small>${a.seats} MPs</small></button>`).join('')}</div><p class="muted small">Tap an ally to keep them happy.</p>` : '<p class="muted small">You rule alone.</p>'}
    </div>

    ${g.promises.length ? `<div class="card small"><b>📜 Promises kept: ${kept}/${g.promises.length}</b><br>${g.promises.map(id => { const p = PROMISES.find(x => x.id === id); return `${p.check(G) ? '✅' : '⏳'} ${p.keep}`; }).join('<br>')}</div>` : ''}
    <div class="card news">${G.log.slice(0, 3).map(l => `<div class="logline ${l.kind}">${esc(l.msg)}</div>`).join('')}</div>
  </div>
  <div class="bottombar"><span class="muted small">${20 - g.q} quarters to next election</span><button class="btn primary ${g.played && !budgetDue ? 'pulse' : ''}" data-a="endq">Next Quarter →</button></div>
  ${ev ? eventModal(GOV_EVENTS.find(x => x.id === ev.id), ev.ctx, 'gev') : ''}`;
}

function policyCard(c, i) {
  const g = G.gov;
  if (c.type === 'pm') {
    const a = PM_ACTIONS[c.id];
    const dis = g.pc < a.pc || g[a.once];
    return `<button class="pcard" data-a="play" data-i="${i}" ${dis ? 'disabled' : ''}><span class="ci">${a.icon}</span><b>${a.name}</b><small>${a.desc}</small><span class="cost">${a.pc} ⭐</span></button>`;
  }
  const r = REFORMS.find(x => x.id === c.id), st = billStatus(r.id);
  const promised = g.promises.some(id => PROMISES.find(p => p.id === id).check.toString().includes(`'${r.id}'`));
  const tags = [r.boost ? '📈 growth' : '', r.spend || r.oneTime ? '💸 costly' : '', r.revOnce || r.rev > 0 ? '💰 cash' : '', r.unemp ? '👷 jobs' : '', r.risk ? '🔥 protests' : ''].filter(Boolean);
  return `<button class="pcard" data-a="play" data-i="${i}" ${g.pc < r.pc ? 'disabled' : ''}>
    ${promised ? '<span class="ribbon">📜 Promise</span>' : ''}
    <span class="ci">📜</span><b>${r.name}</b><small>${r.desc}</small>
    <span class="fx">${effChips(r.blocs)} ${tags.map(t => `<span class="chipfx">${t}</span>`).join('')}</span>
    ${st.objectors.length ? `<span class="warn small">⚠️ Upsets ${st.objectors.map(a => a.short).join(', ')}</span>` : ''}
    <span class="cost">${r.pc} ⭐ · ${Math.round(billChance(r.id) * 100)}% pass</span></button>`;
}

// ---------------- term report & game over ----------------
function renderReport() {
  const r = G.report;
  return `<div class="report">
    <h1>📋 Your 5 Years</h1>
    <div class="inds big">
      <div class="ind"><span class="muted small">Growth</span><b>${r.growth}%</b></div>
      <div class="ind"><span class="muted small">Inflation</span><b>${r.infl}%</b></div>
      <div class="ind"><span class="muted small">Jobless</span><b>${r.unemp}%</b></div>
      <div class="ind"><span class="muted small">Popularity</span><b>${r.approval}%</b></div>
    </div>
    <div class="card"><b>✅ Promises kept (${r.kept.length})</b><p>${r.kept.map(esc).join(', ') || '—'}</p>
    <b>❌ Promises broken (${r.broken.length})</b><p class="down">${r.broken.map(esc).join(', ') || '—'}</p></div>
    <p class="muted center">The people will judge you. The RSP is ready to fight.</p>
    <button class="btn primary big" data-a="reelect">Fight the Election →</button>
  </div>`;
}

function renderGameOver() {
  const L = legacyScore();
  const lostFirst = G.quartersAsPM === 0;
  return `<div class="report">
    <h1>${lostFirst ? '💔 Defeat' : '🏁 The End of an Era'}</h1>
    <p class="lead">${lostFirst ? `The RSP stays in power. ${esc(G.leader)} will try again in five years.` : `${esc(G.leader)} was Prime Minister for ${L.yrs} years.`}</p>
    <div class="legacy"><small>Your legacy</small><b>${L.title}</b><span>${L.score} points</span></div>
    <div class="inds big">
      <div class="ind"><span class="muted small">Years as PM</span><b>${L.yrs}</b></div>
      <div class="ind"><span class="muted small">Elections won</span><b>${G.termsWon}</b></div>
      <div class="ind"><span class="muted small">Laws passed</span><b>${G.gov ? G.gov.passed.length : 0}</b></div>
      <div class="ind"><span class="muted small">Promises kept</span><b>${G.promisesKept}</b></div>
    </div>
    <button class="btn primary big" data-a="newgame">Play Again</button>
  </div>`;
}

// ---------------- router ----------------
function render() {
  const app = $('#app');
  let html;
  if (UI.screen === 'setup') html = renderSetup();
  else if (!G || UI.screen === 'title') html = renderTitle();
  else if (G.phase === 'campaign') html = renderCampaign();
  else if (G.phase === 'results') html = renderResults();
  else if (G.phase === 'coalition') html = renderCoalition();
  else if (G.phase === 'gov') html = renderGov();
  else if (G.phase === 'termreport') html = renderReport();
  else html = renderGameOver();
  const y = window.scrollY;
  app.innerHTML = html;
  window.scrollTo(0, y);
}

function openModal(html) {
  const m = document.createElement('div');
  m.className = 'modal-bg'; m.id = 'popup';
  m.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(m);
}
function closeModal() { const m = $('#popup'); if (m) m.remove(); }

function quarterSummary(before) {
  const e = G.eco, d = overallApproval() - before;
  return `📈 Growth ${e.growth.toFixed(1)}% · 🛒 Prices ${e.infl.toFixed(1)}% · 👍 ${Math.round(overallApproval())}% (${d >= 0 ? '+' : ''}${Math.round(d)})`;
}

const ACTIONS = {
  continue() { if (load()) { UI.screen = 'game'; render(); } },
  newgame() {
    UI.setup = { leader: 'Asha Verma', party: 'Jan Shakti Party', symbol: PARTY_SYMBOLS[0], color: PARTY_COLORS[0], ideology: 'centrist', difficulty: 'normal' };
    UI.screen = 'setup'; G = null; render();
  },
  title() { UI.screen = 'title'; G = null; render(); },
  help() { openModal(helpHTML()); },
  closemodal() { closeModal(); },
  set(d) { readSetupInputs(); UI.setup[d.k] = d.v; render(); },
  start() {
    readSetupInputs();
    const s = UI.setup;
    if (!s.leader.trim() || !s.party.trim()) return toast('Enter your name and party name', 'bad');
    s.short = s.party.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
    newGame(s); UI.screen = 'game'; UI.sel = 'UP'; UI.reveal = null; UI.picks = [];
    render();
    let seen = false; try { seen = !!localStorage.getItem('rajneeti.seenHelp'); localStorage.setItem('rajneeti.seenHelp', '1'); } catch (e) { /* ignore */ }
    if (!seen) openModal(helpHTML());
  },
  sel(d) { UI.sel = d.s || null; render(); },
  pickp(d) { const i = UI.picks.indexOf(d.id); if (i >= 0) UI.picks.splice(i, 1); else if (UI.picks.length < 3) UI.picks.push(d.id); render(); },
  manifesto() { choosePromises(UI.picks); UI.picks = []; toast('📣 Manifesto announced!', 'good'); render(); },
  camp(d) { handle(campaignAction(d.id, d.s, d.opt === '1')); },
  endweek() {
    const C = G.camp;
    if (C.ap === 3 && !UI.confirmSkip) { UI.confirmSkip = true; return toast('You still have 3 moves! Tap again to skip the week.', 'bad'); }
    UI.confirmSkip = false;
    const r = endWeek();
    if (r.err) return toast(r.err, 'bad');
    if (r.election) { UI.reveal = null; window.scrollTo(0, 0); }
    else { const p = G.camp.polls, a = p[p.length - 2], b = p[p.length - 1]; const d = b.youBloc - a.youBloc; toast(`New poll: you ${b.youBloc} seats (${d >= 0 ? '+' : ''}${d})`, d >= 0 ? 'good' : 'bad'); }
    render();
  },
  cev(d) { handle(resolveCampaignEvent(+d.i)); },
  skipreveal() { clearTimeout(UI.reveal.timer); UI.reveal.n = 999; render(); },
  afterresults() {
    UI.reveal = null; afterResults(); save(); window.scrollTo(0, 0); render();
    if (G.phase === 'gov') welcomePM();
  },
  offer(d) { handle(coalOffer(d.k, d.o)); save(); },
  coalround() { coalEndRound(); save(); render(); if (G.phase === 'gov') welcomePM(); },
  gev(d) {
    const r = resolveGovEvent(+d.i);
    if (r.err) return toast(r.err, 'bad');
    toast(r.msg, 'good');
    if (r.phaseChange) { UI.sel = null; UI.picks = []; window.scrollTo(0, 0); }
    render();
  },
  endq() {
    const before = overallApproval();
    const r = endQuarter();
    if (r.err) { toast(r.err.includes('Budget') ? '📒 Pick a budget first!' : r.err, 'bad'); return render(); }
    if (G.phase === 'gov') toast(quarterSummary(before));
    window.scrollTo(0, 0);
    render();
  },
  preset(d) { handle(budgetPreset(d.k)); },
  play(d) { handle(playCard(+d.i)); },
  pkg(d) {
    const a = G.gov.allies.find(x => x.key === d.k);
    openModal(`<h2>${esc(a.name)}</h2><p>Mood: ${face(a.sat)} ${Math.round(a.sat)}/100 · ${a.seats} MPs</p><p class="muted small">Unhappy allies quit — and you could lose your majority.</p>
      <div class="choices"><button class="choice" data-a="pkggo" data-k="${a.key}"><b>🎁 Send money to their state</b><small>1 ⭐ · makes them much happier</small></button><button class="choice" data-a="closemodal"><b>Not now</b></button></div>`);
  },
  pkggo(d) { handle(allyPackage(d.k)); },
  reelect() { goToElection(false); UI.sel = null; UI.picks = []; window.scrollTo(0, 0); render(); },
  menu() {
    openModal(`<h2>Menu</h2><div class="choices">
      <button class="choice" data-a="help"><b>📖 How to play</b></button>
      <button class="choice" data-a="news"><b>📰 All news</b></button>
      <button class="choice" data-a="quit"><b>🏠 Save & exit</b></button>
      <button class="choice" data-a="abandon"><b>🗑️ Start over</b><small>Deletes your save</small></button>
      <button class="choice" data-a="closemodal"><b>Close</b></button></div>`);
  },
  news() { openModal(`<h2>📰 News</h2>${G.log.slice(0, 30).map(l => `<div class="logline ${l.kind}"><span class="muted">${esc(l.t)}</span> ${esc(l.msg)}</div>`).join('')}<button class="btn primary" data-a="closemodal">Close</button>`); },
  quit() { save(); UI.screen = 'title'; G = null; render(); },
  abandon() { if (confirm('Delete this saved game?')) { clearSave(); UI.screen = 'title'; G = null; render(); } },
};

function welcomePM() {
  openModal(`<div class="center"><div class="ev-icon">🇮🇳</div><h2>Prime Minister ${esc(G.leader)}!</h2>
    <p>Each quarter: handle any crisis, play <b>one</b> policy card, then tap <b>Next Quarter</b>. Policies cost ⭐ power — you earn more by staying popular.</p>
    <p>First job: pick your Budget.</p><button class="btn primary" data-a="closemodal">Let's govern</button></div>`);
}

function readSetupInputs() {
  if (!$('#f-leader')) return;
  UI.setup.leader = $('#f-leader').value; UI.setup.party = $('#f-party').value;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  if ($('#popup')) { if (!el.closest('#popup')) return; closeModal(); }
  if (a !== 'endweek') UI.confirmSkip = false;
  ACTIONS[a] && ACTIONS[a](el.dataset);
});

render();
