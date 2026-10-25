// RAJNEETI — mobile interface. One full screen at a time; renders G into #app.

const UI = { screen: 'title', sel: null, reveal: null, setup: null, toastT: null, picks: [], card: 0, summary: null };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* not supported */ } };

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
  UI.toastT = setTimeout(() => { t.className = 'toast'; }, 2800);
}

function handle(res) {
  if (!res) return;
  if (res.err) { toast(res.err, 'bad'); buzz(40); }
  else if (res.msg) { toast(res.msg, res.fail ? 'bad' : 'good'); buzz(res.fail ? 40 : 15); }
  render();
}

function seatBar(you, A, others) {
  const w = x => (x / TOTAL_SEATS * 100).toFixed(2) + '%';
  return `<div class="seatbar">
    <div style="width:${w(you)};background:${G.color}"></div>
    <div style="width:${w(others)};background:#5b6378"></div>
    <div style="width:${w(A)};background:${RIVALS.A.color}"></div>
    <span class="majline"></span>
  </div>`;
}

// "Farmers, Youth" style summary of who likes / dislikes something
function whoLikes(blocs) {
  const up = [], down = [];
  for (const [b, v] of Object.entries(blocs)) (v > 0 ? up : down).push(BLOCS.find(x => x.id === b));
  return `${up.length ? `<div class="likes up">👍 ${up.map(b => b.icon + ' ' + b.name).join(', ')}</div>` : ''}${down.length ? `<div class="likes down">👎 ${down.map(b => b.icon + ' ' + b.name).join(', ')}</div>` : ''}`;
}
const face = v => v >= 62 ? '😀' : v >= 50 ? '🙂' : v >= 40 ? '😐' : v >= 28 ? '😠' : '🤬';

// ---------------- title & setup ----------------
function renderTitle() {
  return `<div class="screen title-screen">
    <div class="title-art">🏛️</div>
    <h1 class="logo">RAJNEETI</h1>
    <p class="tagline">Path to Power</p>
    <p class="intro">Win the election.<br>Become Prime Minister.<br>Stay in power.</p>
    <div class="title-buttons">
      ${hasSave() ? '<button class="btn primary big" data-a="continue">▶ Continue</button>' : ''}
      <button class="btn ${hasSave() ? '' : 'primary'} big" data-a="newgame">${hasSave() ? 'New Game' : '▶ Play'}</button>
      <button class="btn ghost" data-a="help">How to Play</button>
    </div>
  </div>`;
}

function renderSetup() {
  const s = UI.setup;
  return `<div class="screen scroll setup">
    <h2>Your party</h2>
    <label>Your name<input id="f-leader" maxlength="24" value="${esc(s.leader)}"></label>
    <label>Party name<input id="f-party" maxlength="30" value="${esc(s.party)}"></label>
    <div class="field"><span>Symbol</span><div class="chips">${PARTY_SYMBOLS.map(x => `<button class="chip ${s.symbol === x ? 'on' : ''}" data-a="set" data-k="symbol" data-v="${x}">${x}</button>`).join('')}</div></div>
    <div class="field"><span>Colour</span><div class="chips">${PARTY_COLORS.map(c => `<button class="swatch ${s.color === c ? 'on' : ''}" style="background:${c}" data-a="set" data-k="color" data-v="${c}" aria-label="colour"></button>`).join('')}</div></div>
    <div class="field"><span>You stand for</span><div class="stack">${Object.entries(IDEOLOGIES).map(([k, v]) => `<button class="pick ${s.ideology === k ? 'on' : ''}" data-a="set" data-k="ideology" data-v="${k}"><b>${v.name}</b><small>${v.desc}</small></button>`).join('')}</div></div>
    <div class="field"><span>Difficulty</span><div class="chips">${Object.entries(DIFFICULTY).map(([k, v]) => `<button class="chip wide ${s.difficulty === k ? 'on' : ''}" data-a="set" data-k="difficulty" data-v="${k}">${v.name}</button>`).join('')}</div></div>
    <button class="btn primary big full" data-a="start">Start Campaign →</button>
  </div>`;
}

