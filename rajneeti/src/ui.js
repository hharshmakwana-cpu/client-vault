// RAJNEETI — interface. Renders G into #app and routes clicks to the engine.

const UI = { screen: 'title', sel: null, tab: 'dash', draft: null, reveal: null, setup: null, toastT: null };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (x >= 0 ? '' : '') + x.toFixed(d) + '%';
const signed = x => (x > 0 ? '+' : '') + Math.round(x);

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
  UI.toastT = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function handle(res) {
  if (!res) return;
  if (res.err) toast(res.err, 'bad');
  else if (res.msg) toast(res.msg, res.fail ? 'bad' : 'good');
  render();
}

function spark(arr, color = 'var(--accent)', w = 110, h = 28) {
  if (!arr || arr.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const lo = Math.min(...arr), hi = Math.max(...arr), r = hi - lo || 1;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 3 - (v - lo) / r * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function seatBar(you, A, others, labels = true) {
  const w = x => (x / TOTAL_SEATS * 100).toFixed(2) + '%';
  return `<div class="seatbar">
    <div style="width:${w(you)};background:${G.color}"></div>
    <div style="width:${w(others)};background:#6b7280"></div>
    <div style="width:${w(A)};background:${RIVALS.A.color}"></div>
    <span class="majline" title="272 for majority"></span>
  </div>${labels ? `<div class="seatlabels"><span style="color:${G.color}">${esc(G.short)}+ ${you}</span><span class="muted">Majority 272</span><span style="color:${RIVALS.A.color}">${RIVALS.A.short}+ ${A}</span></div>` : ''}`;
}

// ---------------- title & setup ----------------
function renderTitle() {
  return `<div class="title-screen">
    <div class="title-art">🏛️</div>
    <h1 class="logo">RAJNEETI</h1>
    <p class="tagline">Path to Power</p>
    <p class="intro">Lead your party from the opposition benches to the Prime Minister's office. Win the Lok Sabha, build coalitions, run the economy, survive crises — and do it all again in five years.</p>
    <div class="title-buttons">
      ${hasSave() ? '<button class="btn primary big" data-a="continue">▶ Continue</button>' : ''}
      <button class="btn ${hasSave() ? '' : 'primary'} big" data-a="newgame">New Game</button>
      <button class="btn ghost" data-a="help">How to Play</button>
    </div>
    <p class="fine">Works fully offline · Your progress is saved on this device</p>
  </div>`;
}

function renderSetup() {
  const s = UI.setup;
  return `<div class="setup">
    <h2>Found your party</h2>
    <label>Your name<input id="f-leader" maxlength="28" value="${esc(s.leader)}"></label>
    <label>Party name<input id="f-party" maxlength="36" value="${esc(s.party)}"></label>
    <label>Short name<input id="f-short" maxlength="5" value="${esc(s.short)}"></label>
    <div class="field"><span>Party symbol</span><div class="chips">${PARTY_SYMBOLS.map(x => `<button class="chip ${s.symbol === x ? 'on' : ''}" data-a="set" data-k="symbol" data-v="${x}">${x}</button>`).join('')}</div></div>
    <div class="field"><span>Party colour</span><div class="chips">${PARTY_COLORS.map(c => `<button class="swatch ${s.color === c ? 'on' : ''}" style="background:${c}" data-a="set" data-k="color" data-v="${c}" aria-label="colour"></button>`).join('')}</div></div>
    <div class="field"><span>Ideology</span><div class="cards3">${Object.entries(IDEOLOGIES).map(([k, v]) => `<button class="pick ${s.ideology === k ? 'on' : ''}" data-a="set" data-k="ideology" data-v="${k}"><b>${v.name}</b><small>${v.desc}</small></button>`).join('')}</div></div>
    <div class="field"><span>Difficulty</span><div class="chips">${Object.entries(DIFFICULTY).map(([k, v]) => `<button class="chip wide ${s.difficulty === k ? 'on' : ''}" data-a="set" data-k="difficulty" data-v="${k}">${v.name}</button>`).join('')}</div></div>
    <div class="row gap"><button class="btn ghost" data-a="title">Back</button><button class="btn primary big" data-a="start">Begin Campaign →</button></div>
  </div>`;
}

function helpHTML() {
  return `<h2>How to play</h2>
  <h3>1 · The Campaign</h3>
  <p>You lead the main opposition party against the ruling <b style="color:${RIVALS.A.color}">RSP</b>. Each week you get <b>3 action points</b>. Tap a state on the map to rally or canvass there, or to court its regional party. National actions (ads, social media, fundraising) are below the map. Big states matter most — Uttar Pradesh alone has 80 seats.</p>
  <p><b>Alliances</b> are the key to power: allied parties pool votes with you and their MPs count toward your 272. Regional parties join whoever looks like winning, so build momentum first.</p>
  <p><b>Manifesto promises</b> win votes, but if you become PM you must deliver them — broken promises cost trust at the next election.</p>
  <h3>2 · Election & Coalition</h3>
  <p>Every one of the 543 seats is first-past-the-post. Fall short of 272 and you can bargain with kingmakers using cabinet berths, state packages or the Deputy PM post.</p>
  <h3>3 · Governing</h3>
  <p>Each turn is a quarter. You set taxes and spending in the <b>Budget</b> (once a year), pass <b>Bills</b> with Political Capital, and handle crises. Money bills skip the Rajya Sabha; other bills need it — or some clever floor management.</p>
  <p>Watch inflation (everyone hates it), unemployment (youth and workers), and the deficit (rating agencies are watching). The RBI sets interest rates on its own — you can lean on it, at a price.</p>
  <p>Keep allies happy or they will walk out, and a no-confidence motion may follow.</p>
  <h3>4 · Re-election</h3>
  <p>After 5 years your approval in each state becomes your starting position. Win again to extend your legacy.</p>
  <button class="btn primary" data-a="closemodal">Got it</button>`;
}

// ---------------- campaign ----------------
function renderCampaign() {
  const C = G.camp;
  const proj = projection(16);
  UI.proj = proj;
  const last = C.polls[C.polls.length - 1];
  const sel = UI.sel ? stateById(UI.sel) : null;
  return `${topbar([
    ['📅', `Week ${C.week}/${C.weeks}`],
    ['💰', fmtCr(C.funds)],
    ['⚡', `<span class="dots">${'●'.repeat(C.ap)}${'○'.repeat(C.apMax - C.ap)}</span>`, 'Action points'],
    ['🧑‍🤝‍🧑', C.cadre, 'Cadre'],
    ['🤝', Math.round(G.trust), 'Trust'],
    ['🔥', (C.momentum >= 0 ? '+' : '') + C.momentum.toFixed(1), 'Momentum'],
  ])}
  <div class="layout">
    <section class="col-main">
      <div class="card">
        <div class="card-h"><b>Opinion poll</b><span class="muted small">Projected seats with allies</span></div>
        ${seatBar(last.youBloc, last.aBloc, TOTAL_SEATS - last.youBloc - last.aBloc)}
        <div class="polltrend">
          ${trendChart(C.polls)}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><b>Battleground map</b><span class="muted small">Tap a state</span></div>
        ${renderMap(proj, C.alliances)}
        <div class="legend">
          <span><i style="background:${G.color}"></i>${esc(G.short)}</span><span><i style="background:${mix(G.color)}"></i>Your allies</span>
          <span><i style="background:${RIVALS.A.color}"></i>RSP</span><span><i style="background:${mix(RIVALS.A.color)}"></i>RSP allies</span>
          <span><i style="background:${RIVALS.B.color}"></i>NBM</span><span><i style="background:#8b8f9a"></i>Others</span>
        </div>
      </div>
      ${sel ? renderStatePanel(sel, proj) : ''}
      <div class="card">
        <div class="card-h"><b>National campaign</b></div>
        <div class="actions">${['ads', 'social', 'membership', 'fundraise', 'attack', 'press'].map(id => actionBtn(id)).join('')}</div>
      </div>
    </section>
    <aside class="col-side">
      ${renderManifesto()}
      ${renderAllianceList()}
      ${renderLog()}
    </aside>
  </div>
  <div class="bottombar"><span class="muted small">${C.weeks - C.week === 0 ? 'Election day is next!' : `${C.weeks - C.week + 1} weeks to polling day`}</span><button class="btn primary" data-a="endweek">${C.week === C.weeks ? 'Go to the Polls 🗳️' : 'End Week →'}</button></div>
  ${C.event ? eventModal(CAMPAIGN_EVENTS.find(e => e.id === C.event.id), C.event.ctx, 'cev') : ''}`;
}

function trendChart(polls) {
  const w = 300, h = 70, n = Math.max(polls.length, 2);
  const x = i => (i / (Math.max(G.camp.weeks, n - 1))) * (w - 10) + 5;
  const y = v => h - 5 - (v / 400) * (h - 10);
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

function renderStatePanel(s, proj) {
  const C = G.camp, sh = stateShares(s), r = proj.byState[s.id], al = C.alliances[s.id];
  const names = [G.short, RIVALS.A.short, RIVALS.B.short, s.reg ? s.reg.short : 'Others'];
  const cols = [G.color, RIVALS.A.color, RIVALS.B.color, s.reg ? partyColor('R', s.id, C.alliances) : '#8b8f9a'];
  const bars = sh.map((v, i) => `<div class="vbar"><span>${esc(names[i])}</span><div><i style="width:${(v * 100).toFixed(1)}%;background:${cols[i]}"></i></div><b>${(v * 100).toFixed(0)}%</b><em>${Math.round(r[PKEYS[i]])} seats</em></div>`).join('');
  let regional = '';
  if (s.reg) {
    const status = al === 'you' ? `<span class="tag good">Your ally${C.generous[s.id] ? ' (generous deal)' : ''}</span>` : al === 'A' ? `<span class="tag bad">Allied with RSP</span>` : `<span class="tag">Unaligned</span>`;
    const cd = (C.cooldown[s.id] || 0) > C.week;
    regional = `<div class="regional"><div><b>${esc(s.reg.name)}</b> ${status}</div>
      <div class="muted small">Leans toward you: ${Math.round(C.affinity[s.id] * 100)}% · Opposes: ${s.reg.dislikes.join(', ')}</div>
      ${al !== 'you' ? `<div class="actions">
        <button class="act" data-a="camp" data-id="alliance" data-s="${s.id}" ${cd ? 'disabled' : ''}><span>🤝 Propose alliance</span><small>1 AP · ~${Math.round(allianceChance(s.id, false) * 100)}% chance</small></button>
        <button class="act" data-a="camp" data-id="alliance" data-s="${s.id}" data-opt="1" ${cd ? 'disabled' : ''}><span>🎁 Generous seat-share</span><small>1 AP · ₹25 cr · ~${Math.round(allianceChance(s.id, true) * 100)}% chance</small></button>
      </div>${cd ? '<div class="muted small">Talks on hold for now.</div>' : ''}` : ''}</div>`;
  }
  return `<div class="card statepanel">
    <div class="card-h"><b>${s.name}</b><span class="muted">${s.seats} seats · ${Math.round(s.urban * 100)}% urban</span><button class="x" data-a="sel" data-s="">✕</button></div>
    ${bars}
    <div class="muted small">Your ground game here: ${C.ground[s.id].toFixed(1)} · RSP: ${C.groundA[s.id].toFixed(1)}</div>
    <div class="actions">${actionBtn('rally', s.id)}${actionBtn('cadre', s.id)}</div>
    ${regional}
  </div>`;
}

function actionBtn(id, stateId) {
  const a = CAMPAIGN_ACTIONS[id];
  const blocked = actionBlocked(id, stateId);
  return `<button class="act" data-a="camp" data-id="${id}" ${stateId ? `data-s="${stateId}"` : ''} ${blocked ? `disabled title="${esc(blocked)}"` : ''}>
    <span>${a.icon} ${a.name}</span><small>1 AP${a.cost ? ' · ' + fmtCr(a.cost) : ''}</small><em>${a.desc}</em></button>`;
}

function renderManifesto() {
  const C = G.camp;
  return `<div class="card">
    <div class="card-h"><b>📜 Manifesto</b><span class="muted small">${C.promises.length}/5 · 1 AP each</span></div>
    <div class="promises">${PROMISES.map(p => {
      const on = C.promises.includes(p.id);
      const eff = Object.entries(p.blocs).map(([b, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${BLOCS.find(x => x.id === b).icon}${v > 0 ? '+' : ''}${v}</span>`).join(' ');
      return `<button class="promise ${on ? 'on' : ''}" data-a="promise" data-id="${p.id}" ${on || C.promises.length >= 5 ? 'disabled' : ''}>
        <b>${on ? '✅ ' : ''}${p.name}</b><span class="eff">${eff}</span><small>If elected: ${p.keep}</small></button>`;
    }).join('')}</div>
  </div>`;
}

function renderAllianceList() {
  const C = G.camp;
  const mine = STATES.filter(s => C.alliances[s.id] === 'you'), theirs = STATES.filter(s => C.alliances[s.id] === 'A');
  const li = arr => arr.map(s => `<button class="linkish" data-a="sel" data-s="${s.id}">${s.reg.short} <span class="muted">(${s.name})</span></button>`).join('') || '<span class="muted small">None yet</span>';
  return `<div class="card"><div class="card-h"><b>Alliances</b></div>
    <div class="small"><b style="color:${G.color}">Yours:</b> ${li(mine)}</div>
    <div class="small" style="margin-top:6px"><b style="color:${RIVALS.A.color}">RSP's:</b> ${li(theirs)}</div></div>`;
}

