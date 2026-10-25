// RAJNEETI — game rules and simulation. No DOM access here.

let G = null;
const SAVE_KEY = 'rajneeti.save.v1';
const MAJORITY = 272;
const TOTAL_SEATS = 543;
const RS_TOTAL = 245;

// ---------- helpers ----------
const rand = () => Math.random();
const randn = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pick = a => a[Math.floor(rand() * a.length)];
const round1 = x => Math.round(x * 10) / 10;
const stateById = id => STATES.find(s => s.id === id);
const fmtCr = x => '₹' + Math.round(x).toLocaleString('en-IN') + ' cr';

function blocWeights(s) {
  const u = s.urban;
  const w = {
    farmers: .34 * (1 - u) + .02,
    poor: .30 * (1 - u) + .04,
    workers: .12 + .10 * u,
    middle: .06 + .34 * u,
    youth: .14,
    business: .02 + .08 * u,
  };
  const t = Object.values(w).reduce((a, b) => a + b, 0);
  for (const k in w) w[k] /= t;
  return w;
}
const WEIGHTS = Object.fromEntries(STATES.map(s => [s.id, blocWeights(s)]));

function log(msg, kind = '') {
  G.log.unshift({ t: timeLabel(), msg, kind });
  if (G.log.length > 80) G.log.length = 80;
}

function timeLabel() {
  if (G.phase === 'gov' && G.gov) return quarterLabel(G.calQ);
  if (G.camp) return 'Week ' + G.camp.week;
  return '';
}

// calQ counts quarters since June 2029 and never resets, so snap elections keep the calendar right
function quarterLabel(calQ) {
  const months = ['Jun–Aug', 'Sep–Nov', 'Dec–Feb', 'Mar–May'];
  return months[calQ % 4] + ' ' + (2029 + Math.floor(calQ / 4) + (calQ % 4 === 3 ? 1 : 0));
}

// ---------- new game ----------
function newGame(o) {
  const diff = DIFFICULTY[o.difficulty];
  G = {
    ver: 1,
    leader: o.leader, party: o.party, short: o.short, symbol: o.symbol, color: o.color,
    ideology: o.ideology, difficulty: o.difficulty,
    calQ: 0, term: 1, termsWon: 0, quartersAsPM: 0,
    trust: 55,
    appeal: { you: { ...IDEOLOGIES[o.ideology].appeal }, A: { ...RIVAL_APPEAL.A }, B: { ...RIVAL_APPEAL.B } },
    shift: {},          // per-state base shift after governing
    incumbent: 'A',
    phase: 'campaign',
    log: [],
    hist: { growth: [], infl: [], unemp: [], deficit: [], debt: [], approval: [], sensex: [] },
    promisesKept: 0, promisesBroken: 0,
    camp: null, gov: null, eco: null, result: null, coal: null, report: null,
  };
  startCampaign({ weeks: 10, funds: diff.funds, first: true });
  log(`${G.leader} launches the ${G.party} campaign. ${MAJORITY} seats needed for a majority.`, 'big');
  save();
}

// ---------- campaign ----------
function startCampaign({ weeks, funds, first, snap }) {
  const prevAlliances = {};
  if (G.gov) for (const a of G.gov.allies) if (stateById(a.key)) prevAlliances[a.key] = 'you';
  const alliances = {};
  const affinity = {};
  for (const s of STATES) {
    if (!s.reg) continue;
    affinity[s.id] = s.reg.lean;
    alliances[s.id] = null;
  }
  if (first) {
    alliances.TN = 'you';
    alliances.BR = 'A';
    alliances.AP = 'A';
  } else {
    Object.assign(alliances, prevAlliances);
    // parties allied with RSP drift to whichever side looks stronger
    for (const s of STATES) if (s.reg && !alliances[s.id] && rand() < .35) alliances[s.id] = 'A';
  }
  G.camp = {
    week: 1, weeks, ap: 3, apMax: 3, funds, cadre: first ? 40 : 55,
    momentum: snap ? -2 : 0, momA: 2, momB: 0,
    ground: {}, groundA: {}, groundB: {}, alliances, affinity, generous: {}, cooldown: {},
    promises: [], social: { youth: 0, middle: 0 }, donorRisk: 0, pressDone: false,
    event: null, polls: [], govAppeal: {},
  };
  for (const s of STATES) { G.camp.ground[s.id] = 0; G.camp.groundA[s.id] = 0; G.camp.groundB[s.id] = 0; }
  if (G.gov) {
    // governance record shapes your appeal
    for (const b of BLOCS) G.camp.govAppeal[b.id] = (G.gov.approval[b.id] - 50) * .4;
  }
  G.phase = 'campaign';
  G.camp.polls.push(pollSnapshot());
  rollCampaignEvent();
}

function promiseAppeal(b) {
  let t = 0;
  for (const id of G.camp.promises) { const p = PROMISES.find(x => x.id === id); t += p.blocs[b] || 0; }
  return t * (0.5 + G.trust / 100);
}

function youAppeal(b) {
  const C = G.camp;
  return G.appeal.you[b] + promiseAppeal(b) + (C.social[b] || 0) + (C.govAppeal[b] || 0);
}

function statePoints(s) {
  const C = G.camp, w = WEIGHTS[s.id], sh = G.shift[s.id] || [0, 0, 0, 0];
  let aY = 0, aA = 0, aB = 0;
  for (const b of BLOCS) { aY += w[b.id] * youAppeal(b.id); aA += w[b.id] * G.appeal.A[b.id]; aB += w[b.id] * G.appeal.B[b.id]; }
  const inc = G.incumbent === 'A' ? -3 : 0; // ten years in power breeds fatigue
  const you = s.base[0] + DIFFICULTY[G.difficulty].baseBonus + sh[0] + aY * .6 + C.ground[s.id] + C.momentum * .8 + (G.trust - 50) * .08;
  const A = s.base[1] + sh[1] + aA * .6 + C.groundA[s.id] + C.momA * .8 + inc;
  const B = s.base[2] + sh[2] + aB * .4 + C.groundB[s.id] + C.momB * .5;
  const R = s.base[3] + sh[3];
  return [Math.max(1, you), Math.max(1, A), Math.max(.5, B), Math.max(.5, R)];
}

function stateShares(s) {
  const p = statePoints(s), t = p[0] + p[1] + p[2] + p[3];
  return p.map(x => x / t);
}

const PKEYS = ['you', 'A', 'B', 'R'];