function helpHTML() {
  return `<h2>How to play</h2>
  <div class="howto">
    <div><span>🗳️</span><p><b>Win the election.</b> 3 moves a week. Tap a state, then <b>Rally</b> or <b>Ally</b>. Get 272 seats.</p></div>
    <div><span>🤝</span><p><b>Allies win elections.</b> Local parties join whoever is winning — rally first, then ask.</p></div>
    <div><span>👉</span><p><b>Rule as PM.</b> Swipe policy cards: right to pass, left to skip.</p></div>
    <div><span>😀</span><p><b>Keep people happy</b> and keep your promises to win again.</p></div>
  </div>
  <button class="btn primary full" data-a="closemodal">Got it</button>`;
}

// ---------------- campaign ----------------
function hud(items) {
  return `<header class="hud">
    <span class="sym" style="background:${G.color}">${G.symbol}</span>
    ${items.map(([i, v]) => `<div class="pill"><span>${i}</span><b>${v}</b></div>`).join('')}
    <button class="iconbtn" data-a="menu" aria-label="Menu">☰</button>
  </header>`;
}

function renderCampaign() {
  const C = G.camp;
  const proj = projection(14);
  const last = C.polls[C.polls.length - 1];
  const sel = UI.sel ? stateById(UI.sel) : null;
  const overlay = !C.manifestoDone && !C.promises.length ? manifestoModal()
    : C.event ? eventModal(CAMPAIGN_EVENTS.find(e => e.id === C.event.id), C.event.ctx, 'cev') : '';
  return `<div class="screen">
  ${hud([['📅', `${C.week}/${C.weeks}`], ['💰', '₹' + Math.round(C.funds)], ['⚡', `<span class="dots">${'●'.repeat(C.ap)}${'○'.repeat(C.apMax - C.ap)}</span>`]])}
  <div class="poll">
    <div class="pollnums"><b style="color:${G.color}">${last.youBloc}</b><span>272 to win</span><b style="color:${RIVALS.A.color}">${last.aBloc}</b></div>
    ${seatBar(last.youBloc, last.aBloc, TOTAL_SEATS - last.youBloc - last.aBloc)}
  </div>
  <div class="mapwrap">${renderMap(proj, C.alliances)}</div>
  <div class="tray">
    ${sel ? stateTray(sel, proj) : nationalTray()}
    <button class="btn primary full ${C.ap ? '' : 'pulse'}" data-a="endweek">${C.week === C.weeks ? '🗳️ Election Day!' : C.ap ? `Next Week (${C.ap} move${C.ap > 1 ? 's' : ''} left)` : 'Next Week →'}</button>
  </div>
  ${overlay}
  </div>`;
}

function renderMap(proj, alliances) {
  return `<div class="map">${STATES.map(s => {
    const r = proj.byState[s.id];
    let best = 'you'; for (const k of PKEYS) if (r[k] > r[best]) best = k;
    const al = alliances[s.id];
    return `<button class="tile ${UI.sel === s.id ? 'sel' : ''}" style="grid-column:${s.pos[0] + 1};grid-row:${s.pos[1] + 1};--c:${partyColor(best, s.id, alliances)}" data-a="sel" data-s="${s.id}">
      <b>${s.id}</b><small>${s.seats}</small>${al === 'you' ? '<i class="star">🤝</i>' : ''}</button>`;
  }).join('')}</div>`;
}

function nationalTray() {
  return `<div class="trayhead"><b>🇮🇳 All of India</b><span class="muted">or tap a state ↑</span></div>
    <div class="moves">${['ads', 'fundraise', 'attack'].map(id => moveBtn(id)).join('')}</div>`;
}