function renderLog() {
  return `<div class="card log"><div class="card-h"><b>📰 News</b></div>
    ${G.log.slice(0, 14).map(l => `<div class="logline ${l.kind}"><span class="muted">${esc(l.t)}</span> ${esc(l.msg)}</div>`).join('')}</div>`;
}

function topbar(items) {
  return `<header class="topbar">
    <div class="brand"><span class="sym" style="background:${G.color}">${G.symbol}</span><div><b>${esc(G.party)}</b><small>${esc(G.leader)}</small></div></div>
    <div class="stats">${items.map(([i, v, t]) => `<div class="stat" ${t ? `title="${t}"` : ''}><span>${i}</span><b>${v}</b>${t ? `<small>${t}</small>` : ''}</div>`).join('')}</div>
    <button class="iconbtn" data-a="menu" aria-label="Menu">☰</button>
  </header>`;
}

function eventModal(ev, ctx, kind) {
  const choices = ev.choices(G, ctx);
  return `<div class="modal-bg"><div class="modal event">
    <div class="ev-icon">${ev.icon}</div>
    <h2>${ev.title}</h2>
    <p>${esc(ev.text(G, ctx))}</p>
    <div class="choices">${choices.map((c, i) => `<button class="choice" data-a="${kind}" data-i="${i}"><b>${c.label}</b><small>${[c.cost ? fmtCr(c.cost) : '', c.pc ? c.pc + ' PC' : '', c.hint || ''].filter(Boolean).join(' · ')}</small></button>`).join('')}</div>
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
      if (UI.reveal.n < order.length) UI.reveal.timer = setTimeout(step, 260);
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
    if (r.youBloc >= MAJORITY) verdict = `<div class="verdict good">🎉 A clear mandate! Your alliance has won ${r.youBloc} seats.</div>`;
    else if (r.aBloc >= MAJORITY) verdict = `<div class="verdict bad">The RSP alliance returns to power with ${r.aBloc} seats.</div>`;
    else verdict = `<div class="verdict">⚖️ Hung Parliament! Nobody has 272. Time to bargain.</div>`;
  }
  return `<div class="results">
    <h1>🗳️ Counting Day</h1>
    <div class="bigcount"><div style="color:${G.color}"><b>${you}</b><small>${esc(G.short)} alliance</small></div><div class="muted"><b>${oth}</b><small>Others</small></div><div style="color:${RIVALS.A.color}"><b>${A}</b><small>RSP alliance</small></div></div>
    ${seatBar(you, A, oth, false)}
    <div class="results-grid">${shown.slice().reverse().map((s, i) => {
      const x = r.byState[s.id];
      return `<div class="rstate ${i === 0 && !done ? 'new' : ''}"><b>${s.name}</b><span><i style="color:${G.color}">${x.you}</i> · <i style="color:${partyColor('R', s.id, r.alliances)}">${s.reg ? s.reg.short : 'Oth'} ${x.R}</i> · <i style="color:${RIVALS.B.color}">${x.B}</i> · <i style="color:${RIVALS.A.color}">${x.A}</i></span></div>`;
    }).join('')}</div>
    ${verdict}
    <div class="row gap center">${done ? '<button class="btn primary big" data-a="afterresults">Continue →</button>' : '<button class="btn ghost" data-a="skipreveal">Skip ⏩</button>'}</div>
  </div>`;
}

// ---------------- coalition ----------------
function renderCoalition() {
  const c = G.coal, t = coalTotals();
  return `<div class="coalition">
    <h1>⚖️ Hung Parliament</h1>
    <p class="muted">Round ${Math.min(c.round, c.rounds)} of ${c.rounds}. Win over kingmakers before the RSP does. You can approach each party once per round.</p>
    ${seatBar(t.you, t.A, TOTAL_SEATS - t.you - t.A)}
    <div class="kingmakers">${c.kingmakers.map(k => {
      const side = k.side === 'you' ? '<span class="tag good">With you</span>' : k.side === 'A' ? '<span class="tag bad">With RSP</span>' : '';
      const dis = k.side || k.tried ? 'disabled' : '';
      return `<div class="card km"><div class="card-h"><b>${esc(k.name)}</b><span class="seats">${k.seats} MPs</span></div>
        <div class="muted small">Inclination toward you: ${Math.round(k.aff * 100)}% ${side} ${k.tried && !k.side ? '<span class="tag">Refused this round</span>' : ''}</div>
        ${k.side ? '' : `<div class="actions">
          <button class="act" data-a="offer" data-k="${k.key}" data-o="ask" ${dis}><span>🙏 Ask for support</span></button>
          <button class="act" data-a="offer" data-k="${k.key}" data-o="berth" ${dis || (c.berths ? '' : 'disabled')}><span>🏛️ Cabinet berth</span><small>${c.berths} left</small></button>
          <button class="act" data-a="offer" data-k="${k.key}" data-o="package" ${dis}><span>🎁 State package</span><small>Ongoing cost</small></button>
          <button class="act" data-a="offer" data-k="${k.key}" data-o="dpm" ${dis || (c.dpm ? '' : 'disabled')}><span>⭐ Deputy PM</span><small>Once</small></button>
        </div>`}</div>`;
    }).join('')}</div>
    <div class="bottombar"><span class="muted small">If nobody reaches 272 after round ${c.rounds}, the bigger coalition forms a minority government.</span><button class="btn primary" data-a="coalround">End Round →</button></div>
  </div>`;
}

// ---------------- governance ----------------
function renderGov() {
  const g = G.gov, e = G.eco;
  const appr = overallApproval();
  const tabs = [['dash', '📊 Dashboard'], ['budget', '📒 Budget' + (isBudgetQuarter() && g.lastBudgetQ !== g.q ? ' •' : '')], ['bills', '📜 Bills'], ['parl', '🏛️ Parliament'], ['promises', '✅ Promises'], ['news', '📰 News']];
  let body = '';
  if (UI.tab === 'dash') body = renderDash();
  if (UI.tab === 'budget') body = renderBudget();
  if (UI.tab === 'bills') body = renderBills();
  if (UI.tab === 'parl') body = renderParl();
  if (UI.tab === 'promises') body = renderPromises();
  if (UI.tab === 'news') body = renderLog();
  const ev = g.events[0];
  return `${topbar([
    ['📅', quarterLabel(G.calQ), `Term ${G.term} · Q${g.q + 1}/20`],
    ['🎯', g.pc + ' PC', 'Political capital'],
    ['👍', Math.round(appr) + '%', 'Approval'],
    ['🏛️', govSeats() + '/543', 'Lok Sabha'],
    ['📜', g.rs + '/245', 'Rajya Sabha'],
    ['🤝', Math.round(G.trust), 'Trust'],
  ])}
  <nav class="tabs">${tabs.map(([k, l]) => `<button class="tab ${UI.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}">${l}</button>`).join('')}</nav>
  <div class="govbody">${body}</div>
  <div class="bottombar"><span class="muted small">${g.minority ? '⚠️ Minority government' : `Majority: ${govSeats() - MAJORITY + 1} to spare`} · ${20 - g.q} quarters left in term</span><button class="btn primary" data-a="endq">End Quarter →</button></div>
  ${ev ? eventModal(GOV_EVENTS.find(x => x.id === ev.id), ev.ctx, 'gev') : ''}`;
}

function indicator(name, val, hist, good, fmt = v => v.toFixed(1) + '%', note = '') {
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const cur = hist.length ? hist[hist.length - 1] : null;
  let arrow = '';
  if (prev != null && cur != null && Math.abs(cur - prev) >= .05) {
    const up = cur > prev, isGood = good === 'up' ? up : !up;
    arrow = `<span class="${isGood ? 'up' : 'down'}">${up ? '▲' : '▼'}</span>`;
  }
  return `<div class="ind"><span class="muted small">${name}</span><b>${fmt(val)} ${arrow}</b>${spark(hist.slice(-12))}${note ? `<small class="muted">${note}</small>` : ''}</div>`;
}

function renderDash() {
  const g = G.gov, e = G.eco, h = G.hist;
  return `<div class="grid2">
    <div class="card"><div class="card-h"><b>Economy</b><span class="muted small">GDP ₹${Math.round(e.gdp)} lakh cr (~$${(e.gdp / 85).toFixed(2)} tn)</span></div>
      <div class="inds">
        ${indicator('GDP growth', e.growth, h.growth, 'up')}
        ${indicator('Inflation', e.infl, h.infl, 'down', undefined, 'RBI target 4%')}
        ${indicator('Unemployment', e.unemp, h.unemp, 'down')}
        ${indicator('Fiscal deficit', e.deficit, h.deficit, 'down', undefined, '% of GDP')}
        ${indicator('Debt / GDP', e.debt, h.debt, 'down', v => v.toFixed(0) + '%')}
        <div class="ind"><span class="muted small">RBI repo rate</span><b>${e.repo.toFixed(2)}%</b><small class="muted">RBI credibility ${Math.round(g.rbiCred)}</small></div>
        ${indicator('Sensex', e.sensex, h.sensex, 'up', v => Math.round(v).toLocaleString('en-IN'))}
        <div class="ind"><span class="muted small">Forex reserves</span><b>$${Math.round(e.forex)} bn</b><small class="muted">10-yr yield ${e.yld.toFixed(2)}%</small></div>
        <div class="ind"><span class="muted small">Credit rating</span><b class="${e.rating === 0 ? 'down' : ''}">${RATINGS[e.rating]}</b><small class="muted">Reviewed every Mar–May</small></div>
      </div>
    </div>
    <div class="card"><div class="card-h"><b>Approval by group</b><span class="muted small">Overall ${Math.round(overallApproval())}%</span></div>
      ${BLOCS.map(b => apprBar(b)).join('')}
      ${spark(h.approval.slice(-20), G.color, 280, 40)}
    </div>
    <div class="card span2"><div class="card-h"><b>Prime Minister's Office</b><span class="muted small">${g.pc} PC available · +${clamp(3 + Math.round((overallApproval() - 45) / 8), 1, 6)} next quarter</span></div>
      <div class="actions">${Object.entries(PM_ACTIONS).map(([k, a]) => `<button class="act" data-a="pm" data-id="${k}" ${g[a.once] || g.pc < a.pc ? 'disabled' : ''}><span>${a.icon} ${a.name}</span><small>${a.pc} PC</small><em>${a.desc}</em></button>`).join('')}</div>
    </div>
  </div>`;
}

function apprBar(b) {
  const v = G.gov.approval[b.id];
  const col = v >= 55 ? 'var(--good)' : v >= 40 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="abar"><span>${b.icon} ${b.name}</span><div><i style="width:${v}%;background:${col}"></i></div><b>${Math.round(v)}%</b></div>`;
}