// One full seat-by-seat simulation of the general election.
function simulate(noise = .3) {
  const byState = {};
  const totals = { you: 0, A: 0, B: 0, R: 0 };
  const regSeats = {};
  for (const s of STATES) {
    const sh = stateShares(s);
    const al = G.camp.alliances[s.id];
    let pR = sh[3] / ((al === 'A' ? sh[1] : sh[0]) + sh[3]);
    if (al === 'you' && G.camp.generous[s.id]) pR = Math.min(.9, pR + .15);
    const res = { you: 0, A: 0, B: 0, R: 0 };
    for (let i = 0; i < s.seats; i++) {
      const v = sh.map(x => x * Math.exp(randn() * noise));
      if (al) {
        const X = al === 'you' ? 0 : 1;
        const comb = (v[X] + v[3]) * .93;
        if (rand() < pR) { v[3] = comb; v[X] = 0; } else { v[X] = comb; v[3] = 0; }
      }
      let w = 0; for (let k = 1; k < 4; k++) if (v[k] > v[w]) w = k;
      res[PKEYS[w]]++;
    }
    byState[s.id] = res;
    totals.you += res.you; totals.A += res.A; totals.B += res.B; totals.R += res.R;
    regSeats[s.id] = res.R;
  }
  return { byState, totals, regSeats, ...blocTotals(byState) };
}

function blocTotals(byState) {
  let youBloc = 0, aBloc = 0, others = 0;
  for (const s of STATES) {
    const r = byState[s.id], al = G.camp.alliances[s.id];
    youBloc += r.you; aBloc += r.A;
    if (al === 'you') youBloc += r.R; else if (al === 'A') aBloc += r.R; else others += r.R;
    others += r.B;
  }
  return { youBloc, aBloc, others };
}

function projection(n = 12) {
  const acc = { byState: {}, totals: { you: 0, A: 0, B: 0, R: 0 }, youBloc: 0, aBloc: 0, others: 0 };
  for (const s of STATES) acc.byState[s.id] = { you: 0, A: 0, B: 0, R: 0 };
  for (let i = 0; i < n; i++) {
    const r = simulate();
    for (const s of STATES) for (const k of PKEYS) acc.byState[s.id][k] += r.byState[s.id][k] / n;
    for (const k of PKEYS) acc.totals[k] += r.totals[k] / n;
    acc.youBloc += r.youBloc / n; acc.aBloc += r.aBloc / n; acc.others += r.others / n;
  }
  return acc;
}

function canAct(cost, ap = 1) {
  const C = G.camp;
  if (C.ap < ap) return 'No moves left this week';
  if (C.funds < cost) return 'Not enough 💰 money';
  return null;
}

function spend(cost, ap = 1) { G.camp.funds -= cost; G.camp.ap -= ap; }

const CAMPAIGN_ACTIONS = {
  rally: {
    name: 'Mega Rally', icon: '📣', cost: 15, state: true,
    desc: 'Big boost to local support in this state. Diminishing returns.',
    run(s) {
      const C = G.camp, g = C.ground[s.id];
      const gain = 4.2 * (1 - g / 32);
      C.ground[s.id] = g + gain; C.momentum += .4;
      return `Massive crowd at your rally in ${s.name}. Local support +${round1(gain)}.`;
    },
  },
  cadre: {
    name: 'Door-to-Door Drive', icon: '🚪', cost: 4, state: true,
    desc: 'Cheap ground work. Stronger with more cadre.',
    run(s) {
      const C = G.camp, g = C.ground[s.id];
      const gain = 2.2 * clamp(C.cadre / 60, .4, 2) * (1 - g / 32);
      C.ground[s.id] = g + gain;
      return `Volunteers knock on doors across ${s.name}. Local support +${round1(gain)}.`;
    },
  },
  alliance: {
    name: 'Alliance Talks', icon: '🤝', cost: 0, state: true,
    desc: 'Invite the regional party into your alliance.',
    run(s, generous) {
      const C = G.camp, cur = C.alliances[s.id];
      if (generous) C.funds -= 25;
      if (rand() < allianceChance(s.id, generous)) {
        C.alliances[s.id] = 'you';
        if (generous) C.generous[s.id] = true;
        C.affinity[s.id] = Math.min(1, C.affinity[s.id] + .1);
        return `🤝 The ${s.reg.name} (${s.reg.short}) joins your alliance in ${s.name}!` + (cur === 'A' ? ' A major blow to the RSP.' : '');
      }
      C.affinity[s.id] = Math.max(0, C.affinity[s.id] - .06);
      C.cooldown[s.id] = C.week + 2;
      return `The ${s.reg.short} turned down your offer. They won't talk again for 2 weeks.`;
    },
  },
  membership: {
    name: 'Membership Drive', icon: '🧑‍🤝‍🧑', cost: 6,
    desc: '+12 cadre. Cadre makes door-to-door drives stronger and brings in small donations.',
    run() { G.camp.cadre += 12; return 'Membership drive brings in thousands of new volunteers. Cadre +12.'; },
  },
  ads: {
    name: 'National Ad Blitz', icon: '📺', cost: 40,
    desc: 'TV, newspapers and hoardings everywhere. Momentum +2.5 (fades over time).',
    run() { G.camp.momentum += 2.5; return 'Your ads dominate prime time. National momentum up.'; },
  },
  social: {
    name: 'Social Media Campaign', icon: '📱', cost: 12,
    desc: 'Lasting appeal with Youth (+1.5) and Middle Class (+1).',
    run() {
      const s = G.camp.social;
      s.youth = Math.min(10, s.youth + 1.5); s.middle = Math.min(8, s.middle + 1);
      return 'Your campaign trends on social media. Youth and middle-class appeal up.';
    },
  },
  fundraise: {
    name: 'Corporate Fundraiser', icon: '💰', cost: 0,
    desc: 'Raise ₹50–80 cr. Trust −2, and big donors can come back to haunt you.',
    run() {
      const C = G.camp, amt = Math.round(50 + Math.max(0, G.appeal.you.business) * 3);
      C.funds += amt; G.trust = clamp(G.trust - 2, 0, 100); C.donorRisk++;
      return `Industrialists open their wallets: +${fmtCr(amt)}. Trust −2.`;
    },
  },
  attack: {
    name: 'Attack the RSP', icon: '⚔️', cost: 10,
    desc: 'Go negative on the ruling party. Works better when people trust you.',
    run() {
      const C = G.camp;
      if (rand() < .35 + G.trust / 200) {
        C.momA -= 3; C.momentum += .5;
        return 'Your attack on the government lands. RSP momentum falls.';
      }
      G.trust = clamp(G.trust - 3, 0, 100); C.momentum -= 1;
      return 'The attack backfires and looks petty. Trust −3.';
    },
  },
  press: {
    name: 'Press Conference', icon: '🎤', cost: 3,
    desc: 'Answer tough questions. Trust +3. Once a week.',
    run() {
      G.camp.pressDone = true; G.trust = clamp(G.trust + 3, 0, 100);
      return 'A calm, detailed press conference. Trust +3.';
    },
  },
};