function stateTray(s, proj) {
  const C = G.camp, r = proj.byState[s.id], al = C.alliances[s.id];
  const mine = Math.round(r.you + (al === 'you' ? r.R : 0)), theirs = Math.round(r.A + (al === 'A' ? r.R : 0));
  let allyBtn = '';
  if (s.reg && al !== 'you') {
    const blocked = actionBlocked('alliance', s.id, false);
    allyBtn = `<button class="move" data-a="camp" data-id="alliance" data-s="${s.id}" ${blocked ? 'disabled' : ''}>
      <span class="mi">🤝</span><b>Ally ${s.reg.short}</b><small>${blocked && blocked.includes('time') ? 'Not now' : Math.round(allianceChance(s.id, false) * 100) + '% chance'}</small></button>`;
  } else if (al === 'you') {
    allyBtn = `<div class="move done"><span class="mi">✅</span><b>${s.reg.short}</b><small>Your ally</small></div>`;
  }
  return `<div class="trayhead"><b>${s.name}</b><button class="x" data-a="sel" data-s="">✕</button></div>
    <div class="vs"><span style="color:${G.color}">You ${mine}</span><span class="muted">of ${s.seats} seats</span><span style="color:${RIVALS.A.color}">RSP ${theirs}</span></div>
    <div class="moves">${moveBtn('rally', s.id)}${allyBtn}</div>`;
}

const MOVE_TEXT = {
  rally: ['📣', 'Rally', () => '₹15 cr'],
  ads: ['📺', 'TV Ads', () => '₹40 cr'],
  fundraise: ['💰', 'Raise Money', () => '+₹50 cr'],
  attack: ['⚔️', 'Attack RSP', () => '₹10 cr · risky'],
};

function moveBtn(id, stateId) {
  const [icon, name, sub] = MOVE_TEXT[id];
  const blocked = actionBlocked(id, stateId);
  return `<button class="move" data-a="camp" data-id="${id}" ${stateId ? `data-s="${stateId}"` : ''} ${blocked ? 'disabled' : ''}>
    <span class="mi">${icon}</span><b>${name}</b><small>${sub()}</small></button>`;
}

function manifestoModal() {
  const n = UI.picks.length;
  return `<div class="modal-bg"><div class="modal tall">
    <h2>📜 Pick 3 promises</h2>
    <p class="muted small">They win votes now. As PM you must keep them!</p>
    <div class="pgrid">${PROMISES.map(p => {
      const on = UI.picks.includes(p.id);
      const fans = Object.entries(p.blocs).filter(([, v]) => v > 0).map(([b]) => BLOCS.find(x => x.id === b).icon).join('');
      return `<button class="pcard ${on ? 'on' : ''}" data-a="pickp" data-id="${p.id}" ${!on && n >= 3 ? 'disabled' : ''}><b>${p.name}</b><small>${fans}</small>${on ? '<i class="tick">✓</i>' : ''}</button>`;
    }).join('')}</div>
    <button class="btn primary full" data-a="manifesto" ${n === 3 ? '' : 'disabled'}>${n === 3 ? 'Announce! 📣' : `Pick ${3 - n} more`}</button>
  </div></div>`;
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
      UI.reveal.n++; buzz(5);
      render();
      if (UI.reveal.n < order.length) UI.reveal.timer = setTimeout(step, 200);
    };
    UI.reveal.timer = setTimeout(step, 500);
  }
  const shown = order.slice(0, UI.reveal.n);
  let you = 0, A = 0;
  for (const s of shown) {
    const x = r.byState[s.id], al = r.alliances[s.id];
    you += x.you; A += x.A;
    if (al === 'you') you += x.R; else if (al === 'A') A += x.R;
  }
  const done = UI.reveal.n >= order.length;
  const latest = shown[shown.length - 1];
  let verdict = '';
  if (done) {
    if (r.youBloc >= MAJORITY) verdict = `<div class="verdict good">🎉 YOU WON!</div>`;
    else if (r.aBloc >= MAJORITY) verdict = `<div class="verdict bad">😞 RSP wins</div>`;
    else verdict = `<div class="verdict">⚖️ No majority — make deals!</div>`;
  }
  let latestHTML = '';
  if (latest && !done) {
    const x = r.byState[latest.id], al = r.alliances[latest.id];
    latestHTML = `<div class="latest"><b>${latest.name}</b><span><i style="color:${G.color}">${x.you + (al === 'you' ? x.R : 0)}</i> – <i style="color:${RIVALS.A.color}">${x.A + (al === 'A' ? x.R : 0)}</i></span></div>`;
  }
  return `<div class="screen center-col results">
    <h1>🗳️ Counting Day</h1>
    <div class="bigcount"><div style="color:${G.color}"><b>${you}</b><small>You</small></div><div style="color:${RIVALS.A.color}"><b>${A}</b><small>RSP</small></div></div>
    ${seatBar(you, A, TOTAL_SEATS - you - A)}
    <p class="muted small">272 seats to win</p>
    ${latestHTML}${verdict}
    <div class="spacer"></div>
    ${done ? '<button class="btn primary big full" data-a="afterresults">Continue →</button>' : '<button class="btn ghost full" data-a="skipreveal">Skip ⏩</button>'}
  </div>`;
}