function renderBudget() {
  const g = G.gov, e = G.eco;
  const open = isBudgetQuarter() && g.lastBudgetQ !== g.q;
  if (!UI.draft || !open) UI.draft = open && UI.draft ? UI.draft : Object.fromEntries(Object.keys(BUDGET_LIMITS).map(k => [k, e.b[k]]));
  const d = UI.draft;
  const def = previewDeficit(d);
  const row = k => {
    const L = BUDGET_LIMITS[k], v = d[k], cur = e.b[k];
    const diff = v - cur;
    return `<div class="slider"><label><span>${L.name}</span><b id="bv-${k}">${L.step < 1 ? v.toFixed(1) : v}${L.unit}</b>${Math.abs(diff) > 1e-9 ? `<em class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${L.step < 1 ? diff.toFixed(1) : diff}</em>` : ''}</label>
      <input type="range" min="${L.min}" max="${L.max}" step="${L.step}" value="${v}" data-b="${k}" ${open ? '' : 'disabled'}></div>`;
  };
  const tips = [
    'Income tax ↓ pleases the Middle Class. Corporate tax ↓ pleases Business and lifts long-run growth.',
    'GST ↑ raises lots of revenue but hits everyone\'s wallet and adds to inflation.',
    'Infrastructure and Education/Health build long-term growth. Welfare & Agriculture win votes now.',
    'Deficits above ~6% fuel inflation, anger voters and invite rating downgrades.',
  ];
  return `<div class="grid2">
    <div class="card"><div class="card-h"><b>Taxes</b></div>${['itr', 'ctr', 'gst'].map(row).join('')}</div>
    <div class="card"><div class="card-h"><b>Spending</b><span class="muted small">% of GDP</span></div>${['infra', 'defence', 'health', 'education', 'welfare', 'agri'].map(row).join('')}</div>
    <div class="card span2">
      <div class="card-h"><b>${open ? '📒 Union Budget — draft' : '📒 Current budget'}</b><span class="muted small">${open ? 'Budget session is open' : 'Next budget in the Dec–Feb quarter'}</span></div>
      <div class="budsum">
        <div><span class="muted small">Fiscal deficit</span><b id="defprev" class="${def > 6 ? 'down' : def < 4.5 ? 'up' : ''}">${def.toFixed(2)}% of GDP</b></div>
        <div><span class="muted small">Interest on debt</span><b>${e.interest.toFixed(2)}%</b></div>
        <div><span class="muted small">Schemes & programmes</span><b>${e.programSpend.toFixed(2)}%</b></div>
        <div><span class="muted small">Revenue</span><b>${e.revenue.toFixed(2)}%</b></div>
      </div>
      ${e.b.programs.length ? `<div class="muted small">Ongoing schemes: ${e.b.programs.map(p => `${esc(p.name)} (${p.spend.toFixed(2)}%)`).join(', ')}</div>` : ''}
      <ul class="tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul>
      ${open ? '<div class="row gap"><button class="btn ghost" data-a="resetbudget">Reset</button><button class="btn primary" data-a="budget">Present Budget to Parliament</button></div>' : ''}
    </div>
  </div>`;
}

