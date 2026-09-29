// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Acting appointments (HR): while a supervisor / head of component / chief director is away,
// someone on an appropriate level acts for them and decides their team's leave.
import { APPROVED, isAdmin, isActingNow, actingCheck, actingOverlap, payLabel, fmtDate, fmtDateTime, today, ROLE_LABELS } from '../logic.js';
import { esc, $, toast, busy, options, empty, confirmBox } from '../ui.js';
import { reload } from '../app.js';

export async function render(main, ctx) {
  const { settings, byId } = ctx;
  const privs = Object.fromEntries((await ctx.api.privateAll()).map((p) => [p.id, p]));
  const level = (id) => privs[id]?.salary_level || '';
  const below = Number(settings.acting_levels_below ?? 1);
  const needsUpdate = settings.acting_levels_below === undefined;
  const t = today();
  const name = (id) => byId[id]?.full_name || '(removed)';
  const pay = payLabel(settings.mode);

  // HR can appoint an acting person for anyone; people who supervise or manage staff are listed first.
  const people = ctx.profiles.filter((p) => p.active);
  const leads = (p) => p.role === 'approver' || people.some((x) => x.supervisor_id === p.id || x.manager_id === p.id);
  const heads = [...people.filter(leads), ...people.filter((p) => !leads(p))];
  const admin = isAdmin(ctx.me);
  const current = ctx.acting.filter((a) => !a.cancelled_at && a.end_date >= t);
  const past = ctx.acting.filter((a) => a.cancelled_at || a.end_date < t).slice(0, 30);
  const teamOf = (id) => ctx.profiles.filter((x) => x.active && (x.supervisor_id === id || x.manager_id === id)).length;

  const row = (a, live) => `<tr data-id="${esc(a.id)}">
    <td><strong>${esc(name(a.acting_id))}</strong><small class="muted">${esc(pay)} ${esc(level(a.acting_id) || '?')}</small></td>
    <td>${esc(name(a.principal_id))}<small class="muted">${esc(byId[a.principal_id]?.job_title || '')}</small></td>
    <td>${esc(fmtDate(a.start_date))} – ${esc(fmtDate(a.end_date))}${live && isActingNow(a) ? ' <span class="badge ok">Acting now</span>' : ''}</td>
    <td>${esc(a.reason || '')}${a.cancelled_at ? `<small class="muted">Ended early ${esc(fmtDateTime(a.cancelled_at))}</small>` : ''}</td>
    ${live ? `<td><button class="btn small" data-end>${isActingNow(a) ? 'End now' : 'Withdraw'}</button></td>` : ''}
  </tr>`;
  const table = (list, live) => `<div class="table-wrap"><table class="list acting-table">
    <thead><tr><th>Acting</th><th>For</th><th>Dates</th><th>Reason</th>${live ? '<th></th>' : ''}</tr></thead>
    <tbody>${list.map((a) => row(a, live)).join('')}</tbody></table></div>`;

  main.innerHTML = `
    <div class="page-head"><h1>Acting appointments</h1></div>
    ${needsUpdate ? '<p class="card alert" role="alert">Your database needs update <strong>006-acting-appointments.sql</strong> before acting appointments can be saved. Run it in the Supabase SQL Editor (see the README).</p>' : ''}
    <p class="muted">When a supervisor, head of component or chief director is out of office, appoint someone to act for them. For those dates the acting person sees and decides their team's leave (and can recall staff). Decisions are logged as "acting for …". The person who recommended an application can't also approve it, so there are always two signatures.</p>
    <form class="card" id="appoint">
      <h2>Appoint someone to act</h2>
      <div class="form-grid">
        <label>Acting for <select name="principal" required><option value="">Choose…</option>${options(heads.map((p) => [p.id, `${p.full_name}${p.job_title ? ` — ${p.job_title}` : ''}${level(p.id) ? ` (${pay.toLowerCase()} ${level(p.id)})` : ''}`]))}</select></label>
        <label>Acting person <select name="acting" required disabled><option value="">Choose who they are acting for first</option></select></label>
        <label>From <input type="date" name="start" required value="${t}"></label>
        <label>To <input type="date" name="end" required></label>
        <label class="full"><span>Reason <span class="opt">(optional)</span></span><input name="reason" placeholder="e.g. Chief Director on annual leave"></label>
      </div>
      <p class="muted" id="hint"></p>
      <button class="btn primary">Appoint</button>
    </form>
    <section class="card"><h2>Current and upcoming</h2>${current.length ? table(current, true) : empty('Nobody is acting for anyone.')}</section>
    <form class="card" id="rule">
      <h2>Level rule</h2>
      <p class="muted">The acting person must be on the same ${esc(pay.toLowerCase())} as the person they act for, or at most this many levels below. Check this against your department's delegations and the DPSA acting allowance directive.${admin ? '' : ' Only the admin can change this rule.'}</p>
      <div class="form-grid"><label>Levels below allowed <input type="number" name="below" min="0" max="5" value="${below}" ${admin ? '' : 'disabled'}></label></div>
      ${admin ? '<button class="btn">Save rule</button>' : ''}
    </form>
    ${past.length ? `<section class="card"><h2>Past</h2>${table(past, false)}</section>` : ''}`;

  const form = $('#appoint', main);
  const actingSel = form.elements.acting;
  const hint = $('#hint', main);
  form.elements.principal.onchange = () => {
    const pid = form.elements.principal.value;
    hint.textContent = '';
    if (!pid) { actingSel.disabled = true; actingSel.innerHTML = '<option value="">Choose who they are acting for first</option>'; return; }
    // Eligible people first (highest level first); others shown but disabled, with the reason.
    const choices = people.filter((p) => p.id !== pid).map((p) => ({ p, chk: actingCheck(level(pid), level(p.id), below) }))
      .sort((a, b) => (b.chk.ok - a.chk.ok) || ((parseInt(level(b.p.id), 10) || 0) - (parseInt(level(a.p.id), 10) || 0)) || a.p.full_name.localeCompare(b.p.full_name));
    actingSel.disabled = false;
    actingSel.innerHTML = `<option value="">Choose…</option>${choices.map(({ p, chk }) =>
      `<option value="${esc(p.id)}" ${chk.ok ? '' : 'disabled'}>${esc(p.full_name)} — ${esc(p.job_title || ROLE_LABELS[p.role] || '')} (${esc(chk.why)})</option>`).join('')}`;
    if (!level(pid)) hint.textContent = `Record ${name(pid)}'s ${pay.toLowerCase()} under Employees first, so the level can be checked.`;
    else if (!choices.some((c) => c.chk.ok)) hint.textContent = `Nobody is on a suitable level. Record ${pay.toLowerCase()}s under Employees, or change the level rule below.`;
    else hint.textContent = `${teamOf(pid)} staff report to ${name(pid)}.`;
    // Suggest the dates of their approved leave, if they are on leave now or soon.
    const leave = ctx.requests.filter((r) => r.employee_id === pid && APPROVED.includes(r.status) && r.end_date >= t)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    if (leave) {
      form.elements.start.value = leave.start_date < t ? t : leave.start_date;
      form.elements.end.value = leave.end_date;
      hint.textContent += ` Dates filled in from their approved leave (${fmtDate(leave.start_date)} – ${fmtDate(leave.end_date)}).`;
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const [pid, aid, start, end] = ['principal', 'acting', 'start', 'end'].map((k) => String(f.get(k) || ''));
    if (!pid || !aid || !start || !end) { toast('Choose both people and the dates.', 'bad'); return; }
    if (end < start) { toast('The end date is before the start date.', 'bad'); return; }
    const clash = actingOverlap(ctx.acting, pid, start, end);
    if (clash) { toast(clash, 'bad'); return; }
    busy(e.submitter, async () => {
      await ctx.api.createActing(pid, aid, start, end, String(f.get('reason') || '').trim());
      toast(`${name(aid)} will act for ${name(pid)} from ${fmtDate(start)} to ${fmtDate(end)}`);
      reload();
    });
  };
  $('#rule', main).onsubmit = (e) => {
    e.preventDefault();
    const n = Number(e.target.elements.below.value);
    if (!Number.isInteger(n) || n < 0 || n > 5) { toast('Use a whole number from 0 to 5.', 'bad'); return; }
    busy(e.submitter, async () => { await ctx.api.saveSettings({ acting_levels_below: n }); toast('Level rule saved'); reload(); });
  };
  main.querySelectorAll('[data-end]').forEach((b) => {
    const a = ctx.acting.find((x) => x.id === b.closest('tr').dataset.id);
    b.onclick = async () => {
      if (!await confirmBox(`${isActingNow(a) ? 'End' : 'Withdraw'} ${name(a.acting_id)}'s acting appointment for ${name(a.principal_id)}?`, b.textContent)) return;
      busy(b, async () => { await ctx.api.endActing(a.id); toast('Acting appointment ended'); reload(); });
    };
  });
}