function allianceChance(id, generous) {
  const C = G.camp, proj = C.polls[C.polls.length - 1];
  // regional parties back whoever looks like winning
  const lead = proj ? (proj.you - proj.A) / 500 : 0;
  const p = .08 + .5 * C.affinity[id] + lead + (generous ? .18 : 0) - (C.alliances[id] === 'A' ? .2 : 0);
  return clamp(p, .03, .8);
}

function pollSnapshot() {
  const p = projection(20);
  return { you: Math.round(p.totals.you), A: Math.round(p.totals.A), youBloc: Math.round(p.youBloc), aBloc: Math.round(p.aBloc), others: Math.round(p.others) };
}

function campaignAction(id, stateId, opt) {
  const a = CAMPAIGN_ACTIONS[id];
  const err = actionBlocked(id, stateId, opt);
  if (err) return { err };
  spend(a.cost);
  const msg = a.run(stateId ? stateById(stateId) : null, opt);
  log(msg);
  save();
  return { msg };
}

function actionBlocked(id, stateId, opt) {
  const a = CAMPAIGN_ACTIONS[id], C = G.camp;
  const e = canAct(a.cost + (id === 'alliance' && opt ? 25 : 0));
  if (e) return e;
  if (C.event) return 'Answer the news card first';
  if (id === 'press' && C.pressDone) return 'Already held one this week';
  if (id === 'alliance') {
    const s = stateById(stateId);
    if (!s.reg) return 'No regional party here';
    if (C.alliances[stateId] === 'you') return 'Already your ally';
    if ((C.cooldown[stateId] || 0) > C.week) return 'They want a break. Try later!';
  }
  return null;
}

// The manifesto is chosen once, up front, as a hand of three promises.
function choosePromises(ids) {
  const C = G.camp;
  C.promises = ids.slice(0, 3);
  for (const id of C.promises) { const p = PROMISES.find(x => x.id === id); if (p.trust) G.trust = clamp(G.trust + p.trust, 0, 100); }
  C.manifestoDone = true;
  C.polls[C.polls.length - 1] = pollSnapshot();
  log(`📜 Manifesto released: ${C.promises.map(id => PROMISES.find(x => x.id === id).name).join(', ')}.`, 'big');
  save();
}

function addPromise(id) {
  const C = G.camp;
  if (C.event) return { err: 'Answer the news card first' };
  if (C.promises.length >= 5) return { err: 'Manifesto full (5 promises max)' };
  if (C.ap < 1) return { err: 'No moves left this week' };
  if (C.promises.includes(id)) return { err: 'Already promised' };
  C.ap--; C.promises.push(id);
  const p = PROMISES.find(x => x.id === id);
  if (p.trust) G.trust = clamp(G.trust + p.trust, 0, 100);
  log(`📜 Manifesto promise: "${p.name}". You must deliver if elected.`);
  save();
  return { msg: 'Promise added' };
}

function rivalTurn() {
  const C = G.camp, ai = DIFFICULTY[G.difficulty].rivalAI;
  // RSP targets the states where you are closest to overtaking them
  if (rand() < .6) C.momA += 1.6 * ai;
  // RSP counters wherever you have been investing, weighted by seats
  const targets = STATES.slice().sort((a, b) => (C.ground[b.id] + 2) * b.seats - (C.ground[a.id] + 2) * a.seats).slice(0, 4);
  for (let i = 0; i < 3; i++) {
    const s = pick(targets), g = C.groundA[s.id];
    C.groundA[s.id] = g + 3.5 * ai * (1 - g / 32);
  }
  if (rand() < .4) { const s = pick(STATES); C.groundB[s.id] += 2; C.momB += .5; }
  // RSP courts regional parties
  if (rand() < .3 * ai) {
    const free = STATES.filter(s => s.reg && !C.alliances[s.id]);
    if (free.length) {
      const s = pick(free);
      const proj = C.polls[C.polls.length - 1];
      if (rand() < .6 * (1 - C.affinity[s.id]) + (proj ? (proj.A - proj.you) / 600 : 0)) {
        C.alliances[s.id] = 'A';
        log(`⚠️ The ${s.reg.short} (${s.name}) has allied with the RSP.`, 'bad');
      }
    }
  }
  if (rand() < .08 * ai) {
    const mine = STATES.filter(s => C.alliances[s.id] === 'you' && C.affinity[s.id] < .5);
    if (mine.length) {
      const s = pick(mine);
      C.alliances[s.id] = 'A'; delete C.generous[s.id];
      log(`💔 The RSP poached your ally ${s.reg.short} in ${s.name}!`, 'bad');
    }
  }
}

function endWeek() {
  const C = G.camp;
  if (C.event) return { err: 'Answer the news card first' };
  rivalTurn();
  C.momentum *= .82; C.momA *= .82; C.momB *= .85;
  const income = Math.round(8 + C.cadre * .15);
  C.funds += income;
  C.cadre += 2;
  C.week++;
  C.ap = C.apMax; C.pressDone = false;
  if (C.week > C.weeks) { runElection(); save(); return { election: true }; }
  C.polls.push(pollSnapshot());
  log(`New week. Donations +${fmtCr(income)}.`);
  rollCampaignEvent();
  save();
  return {};
}

function rollCampaignEvent() {
  const C = G.camp;
  if (C.week === 1 || rand() > .7) return;
  const pool = CAMPAIGN_EVENTS.filter(e => !e.when || e.when(G));
  const e = pick(pool);
  const ctx = e.ctx ? e.ctx(G) : {};
  C.event = { id: e.id, ctx };
}

function resolveCampaignEvent(i) {
  const C = G.camp, ev = CAMPAIGN_EVENTS.find(e => e.id === C.event.id);
  const ch = ev.choices(G, C.event.ctx)[i];
  if (!ch) return { err: 'No such choice' };
  if (ch.cost && C.funds < ch.cost) return { err: 'Not enough 💰 money' };
  if (ch.cost) C.funds -= ch.cost;
  const msg = ch.run(G, C.event.ctx);
  G.trust = clamp(G.trust, 0, 100);
  C.event = null;
  log(msg, 'event');
  save();
  return { msg };
}

// ---------- election ----------
function runElection() {
  const r = simulate();
  const C = G.camp;
  G.result = r;
  G.result.alliances = { ...C.alliances };
  G.phase = 'results';
  log(`🗳️ Results: your alliance ${r.youBloc}, RSP alliance ${r.aBloc}, others ${r.others}.`, 'big');
}