// ---------------- coalition ----------------
function renderCoalition() {
  const c = G.coal, t = coalTotals();
  return `<div class="screen">
    <div class="poll pad">
      <h2 class="center">🤝 Make a Deal</h2>
      <div class="pollnums"><b style="color:${G.color}">${t.you}</b><span>Round ${Math.min(c.round, c.rounds)}/${c.rounds} · need 272</span><b style="color:${RIVALS.A.color}">${t.A}</b></div>
      ${seatBar(t.you, t.A, TOTAL_SEATS - t.you - t.A)}
    </div>
    <div class="scroll grow pad">${c.kingmakers.map(k => {
      const side = k.side === 'you' ? '<span class="tag good">With you ✓</span>' : k.side === 'A' ? '<span class="tag bad">With RSP</span>' : k.tried ? '<span class="tag">Said no</span>' : face(k.aff * 100);
      const dis = k.side || k.tried ? 'disabled' : '';
      return `<div class="km"><div class="kmh"><b>${esc(k.short)}</b><span>${k.seats} seats</span>${side}</div>
        ${k.side ? '' : `<div class="moves three">
          <button class="move sm" data-a="offer" data-k="${k.key}" data-o="ask" ${dis}><span class="mi">🙏</span><b>Ask</b></button>
          <button class="move sm" data-a="offer" data-k="${k.key}" data-o="berth" ${dis || (c.berths ? '' : 'disabled')}><span class="mi">🏛️</span><b>Minister</b></button>
          <button class="move sm" data-a="offer" data-k="${k.key}" data-o="package" ${dis}><span class="mi">🎁</span><b>Money</b></button>
        </div>`}</div>`;
    }).join('')}</div>
    <div class="tray"><button class="btn primary full" data-a="coalround">Next Round →</button></div>
  </div>`;
}