function renderBills() {
  const g = G.gov;
  return `<div class="bills">${REFORMS.map(r => {
    const passed = g.passed.includes(r.id);
    const st = billStatus(r.id);
    const eff = Object.entries(r.blocs).map(([b, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${BLOCS.find(x => x.id === b).icon}${v > 0 ? '+' : ''}${v}</span>`).join(' ');
    const extras = [r.boost ? `📈 growth +${r.boost}` : '', r.spend ? `💸 ${r.spend}% GDP/yr` : '', r.oneTime ? `💸 ${r.oneTime}% GDP once` : '', r.revOnce ? `💰 +${r.revOnce}% GDP once` : '', r.unemp ? `👷 jobs` : '', r.risk ? '⚠️ may trigger protests' : ''].filter(Boolean).join(' · ');
    const promised = g.promises.some(id => PROMISES.find(p => p.id === id).check.toString().includes(`'${r.id}'`));
    let actions = '';
    if (!passed) {
      const dis = g.pc < r.pc || g.events.length ? 'disabled' : '';
      actions = `<div class="actions">
        <button class="act" data-a="bill" data-id="${r.id}" data-m="vote" ${dis}><span>Introduce bill</span><small>${r.pc} PC${st.rsShort ? ` · RS pass ~${Math.round(st.rsChance * 100)}%` : ''}</small></button>
        ${st.rsShort ? `<button class="act" data-a="bill" data-id="${r.id}" data-m="floor" ${g.pc < r.pc + st.floorPC ? 'disabled' : ''}><span>Floor management</span><small>${r.pc + st.floorPC} PC · secures RS</small></button>
        <button class="act" data-a="bill" data-id="${r.id}" data-m="moneyroute" ${dis}><span>Route as Money Bill</span><small>${r.pc} PC · Trust −8</small></button>` : ''}
      </div>`;
    }
    return `<div class="card bill ${passed ? 'passed' : ''}">
      <div class="card-h"><b>${passed ? '✅ ' : ''}${r.name}</b><span class="muted small">${r.money ? 'Money bill' : 'Needs Rajya Sabha'}${promised ? ' · 📜 promised' : ''}</span></div>
      <p class="small">${r.desc}</p>
      <div class="eff">${eff}</div>
      ${extras ? `<div class="muted small">${extras}</div>` : ''}
      ${!passed && st.objectors.length ? `<div class="small warn">⚠️ Opposed by allies: ${st.objectors.map(a => a.short).join(', ')}</div>` : ''}
      ${actions}
    </div>`;
  }).join('')}</div>`;
}

function renderParl() {
  const g = G.gov;
  const allySeats = g.allies.reduce((t, a) => t + a.seats, 0);
  return `<div class="grid2">
    <div class="card"><div class="card-h"><b>Lok Sabha</b><span class="muted small">${govSeats()} / 543</span></div>
      ${seatBar(g.party + allySeats, TOTAL_SEATS - g.party - allySeats, 0, false)}
      <p class="small">${esc(G.short)}: <b>${g.party}</b> MPs · Allies: <b>${allySeats}</b> MPs ${g.minority ? '· <span class="down">minority government</span>' : ''}</p>
    </div>
    <div class="card"><div class="card-h"><b>Rajya Sabha</b><span class="muted small">${g.rs} / 245 · need 123</span></div>
      <div class="seatbar"><div style="width:${g.rs / 245 * 100}%;background:${G.color}"></div><span class="majline" style="left:${123 / 245 * 100}%"></span></div>
      <p class="small muted">Win state elections to gain Rajya Sabha seats. Money bills don't need the Rajya Sabha.</p>
    </div>
    <div class="card span2"><div class="card-h"><b>Coalition partners</b></div>
      ${g.allies.length ? g.allies.map(a => {
        const col = a.sat >= 55 ? 'var(--good)' : a.sat >= 30 ? 'var(--warn)' : 'var(--bad)';
        return `<div class="ally"><div><b>${esc(a.name)}</b> <span class="muted small">${a.short} · ${a.seats} MPs · opposes ${a.dislikes.join(', ') || 'nothing in particular'}</span></div>
          <div class="abar"><span>Satisfaction</span><div><i style="width:${a.sat}%;background:${col}"></i></div><b>${Math.round(a.sat)}</b></div>
          <button class="btn small" data-a="pkg" data-k="${a.key}" ${g.pc < 1 ? 'disabled' : ''}>🎁 Development package (1 PC, 0.12% GDP)</button></div>`;
      }).join('') : '<p class="muted">You govern alone.</p>'}
    </div>
  </div>`;
}

function renderPromises() {
  const g = G.gov;
  if (!g.promises.length) return '<div class="card"><p class="muted">You made no manifesto promises this term.</p></div>';
  return `<div class="card"><div class="card-h"><b>Manifesto tracker</b><span class="muted small">Checked at the end of the term</span></div>
    ${g.promises.map(id => { const p = PROMISES.find(x => x.id === id), ok = p.check(G);
      return `<div class="ptrack"><span>${ok ? '✅' : '⏳'}</span><div><b>${p.name}</b><div class="muted small">${p.keep}</div></div></div>`; }).join('')}</div>`;
}

// ---------------- term report & game over ----------------
function renderReport() {
  const r = G.report;
  return `<div class="report">
    <h1>📋 Report Card — Term ${r.term}</h1>
    <div class="inds big">
      <div class="ind"><span class="muted small">Avg growth</span><b>${r.growth}%</b></div>
      <div class="ind"><span class="muted small">Avg inflation</span><b>${r.infl}%</b></div>
      <div class="ind"><span class="muted small">Unemployment</span><b>${r.unemp}%</b></div>
      <div class="ind"><span class="muted small">Debt / GDP</span><b>${r.debt}%</b></div>
      <div class="ind"><span class="muted small">GDP</span><b>₹${r.gdp} lakh cr</b></div>
      <div class="ind"><span class="muted small">Approval</span><b>${r.approval}%</b></div>
    </div>
    <div class="card"><b>Promises kept (${r.kept.length})</b><p>${r.kept.map(esc).join(', ') || '—'}</p>
    <b>Promises broken (${r.broken.length})</b><p class="down">${r.broken.map(esc).join(', ') || '—'}</p></div>
    <p class="muted">Your approval in each state becomes your starting position. The RSP smells blood.</p>
    <button class="btn primary big" data-a="reelect">Begin Re-election Campaign →</button>
  </div>`;
}

function renderGameOver() {
  const L = legacyScore();
  const lostFirst = G.quartersAsPM === 0;
  return `<div class="report">
    <h1>${lostFirst ? '💔 Defeat' : '🏁 The End of an Era'}</h1>
    <p class="lead">${lostFirst ? `The RSP holds on to power. ${esc(G.leader)} will lead the opposition for another five years.` : `${esc(G.leader)} leaves 7 Lok Kalyan Marg after ${L.yrs} years as Prime Minister.`}</p>
    <div class="legacy"><small>Legacy</small><b>${L.title}</b><span>${L.score} points</span></div>
    <div class="inds big">
      <div class="ind"><span class="muted small">Years as PM</span><b>${L.yrs}</b></div>
      <div class="ind"><span class="muted small">Elections won</span><b>${G.termsWon}</b></div>
      <div class="ind"><span class="muted small">Avg growth</span><b>${G.hist.growth.length ? avg(G.hist.growth).toFixed(1) + '%' : '—'}</b></div>
      <div class="ind"><span class="muted small">Reforms passed</span><b>${G.gov ? G.gov.passed.length : 0}</b></div>
      <div class="ind"><span class="muted small">Promises kept</span><b>${G.promisesKept}</b></div>
      <div class="ind"><span class="muted small">Promises broken</span><b>${G.promisesBroken}</b></div>
    </div>
    <button class="btn primary big" data-a="newgame">Play Again</button>
  </div>`;
}

// ---------------- router ----------------
function render() {
  const app = $('#app');
  let html;
  if (!G || UI.screen === 'title') html = UI.screen === 'setup' ? renderSetup() : renderTitle();
  else if (G.phase === 'campaign') html = renderCampaign();
  else if (G.phase === 'results') html = renderResults();
  else if (G.phase === 'coalition') html = renderCoalition();
  else if (G.phase === 'gov') html = renderGov();
  else if (G.phase === 'termreport') html = renderReport();
  else html = renderGameOver();
  if (UI.screen === 'setup') html = renderSetup();
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

const ACTIONS = {
  continue() { if (load()) { UI.screen = 'game'; render(); } },
  newgame() { UI.setup = { leader: 'Asha Verma', party: 'Jan Shakti Party', short: 'JSP', symbol: PARTY_SYMBOLS[0], color: PARTY_COLORS[0], ideology: 'centrist', difficulty: 'normal' }; UI.screen = 'setup'; G = null; render(); },
  title() { UI.screen = 'title'; G = null; render(); },
  help() { openModal(helpHTML()); },
  closemodal() { closeModal(); },
  set(d) { readSetupInputs(); UI.setup[d.k] = d.v; render(); },
  start() {
    readSetupInputs();
    const s = UI.setup;
    if (!s.leader.trim() || !s.party.trim() || !s.short.trim()) return toast('Fill in your name and party', 'bad');
    newGame(s); UI.screen = 'game'; UI.sel = 'UP'; UI.reveal = null; UI.tab = 'dash';
    render();
    if (!localStorage.getItem('rajneeti.seenHelp')) { try { localStorage.setItem('rajneeti.seenHelp', '1'); } catch (e) { /* ignore */ } openModal(helpHTML()); }
  },
  sel(d) { UI.sel = d.s || null; render(); },
  camp(d) { handle(campaignAction(d.id, d.s, d.opt === '1')); },
  promise(d) { handle(addPromise(d.id)); },
  endweek() {
    const r = endWeek();
    if (r.err) return toast(r.err, 'bad');
    if (r.election) { UI.reveal = null; window.scrollTo(0, 0); }
    render();
  },
  cev(d) { handle(resolveCampaignEvent(+d.i)); },
  skipreveal() { clearTimeout(UI.reveal.timer); UI.reveal.n = 999; render(); },
  afterresults() { UI.reveal = null; afterResults(); UI.tab = 'budget'; save(); window.scrollTo(0, 0); render(); },
  offer(d) { handle(coalOffer(d.k, d.o)); save(); },
  coalround() { const r = coalEndRound(); if (r === 'gov') UI.tab = 'budget'; save(); render(); },
  tab(d) { UI.tab = d.t; render(); },
  gev(d) {
    const r = resolveGovEvent(+d.i);
    if (r.err) return toast(r.err, 'bad');
    toast(r.msg, 'good');
    if (r.phaseChange) { UI.sel = null; window.scrollTo(0, 0); }
    render();
  },
  endq() {
    const r = endQuarter();
    if (r.err) { if (r.err.includes('Budget')) UI.tab = 'budget'; toast(r.err, 'bad'); return render(); }
    UI.draft = null;
    if (isBudgetQuarter && G.phase === 'gov' && isBudgetQuarter()) { UI.tab = 'budget'; toast('📒 Budget session is open!'); }
    window.scrollTo(0, 0);
    render();
  },
  budget() { const r = applyBudget(UI.draft); UI.draft = null; UI.tab = 'dash'; handle(r); },
  resetbudget() { UI.draft = null; render(); },
  bill(d) { handle(introduceBill(d.id, d.m)); },
  pm(d) { handle(pmAction(d.id)); },
  pkg(d) { handle(allyPackage(d.k)); },
  reelect() { goToElection(false); UI.sel = null; window.scrollTo(0, 0); render(); },
  menu() {
    openModal(`<h2>Menu</h2><div class="choices">
      <button class="choice" data-a="help"><b>📖 How to play</b></button>
      <button class="choice" data-a="quit"><b>🏠 Save & return to title</b></button>
      <button class="choice" data-a="abandon"><b>🗑️ Abandon this game</b><small>Deletes your save</small></button>
      <button class="choice" data-a="closemodal"><b>Close</b></button></div>`);
  },
  quit() { save(); closeModal(); UI.screen = 'title'; G = null; render(); },
  abandon() { if (confirm('Delete this saved game?')) { clearSave(); closeModal(); UI.screen = 'title'; G = null; render(); } },
};

function readSetupInputs() {
  if (!$('#f-leader')) return;
  UI.setup.leader = $('#f-leader').value; UI.setup.party = $('#f-party').value; UI.setup.short = $('#f-short').value.toUpperCase();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  if ($('#popup')) { if (!el.closest('#popup')) return; closeModal(); }
  ACTIONS[a] && ACTIONS[a](el.dataset);
});

// While dragging, update just the numbers; re-render fully when the slider is released.
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.b;
  if (!k || !UI.draft) return;
  const L = BUDGET_LIMITS[k];
  UI.draft[k] = parseFloat(e.target.value);
  $('#bv-' + k).textContent = (L.step < 1 ? UI.draft[k].toFixed(1) : UI.draft[k]) + L.unit;
  $('#defprev').textContent = previewDeficit(UI.draft).toFixed(2) + '% of GDP';
});
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.b) render(); });

render();