function afterResults() {
  const r = G.result;
  if (r.youBloc >= MAJORITY) { formGovernment([], false); return 'gov'; }
  if (r.aBloc >= MAJORITY) { G.phase = 'gameover'; G.endReason = 'lost'; return 'lost'; }
  startCoalition();
  return 'coalition';
}

function startCoalition() {
  const r = G.result, al = r.alliances;
  const kingmakers = [];
  for (const s of STATES) {
    if (!s.reg || al[s.id] || r.regSeats[s.id] === 0) continue;
    kingmakers.push({ key: s.id, name: s.reg.name, short: s.reg.short, seats: r.regSeats[s.id], aff: G.camp.affinity[s.id], side: null, tried: false });
  }
  if (r.totals.B > 0) kingmakers.push({ key: 'B', name: RIVALS.B.name, short: RIVALS.B.short, seats: r.totals.B, aff: .45, side: null, tried: false });
  const indep = STATES.filter(s => !s.reg).reduce((t, s) => t + r.byState[s.id].R, 0);
  if (indep > 0) kingmakers.push({ key: 'IND', name: 'Independents & small parties', short: 'IND', seats: indep, aff: .5, side: null, tried: false });
  G.coal = { round: 1, rounds: 3, berths: 5, dpm: true, kingmakers, packages: [] };
  G.phase = 'coalition';
}

function coalTotals() {
  const c = G.coal, r = G.result;
  let you = r.youBloc, A = r.aBloc;
  for (const k of c.kingmakers) { if (k.side === 'you') you += k.seats; if (k.side === 'A') A += k.seats; }
  return { you, A };
}

function coalOffer(key, offer) {
  const c = G.coal, k = c.kingmakers.find(x => x.key === key);
  if (k.side || k.tried) return { err: 'Already decided this round' };
  let bonus = 0;
  if (offer === 'berth') { if (!c.berths) return { err: 'No cabinet berths left' }; c.berths--; bonus = .25; }
  if (offer === 'package') { bonus = .3; }
  if (offer === 'dpm') { if (!c.dpm) return { err: 'Deputy PM post already promised' }; c.dpm = false; bonus = .45; }
  k.tried = true;
  const t = coalTotals();
  const lead = (t.you - t.A) / 100;
  const p = clamp(k.aff * .7 + bonus + lead * .3, .03, .95);
  if (rand() < p) {
    k.side = 'you';
    if (offer === 'package') c.packages.push(key);
    return { msg: `✅ ${k.short} (${k.seats} seats) will support your government!` };
  }
  return { msg: `❌ ${k.short} refused your offer this round.` };
}

function coalEndRound() {
  const c = G.coal;
  // RSP makes its own offers
  for (const k of c.kingmakers) {
    if (k.side) continue;
    if (rand() < (1 - k.aff) * .45) { k.side = 'A'; log(`${k.short} backs the RSP.`, 'bad'); }
    k.tried = false;
  }
  c.round++;
  const t = coalTotals();
  if (t.you >= MAJORITY || t.A >= MAJORITY || c.round > c.rounds) return coalResolve();
  save();
  return null;
}

function coalResolve() {
  const t = coalTotals();
  if (t.you >= MAJORITY || (t.you > t.A && G.coal.round > G.coal.rounds)) {
    const extra = G.coal.kingmakers.filter(k => k.side === 'you');
    formGovernment(extra, t.you < MAJORITY);
    return 'gov';
  }
  G.phase = 'gameover'; G.endReason = 'lost';
  save();
  return 'lost';
}

// ---------- governance ----------
function formGovernment(extraAllies, minority) {
  const r = G.result, al = r.alliances;
  const allies = [];
  for (const s of STATES) if (s.reg && al[s.id] === 'you' && r.regSeats[s.id] > 0)
    allies.push({ key: s.id, name: s.reg.name, short: s.reg.short, seats: r.regSeats[s.id], sat: 65, dislikes: s.reg.dislikes, warned: false });
  for (const k of extraAllies) {
    const s = stateById(k.key);
    allies.push({ key: k.key, name: k.name, short: k.short, seats: k.seats, sat: 50, dislikes: s ? s.reg.dislikes : (k.key === 'B' ? ['market'] : []), warned: false, pkg: (G.coal && G.coal.packages.includes(k.key)) });
  }
  const firstTerm = !G.eco;
  if (firstTerm) initEconomy();
  const prevApproval = G.gov ? G.gov.approval : null;
  const promises = G.camp.promises.slice();
  G.gov = {
    q: 0, pc: 6, passed: G.gov ? G.gov.passed : [], allies, party: r.totals.you, minority,
    rs: Math.round(clamp(70 + r.totals.you * .12 + allies.reduce((t, a) => t + a.seats, 0) * .1, 60, 140)),
    rbiCred: G.gov ? G.gov.rbiCred : 100,
    approval: prevApproval ? { ...prevApproval } : Object.fromEntries(BLOCS.map(b => [b.id, 50])),
    blocMods: Object.fromEntries(BLOCS.map(b => [b.id, 0])),
    honeymoon: 10, promises, flags: G.gov ? G.gov.flags : {}, events: [], prDone: false, rbiDone: false,
    lastBudgetQ: -1, stateElectionsWon: 0, stateElectionsLost: 0,
  };
  G.eco.b.programs = G.eco.b.programs || [];
  for (const k of G.gov.allies) if (k.pkg) G.eco.b.programs.push({ name: `${k.short} state package`, spend: .06 });
  G.incumbent = 'you';
  G.termsWon++;
  G.phase = 'gov';
  G.coal = null;
  log(`🇮🇳 ${G.leader} is sworn in as Prime Minister! Lok Sabha strength: ${govSeats()}.`, 'big');
  if (minority) log('You lead a minority government. Every vote will be a struggle.', 'bad');
  startQuarter();
}

function govSeats() { return G.gov.party + G.gov.allies.reduce((t, a) => t + a.seats, 0); }

function initEconomy() {
  G.eco = {
    gdp: 340, growth: 6.4, infl: 5.0, unemp: 7.6, repo: 6.25, debt: 56, effRate: 7.2, yld: 7.1,
    forex: 640, sensex: 82000, rating: 1, potential: 6.2,
    infraStock: 3.2, humanStock: .9, reformBoost: 0, boostQueue: [], unempMod: 0, inflMod: 0,
    oil: 0, food: 0, global: 0, shocks: [], oneTimes: [], revOnces: [], revenue: 0, spending: 0, deficit: 4.4,
    b: { itr: 30, ctr: 25, gst: 18, infra: 3.2, defence: 1.9, health: .4, education: .5, welfare: 1.4, agri: .6, programs: [], progRev: 0 },
    last: {},
  };
  computeBudget();
}