// ---------------- governance ----------------
function stat(icon, good, label) {
  const g = clamp(good, 0, 1);
  const col = g >= .6 ? 'var(--good)' : g >= .35 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="gauge" title="${label}"><span>${icon}</span><div class="gfill"><i style="height:${Math.max(8, g * 100)}%;background:${col}"></i></div><small>${label}</small></div>`;
}

function govGauges() {
  const e = G.eco, appr = overallApproval();
  return `<div class="gauges" data-a="stats">
    ${stat('👍', (appr - 25) / 45, 'Popularity')}
    ${stat('📈', (e.growth - 2) / 7, 'Economy')}
    ${stat('🛒', 1 - (e.infl - 3.5) / 6, 'Prices')}
    ${stat('👷', 1 - (e.unemp - 4.5) / 6, 'Jobs')}
    ${stat('🏦', 1 - (e.deficit - 3.5) / 4.5, 'Treasury')}
  </div>
  <div class="faces">${BLOCS.map(b => `<span>${b.icon}${face(G.gov.approval[b.id])}</span>`).join('')}</div>`;
}

function renderGov() {
  const g = G.gov;
  if (!g.hand) dealHand();
  const ev = g.events[0];
  const budgetDue = isBudgetQuarter() && g.lastBudgetQ !== g.q;
  let stage;
  if (UI.summary) stage = summaryCard();
  else if (ev) stage = crisisCard(GOV_EVENTS.find(x => x.id === ev.id), ev.ctx);
  else if (budgetDue) stage = budgetCard();
  else if (!g.played && UI.card < g.hand.length) stage = proposalCard(g.hand[UI.card], UI.card);
  else stage = `<div class="card-stage"><div class="gcard"><div class="ev-icon">✅</div><h2>Quarter done</h2><p class="muted">Time moves on…</p></div></div>
    <div class="tray"><button class="btn primary full" data-a="endq">Next Quarter →</button></div>`;
  return `<div class="screen">
    ${hud([['📅', quarterLabel(G.calQ)], ['⭐', g.pc], ['🏛️', govSeats()]])}
    ${govGauges()}
    <div class="subhud"><span>Year ${Math.floor(g.q / 4) + 1}/5</span>${g.allies.length ? `<button class="linkish" data-a="allies">🤝 Allies ${g.allies.map(a => face(a.sat)).join('')}</button>` : ''}${g.minority ? '<span class="down">⚠️ No majority</span>' : ''}</div>
    ${stage}
  </div>`;
}

function crisisCard(ev, ctx) {
  const choices = ev.choices(G, ctx);
  return `<div class="card-stage"><div class="gcard crisis">
      <div class="kicker">⚠️ Crisis</div>
      <div class="ev-icon">${ev.icon}</div><h2>${ev.title}</h2><p>${esc(ev.text(G, ctx))}</p>
    </div></div>
    <div class="tray"><div class="choices">${choices.map((c, i) => `<button class="choice" data-a="gev" data-i="${i}"><b>${c.label}</b><small>${[c.pc ? c.pc + ' ⭐' : '', c.hint || ''].filter(Boolean).join(' · ')}</small></button>`).join('')}</div></div>`;
}

function budgetCard() {
  return `<div class="card-stage"><div class="gcard">
      <div class="kicker">📒 Budget Day</div><h2>How will you spend this year?</h2>
      <div class="budgetgrid">${Object.entries(BUDGET_PRESETS).map(([k, p]) => `<button class="bcard" data-a="preset" data-k="${k}"><span>${p.icon}</span><b>${p.name}</b><small>${p.desc}</small></button>`).join('')}</div>
    </div></div>`;
}

function proposalCard(c, i) {
  const g = G.gov;
  let icon, title, desc, extra = '', cost, can;
  if (c.type === 'pm') {
    const a = PM_ACTIONS[c.id];
    icon = a.icon; title = a.name; desc = a.desc; cost = `${a.pc} ⭐`; can = g.pc >= a.pc && !g[a.once];
  } else {
    const r = REFORMS.find(x => x.id === c.id), st = billStatus(r.id);
    const promised = g.promises.some(id => PROMISES.find(p => p.id === id).check.toString().includes(`'${r.id}'`));
    icon = '📜'; title = r.name; desc = r.desc; cost = `${r.pc} ⭐ · ${Math.round(billChance(r.id) * 100)}% pass`; can = g.pc >= r.pc;
    extra = `${promised ? '<div class="ribbon">📜 You promised this!</div>' : ''}${whoLikes(r.blocs)}${st.objectors.length ? `<div class="likes warn">⚠️ Angers ally ${st.objectors.map(a => a.short).join(', ')}</div>` : ''}`;
  }
  return `<div class="card-stage">
      <div class="gcard swipe" data-i="${i}" data-can="${can ? 1 : 0}">
        <div class="stamp yes">PASS ✓</div><div class="stamp no">SKIP ✕</div>
        <div class="kicker">Idea ${i + 1} of ${g.hand.length}</div>
        <div class="ev-icon">${icon}</div><h2>${title}</h2><p>${desc}</p>${extra}
        <div class="cost ${can ? '' : 'down'}">${can ? cost : 'Not enough ⭐ power'}</div>
      </div>
    </div>
    <div class="tray"><div class="moves two">
      <button class="move" data-a="skipcard"><span class="mi">👈</span><b>Skip</b></button>
      <button class="move yesbtn" data-a="playcard" ${can ? '' : 'disabled'}><span class="mi">👉</span><b>Do it!</b></button>
    </div><p class="hint">Swipe the card or tap a button</p></div>`;
}

function summaryCard() {
  const s = UI.summary, e = G.eco, appr = overallApproval();
  const row = (icon, name, now, before, unit, goodUp) => {
    const d = now - before, good = goodUp ? d >= 0 : d <= 0;
    return `<div class="srow"><span>${icon} ${name}</span><b>${now.toFixed(1)}${unit}</b><em class="${Math.abs(d) < .05 ? 'muted' : good ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}</em></div>`;
  };
  return `<div class="card-stage"><div class="gcard">
      <div class="kicker">📰 ${s.label}</div><h2>How did it go?</h2>
      ${row('👍', 'Popularity', appr, s.appr, '%', true)}
      ${row('📈', 'Growth', e.growth, s.growth, '%', true)}
      ${row('🛒', 'Prices', e.infl, s.infl, '%', false)}
      ${row('👷', 'Jobless', e.unemp, s.unemp, '%', false)}
      ${row('🏦', 'Deficit', e.deficit, s.deficit, '%', false)}
      <div class="headline">${esc(G.log[0] ? G.log[0].msg : '')}</div>
    </div></div>
    <div class="tray"><button class="btn primary full" data-a="nextq">Continue →</button></div>`;
}

