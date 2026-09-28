// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Dashboard (who is out today / coming up, my balances) and the month team calendar.
import { today, addDays, iso, parse, fmtDate, computeBalances, APPROVED, PENDING, canDecide, isHR } from '../logic.js';
import { esc, empty, days } from '../ui.js';
import { themeOf, DESK_SVG } from '../theme.js';
import { exportWorkbook, whoIsOutSheet } from '../reports.js';
import { respondRecallDialog } from './leave.js';
import { reload } from '../app.js';

const typeName = (ctx, code) => ctx.types.find((t) => t.code === code)?.name || '';

function personRow(ctx, r, { showUntil = true } = {}) {
  const pending = PENDING.includes(r.status);
  const type = r.leave_type ? typeName(ctx, r.leave_type) : '';
  const when = showUntil
    ? (r.part_day ? 'Part of the day' : r.end_date === today() ? 'Back tomorrow' : `Until ${fmtDate(r.end_date)}`)
    : (r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`);
  return `<li class="person${pending ? ' tentative' : ''}">
    <span class="avatar" aria-hidden="true">${esc(r.full_name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
    <span class="grow"><strong>${esc(r.full_name)}</strong><small>${esc(r.department || '')}${type ? ` · ${esc(type)}` : ''}</small></span>
    <span class="when">${esc(when)}${pending ? '<small>awaiting approval</small>' : ''}</span>
  </li>`;
}

export async function render(main, ctx) {
  const { api, me } = ctx;
  const t = today();
  const monday = (() => { const d = parse(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); })();
  const [todayList, upcoming, week, overrides, myPriv] = await Promise.all([
    api.whoIsOut(t, t), api.whoIsOut(addDays(t, 1), addDays(t, 30)), api.whoIsOut(monday, addDays(monday, 4)),
    api.balanceOverrides(me.id), api.privateOf(me.id),
  ]);
  const outToday = todayList.filter((r) => APPROVED.includes(r.status));
  const outWeek = new Set(week.filter((r) => APPROVED.includes(r.status)).map((r) => r.employee_id)).size;
  const toDecide = ctx.requests.filter((r) => PENDING.includes(r.status) && canDecide(r, me)).length;
  const myPending = ctx.requests.filter((r) => r.employee_id === me.id && PENDING.includes(r.status)).length;
  const balances = computeBalances({ profile: me, types: ctx.types, requests: ctx.requests.filter((r) => r.employee_id === me.id), overrides, mode: ctx.settings.mode, gender: myPriv?.gender || '' });
  const annual = balances.find((b) => b.type.code === 'annual');
  const upcomingFiltered = upcoming.filter((r) => r.start_date > t);
  const recallAsks = ctx.requests.filter((r) => r.employee_id === me.id && r.recall_request_end);
  const approver = toDecide > 0 || me.role === 'approver' || isHR(me);

  main.innerHTML = `
    <div class="page-head"><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${esc(me.full_name.split(' ')[0])}</h1>
      <a class="btn primary" href="#/apply">Apply for leave</a></div>
    ${recallAsks.map((r) => `<div class="card alert" role="alert"><strong>${esc(ctx.byId[r.recall_request_by]?.full_name || 'Your manager')} asks you to return early</strong>
      <span>from ${esc(typeName(ctx, r.leave_type))} (${esc(fmtDate(r.start_date))} – ${esc(fmtDate(r.end_date))}): last day would be ${esc(fmtDate(r.recall_request_end))}. “${esc(r.recall_request_reason)}”</span>
      <button class="btn primary" data-recall="${esc(r.id)}">Answer</button></div>`).join('')}
    <section class="tiles">
      <div class="tile"><span class="label">Out today</span><span class="value">${outToday.length}</span><span class="sub">of ${ctx.profiles.filter((p) => p.active).length} staff</span></div>
      <div class="tile"><span class="label">Out this week</span><span class="value">${outWeek}</span><span class="sub">Mon–Fri, approved</span></div>
      ${approver
    ? `<a class="tile link" href="#/approvals"><span class="label">Awaiting your decision</span><span class="value">${toDecide}</span><span class="sub">open approvals</span></a>`
    : `<a class="tile link" href="#/mine"><span class="label">My pending requests</span><span class="value">${myPending}</span><span class="sub">awaiting approval</span></a>`}
      <a class="tile link" href="#/mine"><span class="label">My annual leave left</span><span class="value">${annual && annual.available != null ? Number(annual.available).toLocaleString('en-ZA', { maximumFractionDigits: 2 }) : '–'}</span><span class="sub">${annual ? `of ${annual.entitled ?? '–'} for ${parse(annual.period.start).getFullYear()}` : ''}</span></a>
    </section>
    <div class="grid-2">
      <section class="card">${outBanner(ctx, outToday.length)}<h2>Who's out today</h2>
        ${outToday.length ? `<ul class="people">${outToday.map((r) => personRow(ctx, r)).join('')}</ul>` : empty('Everyone is in today.')}
      </section>
      <section class="card"><h2>Coming up <small>next 30 days</small></h2>
        ${upcomingFiltered.length ? `<ul class="people">${upcomingFiltered.map((r) => personRow(ctx, r, { showUntil: false })).join('')}</ul>` : empty('No leave planned in the next 30 days.')}
        <p><a href="#/calendar">Open the team calendar →</a></p>
      </section>
    </div>
    <section class="card"><h2>My balances</h2>${balanceCards(balances.filter((b) => b.entitled != null || b.used || b.pending))}</section>`;
  main.querySelectorAll('[data-recall]').forEach((b) => { b.onclick = () => respondRecallDialog(ctx, ctx.requests.find((r) => r.id === b.dataset.recall), reload); });
}

// Picture at the top of "Who's out today", chosen by the admin in Settings → Appearance.
function outBanner(ctx, n) {
  const img = themeOf(ctx.settings).out_image;
  if (!img) return '';
  const label = `<span class="banner-count">${n === 0 ? 'Everyone is in today' : `${n} ${n === 1 ? 'person' : 'people'} out today`}</span>`;
  if (img === 'builtin:desk') return `<div class="out-banner">${DESK_SVG}${label}</div>`;
  return `<div class="out-banner photo" style="background-image:url('${esc(img).replace(/'/g, '%27')}')" role="img" aria-label="Office picture">${label}</div>`;
}

export function balanceCards(rows) {
  if (!rows.length) return empty('No balances to show.');
  return `<div class="balances">${rows.map((b) => {
    const pct = b.entitled ? Math.max(0, Math.min(100, ((b.used + b.pending) / (b.entitled + b.carried)) * 100)) : 0;
    return `<div class="balance">
      <div class="b-head"><span>${esc(b.type.name)}</span><strong>${b.available == null ? `${days(b.used)} taken` : `${Number(b.available).toLocaleString('en-ZA', { maximumFractionDigits: 2 })} left`}</strong></div>
      ${b.entitled != null ? `<div class="meter" role="img" aria-label="${Math.round(pct)}% used"><span style="width:${pct}%"></span></div>` : ''}
      <small>${b.entitled != null ? `${b.entitled}${b.carried ? ` + ${b.carried} carried` : ''} allowed · ` : 'No fixed allowance · '}${b.used} taken${b.pending ? ` · ${b.pending} pending` : ''} · cycle ${fmtDate(b.period.start)} – ${fmtDate(b.period.end)}</small>
    </div>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ team calendar

let month = null;
let dept = '';

export async function renderCalendar(main, ctx) {
  if (!month) month = today().slice(0, 7) + '-01';
  const first = month;
  const last = addDays(iso(new Date(parse(first).getFullYear(), parse(first).getMonth() + 1, 1)), -1);
  const n = parse(last).getDate();
  const rows = await ctx.api.whoIsOut(first, last);
  const holidays = new Map(ctx.holidays.map((h) => [h.date, h.name]));
  const depts = [...new Set(ctx.profiles.map((p) => p.department).filter(Boolean))].sort();
  const shown = rows.filter((r) => !dept || r.department === dept);
  const people = [...new Map(shown.map((r) => [r.employee_id, r.full_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const dates = Array.from({ length: n }, (_, i) => addDays(first, i));
  const label = parse(first).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

  main.innerHTML = `
    <div class="page-head"><h1>Team calendar</h1>
      <div class="row">
        <button class="btn" data-m="-1" aria-label="Previous month">‹</button>
        <strong class="month-label">${esc(label)}</strong>
        <button class="btn" data-m="1" aria-label="Next month">›</button>
        <button class="btn" data-m="0">This month</button>
        <select id="dept" aria-label="Department"><option value="">All departments</option>${depts.map((d) => `<option ${d === dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        <button class="btn" id="xlsx">Export to Excel</button>
      </div></div>
    <section class="card">
      ${people.length ? `<div class="cal-wrap"><table class="cal">
        <thead><tr><th class="name">Name</th>${dates.map((d) => {
    const dow = parse(d).getDay();
    const cls = [dow === 0 || dow === 6 ? 'we' : '', holidays.has(d) ? 'hol' : '', d === today() ? 'today' : ''].join(' ');
    return `<th class="${cls}" title="${esc(holidays.get(d) || '')}">${parse(d).getDate()}<small>${'SMTWTFS'[dow]}</small></th>`;
  }).join('')}</tr></thead>
        <tbody>${people.map(([id, name]) => {
    const mine = shown.filter((r) => r.employee_id === id);
    return `<tr><th class="name">${esc(name)}</th>${dates.map((d) => {
      const r = mine.find((x) => x.start_date <= d && x.end_date >= d);
      const dow = parse(d).getDay();
      const off = dow === 0 || dow === 6 || holidays.has(d);
      if (!r) return `<td class="${off ? 'we' : ''}"></td>`;
      const tip = `${name}: ${r.leave_type ? typeName(ctx, r.leave_type) + ', ' : ''}${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}${PENDING.includes(r.status) ? ' (awaiting approval)' : ''}`;
      // Weekends and public holidays are not leave days (except leave counted in calendar days,
      // such as maternity): show only a faint link there so the bar reads as one period.
      const calendarType = r.leave_type && ctx.types.find((t) => t.code === r.leave_type)?.calendar_days;
      if (off && !calendarType) return `<td class="we"><span class="bar gap" title="${esc(`${tip}. Not a leave day (${holidays.get(d) || 'weekend'})`)}"></span></td>`;
      return `<td class="${off ? 'we' : ''}"><span class="bar ${PENDING.includes(r.status) ? 'tentative' : ''} ${r.part_day ? 'part' : ''}" title="${esc(tip)}"></span></td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table></div>
      <p class="legend"><span class="bar"></span> Approved <span class="bar tentative"></span> Awaiting approval <span class="swatch we"></span> Weekend / public holiday (not counted as leave)</p>`
    : empty('Nobody has leave booked this month.')}
    </section>`;
  main.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    const k = Number(b.dataset.m);
    const d = parse(first);
    month = k === 0 ? today().slice(0, 7) + '-01' : iso(new Date(d.getFullYear(), d.getMonth() + k, 1));
    renderCalendar(main, ctx);
  });
  main.querySelector('#dept').onchange = (e) => { dept = e.target.value; renderCalendar(main, ctx); };
  main.querySelector('#xlsx').onclick = () => exportWorkbook([whoIsOutSheet(ctx, shown, label)], `whos-out-${first.slice(0, 7)}${dept ? `-${dept}` : ''}`);
}