function computeBudget() {
  const e = G.eco, b = e.b;
  const laffer = (rate, base, k) => (rate / base) * (1 - k * Math.max(0, (rate - base) / base));
  const income = 3.1 * laffer(b.itr, 30, .35);
  const corp = 2.9 * laffer(b.ctr, 25, .45) * (1 + (e.growth - 6.4) * .02);
  const gst = 3.1 * laffer(b.gst, 18, .3);
  const other = 1.3 + (b.progRev || 0);
  const revOnce = e.revOnces.reduce((t, x) => t + x.amt, 0);
  const interest = e.debt * e.effRate / 100;
  const programs = b.programs.reduce((t, p) => t + p.spend, 0);
  const oneTime = e.oneTimes.reduce((t, x) => t + x.amt, 0);
  const core = b.infra + b.defence + b.health + b.education + b.welfare + b.agri + 2.6;
  e.revenue = income + corp + gst + other + revOnce;
  e.spending = core + interest + programs + oneTime;
  e.interest = interest; e.programSpend = programs;
  e.deficit = e.spending - e.revenue;
  return e.deficit;
}

function previewDeficit(budget) {
  const saved = { ...G.eco.b };
  Object.assign(G.eco.b, budget);
  const d = computeBudget();
  Object.assign(G.eco.b, saved);
  computeBudget();
  return d;
}

const BUDGET_PRESETS = {
  populist:  { icon: '🎁', name: 'Give gifts', desc: 'Help people and lower taxes. People smile, but savings go down.', d: { welfare: .4, agri: .2, itr: -1, gst: -1 } },
  balanced:  { icon: '⚖️', name: 'Keep it same', desc: 'No big changes.', d: {} },
  growth:    { icon: '🏗️', name: 'Build roads', desc: 'Build roads and schools. Good for the future.', d: { infra: .4, education: .15, health: .1, ctr: -2 } },
  austerity: { icon: '✂️', name: 'Save money', desc: 'Spend less and save. People grumble.', d: { welfare: -.3, infra: -.2, agri: -.1, gst: 1 } },
};

function budgetPreset(key) {
  const b = G.eco.b, d = BUDGET_PRESETS[key].d, draft = {};
  for (const k in BUDGET_LIMITS) {
    const L = BUDGET_LIMITS[k];
    draft[k] = Math.round(clamp(b[k] + (d[k] || 0), L.min, L.max) * 10) / 10;
  }
  const r = applyBudget(draft);
  if (!r.err) r.msg = `${BUDGET_PRESETS[key].icon} ${BUDGET_PRESETS[key].name} Budget passed. Deficit ${round1(G.eco.deficit)}% of GDP.`;
  return r;
}

// Each quarter the cabinet puts three policy cards on the table; you may play one.
function dealHand() {
  const g = G.gov;
  const open = REFORMS.filter(r => !g.passed.includes(r.id));
  const promised = open.filter(r => g.promises.some(id => PROMISES.find(p => p.id === id).check.toString().includes(`'${r.id}'`)));
  const pool = open.slice().sort(() => rand() - .5);
  const hand = [];
  if (promised.length && rand() < .6) hand.push(pick(promised).id);
  for (const r of pool) if (hand.length < 2 && !hand.includes(r.id)) hand.push(r.id);
  const cards = hand.map(id => ({ type: 'bill', id }));
  cards.push({ type: 'pm', id: pick(Object.keys(PM_ACTIONS)) });
  g.hand = cards; g.played = false;
}

function playCard(i) {
  const g = G.gov, c = g.hand[i];
  if (g.played) return { err: 'You already picked one' };
  const res = c.type === 'bill' ? introduceBill(c.id, 'vote') : pmAction(c.id);
  if (!res.err) { g.played = true; save(); }
  return res;
}

function billChance(id) {
  const st = billStatus(id);
  let lsSeats = govSeats() - st.objectors.reduce((t, a) => t + (a.sat - 15 < 35 ? a.seats : 0), 0);
  const ls = lsSeats >= MAJORITY ? 1 : clamp(.45 + (overallApproval() - 50) / 100, 0, 1);
  return ls * st.rsChance;
}

function isBudgetQuarter() { return G.calQ % 4 === 2 || G.gov.q === 0; }

function applyBudget(budget) {
  const g = G.gov, e = G.eco, old = { ...e.b };
  if (!isBudgetQuarter() || g.lastBudgetQ === g.q) return { err: 'Money Day is done for this year' };
  Object.assign(e.b, budget);
  g.lastBudgetQ = g.q;
  // immediate political reaction to headline changes
  const d = k => e.b[k] - old[k];
  if (d('itr') < 0) mod('middle', -d('itr') * 1.2);
  if (d('itr') > 0) mod('middle', -d('itr') * 1.6);
  if (d('ctr') !== 0) mod('business', -d('ctr') * 1.2);
  if (d('gst') > 0) { mod('middle', -d('gst') * .8); mod('poor', -d('gst') * .6); }
  if (d('gst') < 0) { mod('middle', -d('gst') * .5); mod('business', -d('gst') * .5); }
  computeBudget();
  log(`📒 Union Budget presented. Fiscal deficit target ${round1(e.deficit)}% of GDP.`, 'big');
  save();
  return { msg: 'Budget passed' };
}

function mod(b, x) { G.gov.blocMods[b] += x; }
function modAll(x) { for (const b of BLOCS) mod(b.id, x); }
// one-off amounts are a share of one year's GDP, booked as an annualised rate over `quarters`
function oneTime(pct, quarters = 4) { G.eco.oneTimes.push({ amt: pct * 4 / quarters, left: quarters }); }
function revOnce(pct, quarters = 4) { G.eco.revOnces.push({ amt: pct * 4 / quarters, left: quarters }); }
function growthShock(x, quarters) { G.eco.shocks.push({ g: x, i: 0, left: quarters }); }
function inflShock(x, quarters) { G.eco.shocks.push({ g: 0, i: x, left: quarters }); }
function allySat(x, key) { for (const a of G.gov.allies) if (!key || a.key === key) a.sat = clamp(a.sat + x, 0, 100); }

function overallApproval() {
  const a = G.gov.approval;
  return BLOCS.reduce((t, b) => t + a[b.id] * b.nat, 0);
}

function stateApproval(id) {
  const w = WEIGHTS[id], a = G.gov.approval;
  return BLOCS.reduce((t, b) => t + a[b.id] * w[b.id], 0);
}