// ---------------- term report & game over ----------------
function renderReport() {
  const r = G.report;
  return `<div class="screen center-col">
    <h1>📋 Your 5 Years</h1>
    <div class="statgrid">
      <div><small>Growth</small><b>${r.growth}%</b></div><div><small>Prices</small><b>${r.infl}%</b></div>
      <div><small>Jobless</small><b>${r.unemp}%</b></div><div><small>Popularity</small><b>${r.approval}%</b></div>
    </div>
    <div class="gcard left"><b>✅ Kept: ${r.kept.length}</b><p>${r.kept.map(esc).join(', ') || '—'}</p>
    <b>❌ Broken: ${r.broken.length}</b><p class="down">${r.broken.map(esc).join(', ') || '—'}</p></div>
    <div class="spacer"></div>
    <button class="btn primary big full" data-a="reelect">Fight the Election →</button>
  </div>`;
}

function renderGameOver() {
  const L = legacyScore();
  const lostFirst = G.quartersAsPM === 0;
  return `<div class="screen center-col">
    <h1>${lostFirst ? '💔 Defeat' : '🏁 Game Over'}</h1>
    <p>${lostFirst ? 'The RSP stays in power. Try again!' : `${esc(G.leader)} ruled for ${L.yrs} years.`}</p>
    <div class="legacy"><small>Your legacy</small><b>${L.title}</b><span>⭐ ${L.score} points</span></div>
    <div class="statgrid">
      <div><small>Years as PM</small><b>${L.yrs}</b></div><div><small>Elections won</small><b>${G.termsWon}</b></div>
      <div><small>Laws passed</small><b>${G.gov ? G.gov.passed.length : 0}</b></div><div><small>Promises kept</small><b>${G.promisesKept}</b></div>
    </div>
    <div class="spacer"></div>
    <button class="btn primary big full" data-a="newgame">Play Again</button>
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

// Drag a proposal card: right = do it, left = skip.
function bindSwipe() {
  const card = $('.swipe');
  if (!card) return;
  let x0 = null, dx = 0;
  const can = card.dataset.can === '1';
  card.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', e => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    if (!can && dx > 0) dx = Math.min(dx, 40);
    card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    card.querySelector('.yes').style.opacity = clamp(dx / 90, 0, 1);
    card.querySelector('.no').style.opacity = clamp(-dx / 90, 0, 1);
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    card.style.transition = 'transform .25s';
    if (dx > 90 && can) flyOut(card, 1, () => ACTIONS.playcard());
    else if (dx < -90) flyOut(card, -1, () => ACTIONS.skipcard());
    else { card.style.transform = ''; card.querySelectorAll('.stamp').forEach(s => { s.style.opacity = 0; }); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function flyOut(card, dir, then) {
  buzz(15);
  card.style.transform = `translateX(${dir * 500}px) rotate(${dir * 30}deg)`;
  setTimeout(then, 200);
}

function snapshot() {
  const e = G.eco;
  return { label: quarterLabel(G.calQ), appr: overallApproval(), growth: e.growth, infl: e.infl, unemp: e.unemp, deficit: e.deficit };
}

function finishQuarter() {
  const before = snapshot();
  const r = endQuarter();
  if (r.err) { toast(r.err, 'bad'); return render(); }
  UI.card = 0;
  if (G.phase === 'gov') UI.summary = before;
  render();
}

const ACTIONS = {
  continue() { if (load()) { UI.screen = 'game'; UI.card = 0; UI.summary = null; render(); } },
  newgame() {
    UI.setup = { leader: 'Asha Verma', party: 'Jan Shakti Party', symbol: PARTY_SYMBOLS[0], color: PARTY_COLORS[0], ideology: 'centrist', difficulty: 'normal' };
    UI.screen = 'setup'; G = null; render();
  },
  help() { openModal(helpHTML()); },
  closemodal() { closeModal(); },
  set(d) { readSetupInputs(); UI.setup[d.k] = d.v; render(); },
  start() {
    readSetupInputs();
    const s = UI.setup;
    if (!s.leader.trim() || !s.party.trim()) return toast('Enter your name and party name', 'bad');
    s.short = s.party.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
    newGame(s); UI.screen = 'game'; UI.sel = null; UI.reveal = null; UI.picks = []; UI.card = 0; UI.summary = null;
    render();
    let seen = false; try { seen = !!localStorage.getItem('rajneeti.seenHelp'); localStorage.setItem('rajneeti.seenHelp', '1'); } catch (e) { /* ignore */ }
    if (!seen) openModal(helpHTML());
  },
  sel(d) { buzz(8); UI.sel = d.s || null; render(); },
  pickp(d) { buzz(8); const i = UI.picks.indexOf(d.id); if (i >= 0) UI.picks.splice(i, 1); else if (UI.picks.length < 3) UI.picks.push(d.id); render(); },
  manifesto() { choosePromises(UI.picks); UI.picks = []; toast('📣 Manifesto announced!', 'good'); render(); },
  camp(d) { handle(campaignAction(d.id, d.s, false)); },
  endweek() {
    const C = G.camp;
    if (C.ap === 3 && !UI.confirmSkip) { UI.confirmSkip = true; return toast('You have 3 moves left! Tap again to skip.', 'bad'); }
    UI.confirmSkip = false;
    const r = endWeek();
    if (r.err) return toast(r.err, 'bad');
    if (!r.election) { const p = G.camp.polls, d = p[p.length - 1].youBloc - p[p.length - 2].youBloc; toast(`📊 New poll: ${d >= 0 ? '+' : ''}${d} seats`, d >= 0 ? 'good' : 'bad'); }
    else UI.reveal = null;
    buzz(20);
    render();
  },
  cev(d) { handle(resolveCampaignEvent(+d.i)); },
  skipreveal() { clearTimeout(UI.reveal.timer); UI.reveal.n = 999; render(); },
  afterresults() {
    UI.reveal = null; afterResults(); save(); UI.card = 0; UI.summary = null; render();
    if (G.phase === 'gov') welcomePM();
  },
  offer(d) { handle(coalOffer(d.k, d.o)); save(); },
  coalround() { coalEndRound(); save(); UI.card = 0; render(); if (G.phase === 'gov') welcomePM(); },
  gev(d) {
    const r = resolveGovEvent(+d.i);
    if (r.err) { toast(r.err, 'bad'); return; }
    toast(r.msg, 'good'); buzz(15);
    if (r.phaseChange) { UI.sel = null; UI.picks = []; UI.summary = null; }
    render();
  },
  preset(d) { handle(budgetPreset(d.k)); },
  playcard() {
    const r = playCard(UI.card);
    if (r.err) { toast(r.err, 'bad'); return render(); }
    toast(r.msg, r.fail ? 'bad' : 'good');
    if (G.gov.events.length) return render(); // a protest may follow a bill
    finishQuarter();
  },
  skipcard() {
    UI.card++;
    if (UI.card >= G.gov.hand.length) finishQuarter(); else render();
  },
  endq() { finishQuarter(); },
  nextq() { UI.summary = null; render(); },
  stats() {
    const e = G.eco, a = overallApproval();
    openModal(`<h2>🇮🇳 The Nation</h2>
      <div class="srow"><span>👍 Popularity</span><b>${Math.round(a)}%</b></div>
      <div class="srow"><span>📈 Growth</span><b>${e.growth.toFixed(1)}%</b></div>
      <div class="srow"><span>🛒 Inflation</span><b>${e.infl.toFixed(1)}%</b></div>
      <div class="srow"><span>👷 Unemployment</span><b>${e.unemp.toFixed(1)}%</b></div>
      <div class="srow"><span>🏦 Deficit</span><b>${e.deficit.toFixed(1)}% · ${RATINGS[e.rating]}</b></div>
      <h3>People</h3>${BLOCS.map(b => `<div class="srow"><span>${b.icon} ${b.name}</span><b>${face(G.gov.approval[b.id])} ${Math.round(G.gov.approval[b.id])}%</b></div>`).join('')}
      ${G.gov.promises.length ? `<h3>Promises</h3>${G.gov.promises.map(id => { const p = PROMISES.find(x => x.id === id); return `<div class="srow"><span>${p.check(G) ? '✅' : '⏳'} ${p.keep}</span></div>`; }).join('')}` : ''}
      <button class="btn primary full" data-a="closemodal">Close</button>`);
  },
  allies() {
    const g = G.gov;
    openModal(`<h2>🤝 Allies</h2><p class="muted small">Unhappy allies quit. Send money (1 ⭐) to cheer them up.</p>
      ${g.allies.map(a => `<div class="srow"><span>${face(a.sat)} <b>${esc(a.short)}</b> · ${a.seats} MPs</span><button class="btn small" data-a="pkggo" data-k="${a.key}" ${g.pc < 1 ? 'disabled' : ''}>🎁 Money</button></div>`).join('')}
      <button class="btn primary full" data-a="closemodal">Close</button>`);
  },
  pkggo(d) { handle(allyPackage(d.k)); },
  reelect() { goToElection(false); UI.sel = null; UI.picks = []; render(); },
  menu() {
    openModal(`<h2>Menu</h2><div class="choices">
      <button class="choice" data-a="help"><b>📖 How to play</b></button>
      <button class="choice" data-a="news"><b>📰 News</b></button>
      <button class="choice" data-a="quit"><b>🏠 Save & exit</b></button>
      <button class="choice" data-a="abandon"><b>🗑️ Start over</b></button>
      <button class="choice" data-a="closemodal"><b>Close</b></button></div>`);
  },
  news() { openModal(`<h2>📰 News</h2>${G.log.slice(0, 25).map(l => `<div class="logline ${l.kind}">${esc(l.msg)}</div>`).join('')}<button class="btn primary full" data-a="closemodal">Close</button>`); },
  quit() { save(); UI.screen = 'title'; G = null; render(); },
  abandon() { if (confirm('Delete this saved game?')) { clearSave(); UI.screen = 'title'; G = null; render(); } },
};

function welcomePM() {
  openModal(`<div class="center"><div class="ev-icon">🇮🇳</div><h2>Prime Minister ${esc(G.leader)}!</h2>
    <p>Each quarter, your cabinet brings ideas. <b>Swipe right</b> to do one, <b>left</b> to skip.</p>
    <p>Ideas cost ⭐ power. Stay popular to earn more.</p><button class="btn primary full" data-a="closemodal">Let's go!</button></div>`);
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
