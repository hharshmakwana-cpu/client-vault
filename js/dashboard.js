'use strict';
// Overview dashboard.

// ---------- dashboard ----------
function renderDash() {
  const L = dueLists(), today = L.today, monthEnd = ymd(+today.slice(0, 4), +today.slice(5, 7), new Date(+today.slice(0, 4), +today.slice(5, 7), 0).getDate());
  const fees = S.clients.map(c => [c, feeTotals(c)]), outstanding = fees.reduce((s, [, f]) => s + Math.max(0, f.due), 0);
  const pw = L.open.filter(t => t.kind === 'pw' && t.due <= addDays(today, 7));
  let html = bar({ title: 'Overview', big: true });
  html += `<h1 class="large" data-big>Overview</h1>`;
  html += `<div class="tiles two">
    <button class="tile" data-act="list"><b>${S.clients.length}</b><span>Clients</span></button>
    <button class="tile red" data-act="due" data-f="overdue"><b>${L.overdue.length}</b><span>Overdue filings</span></button>
    <button class="tile amber" data-act="due" data-f="week"><b>${L.week.length}</b><span>Due this week</span></button>
    <div class="tile blue"><b>${inr(outstanding)}</b><span>Fees outstanding</span></div></div>`;
  if (pw.length) html += `<button class="banner" data-act="due" data-f="open">${plural(pw.length, 'portal password')} due for a change.</button>`;
  // filings due this month, by return
  const month = collectDue(monthEnd).filter(t => t.kind === 'task' && t.due.slice(0, 7) === today.slice(0, 7));
  const byRet = {};
  for (const t of month) { const k = t.def.name; (byRet[k] ||= { done: 0, total: 0 }).total++; if (DONE.has(t.status)) byRet[k].done++; }
  const rets = Object.entries(byRet);
  if (rets.length) html += `<div class="group-h">${MON[+today.slice(5, 7) - 1]} filings</div><div class="group">${rets.map(([k, v]) => `<div class="row stat"><span class="grow">${esc(k)}<span class="bar-track"><span class="bar-fill" style="width:${Math.round(v.done / v.total * 100)}%"></span></span></span><span class="amt">${v.done}/${v.total}</span></div>`).join('')}</div>`;
  // clients by status
  const counts = {}; S.clients.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  html += `<div class="group-h">Clients by status</div><div class="group">${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row stat"><span class="grow">${esc(k)}<span class="bar-track"><span class="bar-fill" style="width:${Math.round(v / max * 100)}%"></span></span></span><span class="amt">${v}</span></div>`).join('') || '<div class="row"><span class="grow">No clients yet</span></div>'}</div>`;
  const top = fees.filter(([, f]) => f.due > 0).sort((a, b) => b[1].due - a[1].due).slice(0, 5);
  if (top.length) html += `<div class="group-h">Highest outstanding fees</div><div class="group">${top.map(([c, f]) => `<button class="row lrow" data-act="open" data-id="${esc(c.id)}">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>Billed ${inr(f.billed)}</small></span><span class="amt due">${inr(f.due)}</span></button>`).join('')}</div>`;
  const recent = [...S.clients].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 5);
  if (recent.length) html += `<div class="group-h">Recently updated</div><div class="group">${recent.map(c => `<button class="row lrow" data-act="open" data-id="${esc(c.id)}">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>${fmtDate(c.updated)}</small></span><span class="chev">${I.chev}</span></button>`).join('')}</div>`;
  app.innerHTML = html;
  ACT.list = () => goBack('list');
  ACT.due = b => { DUEF = b.dataset.f; go('due'); };
  ACT.open = b => go('detail', b.dataset.id);
}