function startQuarter() {
  const g = G.gov;
  g.prDone = false; g.rbiDone = false; g.reshuffleDone = false;
  g.events = [];
  dealHand();
  // scheduled events
  if (G.calQ % 4 === 1 && !g.flags.onoe) g.events.push({ id: 'stateelection', ctx: { states: pickStateElection() } });
  // random events
  const pool = GOV_EVENTS.filter(e => !e.scheduled && (!e.when || e.when(G)));
  const weighted = [];
  for (const e of pool) for (let i = 0; i < (e.weight || 1) * 2; i++) weighted.push(e);
  if (g.q > 0 || G.term > 1) {
    const e1 = pick(weighted);
    g.events.push({ id: e1.id, ctx: e1.ctx ? e1.ctx(G) : {} });
    if (rand() < .35) {
      const e2 = pick(weighted.filter(e => e.id !== e1.id));
      if (e2) g.events.push({ id: e2.id, ctx: e2.ctx ? e2.ctx(G) : {} });
    }
  }
  // ally unrest
  for (const a of g.allies) if (a.sat < 25 && !a.warned) { g.events.push({ id: 'allythreat', ctx: { key: a.key } }); a.warned = true; }
}

function pickStateElection() {
  const year = G.calQ >> 2;
  const groups = [['MH', 'HR', 'JH'], ['UP', 'PB', 'UK', 'GA'], ['WB', 'TN', 'KL', 'AS'], ['BR', 'DL', 'KA'], ['MP', 'RJ', 'CG', 'TG']];
  return groups[(year + G.term) % groups.length];
}

function resolveGovEvent(i) {
  const g = G.gov, cur = g.events[0];
  const ev = GOV_EVENTS.find(e => e.id === cur.id);
  const ch = ev.choices(G, cur.ctx)[i];
  if (!ch) return { err: 'No such choice' };
  if (ch.pc && g.pc < ch.pc) return { err: 'Not enough ⭐ energy' };
  if (ch.pc) g.pc -= ch.pc;
  const msg = ch.run(G, cur.ctx);
  G.trust = clamp(G.trust, 0, 100);
  g.events.shift();
  log(msg, 'event');
  if (G.phase !== 'gov') { save(); return { msg, phaseChange: true }; }
  save();
  return { msg };
}

// --- bills ---
function billStatus(id) {
  const r = REFORMS.find(x => x.id === id), g = G.gov;
  const objectors = g.allies.filter(a => r.tags.some(t => a.dislikes.includes(t)));
  const ls = govSeats();
  const lsOk = ls >= MAJORITY;
  const rsShort = r.money ? 0 : Math.max(0, 123 - g.rs);
  const appr = overallApproval();
  const rsChance = rsShort ? clamp(.75 - rsShort / 40 + (appr - 50) / 100, .05, .9) : 1;
  return { r, objectors, ls, lsOk, rsShort, rsChance, floorPC: Math.ceil(rsShort / 7) };
}

// mode: 'vote' | 'floor' (spend PC to win over RS) | 'moneyroute' (controversially route as money bill)
function introduceBill(id, mode = 'vote') {
  const g = G.gov, st = billStatus(id), r = st.r;
  if (g.events.length) return { err: 'Answer the news card first' };
  if (g.passed.includes(id)) return { err: 'Already law' };
  const extra = mode === 'floor' ? st.floorPC : 0;
  if (g.pc < r.pc + extra) return { err: 'Not enough ⭐ energy' };
  g.pc -= r.pc + extra;
  // allies who dislike it lose patience
  for (const a of st.objectors) a.sat = clamp(a.sat - 15, 0, 100);
  // Lok Sabha
  let lsSeats = govSeats() - st.objectors.reduce((t, a) => t + (a.sat < 35 ? a.seats : 0), 0);
  if (lsSeats < MAJORITY && rand() > .45 + (overallApproval() - 50) / 100) {
    log(`❌ ${r.name} defeated in the Lok Sabha. Allies broke ranks.`, 'bad');
    modAll(-1); save();
    return { msg: `${r.name} was defeated in the Lok Sabha.`, fail: true };
  }
  // Rajya Sabha
  if (st.rsShort && mode === 'vote' && rand() > st.rsChance) {
    log(`❌ ${r.name} blocked in the Rajya Sabha.`, 'bad');
    save();
    return { msg: `${r.name} passed the Lok Sabha but was blocked in the Rajya Sabha.`, fail: true };
  }
  if (st.rsShort && mode === 'moneyroute') {
    G.trust -= 8; modAll(-1);
    log('Opposition cries foul over routing the bill as a Money Bill. Trust −8.', 'bad');
  }
  enact(r);
  save();
  return { msg: `✅ ${r.name} is now law!` };
}

function enact(r) {
  const g = G.gov, e = G.eco;
  g.passed.push(r.id);
  for (const b in r.blocs) mod(b, r.blocs[b]);
  if (r.trust) G.trust = clamp(G.trust + r.trust, 0, 100);
  if (r.spend) e.b.programs.push({ name: r.name, spend: r.spend, grows: r.id === 'ops' });
  if (r.rev) e.b.progRev = (e.b.progRev || 0) + r.rev;
  if (r.oneTime) oneTime(r.oneTime);
  if (r.revOnce) revOnce(r.revOnce, 4);
  if (r.boost) for (let i = 0; i < 4; i++) e.boostQueue.push(r.boost / 4);
  if (r.unemp) e.unempMod += r.unemp;
  if (r.infl) e.inflMod += r.infl;
  if (r.human) e.humanStock += r.human * .3;
  if (r.shock) growthShock(r.shock, 2);
  if (r.flag) g.flags[r.flag] = true;
  if (r.id === 'lokpal') allySat(-10);
  if (r.risk) g.pendingRisk = r.risk;
  computeBudget();
  log(`✅ ${r.name} passed into law.`, 'good');
}

// --- PM actions ---
const PM_ACTIONS = {
  pr: { name: 'Speech on TV', icon: '📡', pc: 2, desc: 'Talk to the whole country. People feel good.', once: 'prDone',
    run() { const g = G.gov; g.prUses = (g.prUses || 0) + 1; modAll(4 / (1 + (g.prUses - 1) * .5)); return 'Your address to the nation strikes a chord. Approval up across the board.'; } },
  rbi: { name: 'Cheaper loans', icon: '🏦', pc: 1, desc: 'Ask the bank to make loans cheaper. Prices may go up later.', once: 'rbiDone',
    run() { const e = G.eco; e.repo = Math.max(2.5, e.repo - .5); G.gov.rbiCred = Math.max(0, G.gov.rbiCred - 15); mod('business', 2); return 'Under pressure, the RBI cuts rates by 50 bps. Markets cheer; economists worry.'; } },
  reshuffle: { name: 'New team', icon: '🔄', pc: 2, desc: 'Pick new ministers. Your friends get happy.', once: 'reshuffleDone',
    run() { G.trust = clamp(G.trust + 3, 0, 100); allySat(8); return 'A sweeping cabinet reshuffle brings in fresh faces and gives allies more posts.'; } },
};

function pmAction(id) {
  const a = PM_ACTIONS[id], g = G.gov;
  if (g.events.length) return { err: 'Answer the news card first' };
  if (g[a.once]) return { err: 'Already done. Try later!' };
  if (g.pc < a.pc) return { err: 'Not enough ⭐ energy' };
  g.pc -= a.pc; g[a.once] = true;
  const msg = a.run(); log(msg); save();
  return { msg };
}

function allyPackage(key) {
  const g = G.gov, a = g.allies.find(x => x.key === key);
  if (g.events.length) return { err: 'Answer the news card first' };
  if (g.pc < 1) return { err: 'Not enough ⭐ energy' };
  g.pc -= 1; oneTime(.12); a.sat = clamp(a.sat + 22, 0, 100); a.warned = false;
  log(`Special development package for ${stateById(key) ? stateById(key).name : a.short}. ${a.short} is pleased.`);
  computeBudget(); save();
  return { msg: `${a.short} satisfaction +22` };
}

// --- quarter simulation ---
function endQuarter() {
  const g = G.gov, e = G.eco;
  if (g.events.length) return { err: 'Answer the news card first' };
  if (isBudgetQuarter() && g.lastBudgetQ !== g.q) return { err: 'Pick the Money Day plan first' };
  const prev = { growth: e.growth, infl: e.infl, unemp: e.unemp, sensex: e.sensex, deficit: e.deficit, approval: overallApproval() };

  // shocks
  let gShock = 0, iShock = 0;
  for (const s of e.shocks) { gShock += s.g; iShock += s.i; s.left--; }
  e.shocks = e.shocks.filter(s => s.left > 0);
  if (e.boostQueue.length) e.reformBoost += e.boostQueue.shift();
  for (const p of e.b.programs) if (p.grows) p.spend += .02;

  computeBudget();
  const b = e.b;
  e.infraStock += (b.infra - e.infraStock) * .15;
  e.humanStock += ((b.health + b.education) - e.humanStock) * .06;
  // big deficits crowd out private investment and high debt drags on growth
  e.potential = 6.1 + .6 * (e.infraStock - 3.2) + 1.2 * (e.humanStock - .9) + e.reformBoost + .04 * (25 - b.ctr) - .05 * Math.max(0, b.itr - 30) - (e.rating === 0 ? .6 : 0)
    - .25 * Math.max(0, e.deficit - 5.5) - .06 * Math.max(0, e.debt - 60);
  const demand = .25 * clamp(e.deficit - 4.4, -4, 3) - .45 * (e.repo - e.infl - 1.5) + e.global - .04 * (b.gst - 18);
  const target = e.potential + demand + gShock + randn() * .35;
  e.growth = clamp(.5 * e.growth + .5 * target, -10, 13);

  const credPenalty = (100 - g.rbiCred) / 100 * 1.6;
  const oilHit = e.oil * (g.flags.green ? .5 : 1);
  const foodHit = e.food * clamp(1 - (b.agri - .6) * .6, .3, 1.3);
  const iTarget = 4.2 + .4 * (e.growth - e.potential) + .45 * (e.deficit - 4.4) - .35 * (e.repo - 6.25) + oilHit + foodHit + .06 * (b.gst - 18) + credPenalty + e.inflMod + iShock;
  e.infl = clamp(e.infl + .4 * (iTarget - e.infl) + randn() * .2, -1, 18);
  e.oil *= .6; e.food *= .5; e.global *= .75;

  const uTarget = 7.6 - .45 * (e.growth - 6.4) + e.unempMod;
  e.unemp = clamp(e.unemp + .25 * (uTarget - e.unemp), 2.5, 20);

  // RBI follows its inflation mandate
  const repoTarget = clamp(2.2 + e.infl + .5 * (e.infl - 4) + .25 * (e.growth - e.potential), 3, 10);
  const step = Math.abs(repoTarget - e.repo) > 1 ? .5 : .25;
  if (Math.abs(repoTarget - e.repo) >= .25) e.repo += Math.sign(repoTarget - e.repo) * step;
  g.rbiCred = Math.min(100, g.rbiCred + 3);

  const ratingAdj = [1.2, .3, 0, -.2, -.4][e.rating];
  e.yld = 6.3 + .2 * (e.deficit - 4.4) + .05 * (e.debt - 56) + .4 * (e.repo - 6.25) + ratingAdj;
  e.effRate += (e.yld - e.effRate) * .1;
  const nominal = e.growth + e.infl;
  e.debt = clamp(e.debt + e.deficit / 4 - e.debt * (nominal / 100) / 4, 10, 200);
  e.gdp *= 1 + nominal / 400;
  e.sensex *= 1 + (e.growth - 6) * .006 + (g.approval.business - 50) * .0006 + randn() * .035 + gShock * .01;
  e.forex = Math.max(150, e.forex + 6 - e.oil * 15 + (e.growth - 6) * 3 + randn() * 8);

  for (const x of e.oneTimes) x.left--;
  e.oneTimes = e.oneTimes.filter(x => x.left > 0);
  for (const x of e.revOnces) x.left--;
  e.revOnces = e.revOnces.filter(x => x.left > 0);
  computeBudget();

  e.last = prev;
  updateApproval();
  updateAllies();

  // rating review every year
  if (G.calQ % 4 === 3) ratingReview();

  const appr = overallApproval();
  g.pc = Math.min(15, g.pc + clamp(3 + Math.round((appr - 45) / 8), 1, 6));
  g.honeymoon *= .75;

  for (const k of ['growth', 'infl', 'unemp', 'deficit', 'debt']) G.hist[k].push(round1(e[k]));
  G.hist.approval.push(round1(appr));
  G.hist.sensex.push(Math.round(e.sensex));
  G.quartersAsPM++;

  g.q++; G.calQ++;
  if (govSeats() < MAJORITY && !g.minority && !g.events.some(x => x.id === 'noconfidence')) {
    g.minority = true;
  }
  if (g.q >= 20) { endTerm(); save(); return { termEnd: true }; }
  startQuarter();
  if (g.pendingRisk) { g.events.unshift({ id: g.pendingRisk, ctx: {} }); g.pendingRisk = null; }
  if (govSeats() < MAJORITY && appr < 42 && rand() < .5) g.events.unshift({ id: 'noconfidence', ctx: {} });
  save();
  return {};
}

function approvalTargets() {
  const e = G.eco, b = e.b, g = G.gov;
  const iDev = Math.max(0, e.infl - 4);
  const dpi = g.flags.dpi ? 1.15 : 1;
  const sec = (b.defence - 1.9) * 2;
  const t = {
    farmers: 45 + (b.agri - .6) * 28 - 1.5 * iDev + (e.food > .5 ? -4 : 0),
    poor: 45 + (b.welfare - 1.4) * 12 * dpi + (b.health - .4) * 8 - 3 * iDev - (e.unemp - 7.6),
    workers: 46 - 3 * (e.unemp - 7.6) - 2 * iDev + (e.growth - 6.4),
    middle: 45 + 1.2 * (30 - b.itr) - 2.5 * iDev + 1.5 * (e.growth - 6.4) - .4 * (b.gst - 18) + sec,
    youth: 46 - 4 * (e.unemp - 7.6) + (b.education - .5) * 15 + 1.5 * (e.growth - 6.4) + sec * .5,
    business: 47 + 1.2 * (25 - b.ctr) + 3 * (e.growth - 6.4) - 2 * (e.repo - 6.25) + clamp((e.sensex / (e.last.sensex || e.sensex) - 1) * 100, -15, 15) * .4 - .4 * (b.gst - 18) - (e.rating === 0 ? 6 : 0),
  };
  // voters punish governments that run the books into the ground
  const fiscal = -2 * Math.max(0, e.deficit - 6) - (e.rating === 0 ? 3 : 0);
  for (const k in t) t[k] += clamp(g.blocMods[k], -25, 25) + g.honeymoon + (G.trust - 50) * .1 + fiscal;
  return t;
}

function updateApproval() {
  const g = G.gov, t = approvalTargets();
  for (const b of BLOCS) {
    g.approval[b.id] = clamp(g.approval[b.id] + .35 * (clamp(t[b.id], 3, 97) - g.approval[b.id]), 2, 98);
    g.blocMods[b.id] *= .85;
  }
}

function updateAllies() {
  const g = G.gov;
  for (const a of g.allies) {
    const st = stateById(a.key);
    const appr = st ? stateApproval(a.key) : overallApproval();
    const target = 55 + (appr - 50) * .6;
    a.sat = clamp(a.sat + (target - a.sat) * .2, 0, 100);
    if (a.sat > 35) a.warned = false;
  }
  const leaving = g.allies.filter(a => a.sat < 8);
  for (const a of leaving) {
    g.allies = g.allies.filter(x => x !== a);
    log(`💔 ${a.short} (${a.seats} MPs) has walked out of your coalition!`, 'bad');
    if (govSeats() < MAJORITY) g.pendingRisk = 'noconfidence';
  }
}

function ratingReview() {
  const e = G.eco;
  if ((e.deficit > 6.2 || e.debt > 68) && e.rating > 0) {
    e.rating--; e.sensex *= .92;
    log(`📉 Rating agencies downgrade India to ${RATINGS[e.rating]}. Borrowing costs rise.`, 'bad');
    if (e.rating === 0) { modAll(-3); e.forex -= 40; }
  } else if (e.deficit < 4 && e.growth > 6.8 && e.debt < 60 && e.rating < 4) {
    e.rating++; e.sensex *= 1.05;
    log(`📈 Rating upgrade! India is now ${RATINGS[e.rating]}.`, 'good');
    mod('business', 4);
  } else log(`Rating agencies keep India at ${RATINGS[e.rating]}.`);
}

function governmentFalls(reason) {
  log(`🏛️ ${reason} Your government has fallen. The President dissolves the Lok Sabha.`, 'big');
  G.endReasonPending = reason;
  goToElection(true);
}

function endTerm() {
  // evaluate promises
  const kept = [], broken = [];
  for (const id of G.gov.promises) {
    const p = PROMISES.find(x => x.id === id);
    if (p.check(G)) kept.push(p); else broken.push(p);
  }
  for (const p of kept) { G.trust += 4; for (const b in p.blocs) if (p.blocs[b] > 0) G.gov.approval[b] = clamp(G.gov.approval[b] + 3, 0, 100); }
  for (const p of broken) { G.trust -= 6; for (const b in p.blocs) if (p.blocs[b] > 0) G.gov.approval[b] = clamp(G.gov.approval[b] - 4, 0, 100); }
  G.trust = clamp(G.trust, 0, 100);
  G.promisesKept += kept.length; G.promisesBroken += broken.length;
  const e = G.eco;
  G.report = {
    term: G.term, kept: kept.map(p => p.name), broken: broken.map(p => p.name),
    growth: round1(avg(G.hist.growth.slice(-20))), infl: round1(avg(G.hist.infl.slice(-20))),
    unemp: round1(e.unemp), debt: round1(e.debt), gdp: Math.round(e.gdp), approval: round1(overallApproval()),
    reforms: G.gov.passed.length,
  };
  G.phase = 'termreport';
}

function goToElection(snap) {
  // your record becomes your base in each state
  for (const s of STATES) {
    const a = stateApproval(s.id);
    const d = (a - 50) * .35;
    G.shift[s.id] = [d - 3, -d * .3, 0, 0]; // -3: anti-incumbency
  }
  G.appeal.A = { ...RIVAL_APPEAL.A };
  G.term++;
  G.incumbent = 'you';
  startCampaign({ weeks: snap ? 5 : 7, funds: 240 + Math.round(overallApproval() * 2), first: false, snap });
  log(snap ? 'Snap elections are called. Six weeks to save your premiership.' : `Five years done. The nation votes again. Campaign for term ${G.term}!`, 'big');
  save();
}

function legacyScore() {
  const yrs = G.quartersAsPM / 4;
  const g = avg(G.hist.growth);
  const score = Math.round(yrs * 120 + Math.max(0, g) * 40 * Math.min(yrs, 10) / 5 + G.promisesKept * 40 - G.promisesBroken * 25 + (G.gov ? G.gov.passed.length * 15 : 0));
  let title = 'New Leader 🌱';
  if (yrs === 0) title = 'Brave Fighter 💪';
  else if (score > 2600) title = 'Legend of India 🏆';
  else if (score > 1800) title = 'Super PM 🌟';
  else if (score > 1100) title = 'Great PM 👏';
  else if (score > 500) title = 'Good PM 🙂';
  return { score: Math.max(0, score), title, yrs };
}

// ---------- save ----------
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { /* storage unavailable */ } }
function load() {
  try { const s = localStorage.getItem(SAVE_KEY); if (s) { G = JSON.parse(s); return true; } } catch (e) { /* ignore */ }
  return false;
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
