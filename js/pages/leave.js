// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Apply for leave, My leave (balances, history, leave log) and the request detail dialog.
import {
  computeBalances, countLeaveDays, partDayFraction, today, fmtDate, fmtDateTime, canDecide, canCancel,
  decisionsFor, DECISIONS, isHR, STATUS_LABELS, initialRouting, staffNumberLabel, typesFor,
  canReturnEarly, canRecall, canRespondRecall, EVENT_LABELS, addDays, workDaysOf, isWorkDay, describeWorkDays, actingToday, actsFor,
} from '../logic.js';
import { esc, $, toast, dialog, statusBadge, dateRange, days, empty, busy, download, options } from '../ui.js';
import { balanceCards } from './dashboard.js';
import { leaveFormData, activeTemplate, fill, formFileName } from '../forms.js';
import { go, reload } from '../app.js';
import { exportWorkbook, leaveSheet, balancesSheet } from '../reports.js';

// ------------------------------------------------------------------ apply

export async function renderApply(main, ctx) {
  const { api, me, settings } = ctx;
  const [overrides, myPriv] = await Promise.all([api.balanceOverrides(me.id), api.privateOf(me.id)]);
  const gender = myPriv.gender || '';
  const balances = computeBalances({ profile: me, types: ctx.types, requests: ctx.requests.filter((r) => r.employee_id === me.id), overrides, mode: settings.mode, gender });
  // Only leave this person can take in this mode (e.g. no maternity leave for men).
  const types = typesFor(ctx.types, settings.mode, gender);
  const holidays = new Set(ctx.holidays.map((h) => h.date));
  const gov = settings.mode === 'government';
  const approverNote = (() => {
    const route = initialRouting(me, settings.mode);
    const sup = ctx.byId[route.supervisor_id]; const mgr = ctx.byId[route.manager_id];
    if (sup && mgr) return `Goes to ${sup.full_name} (recommends), then ${mgr.full_name} (approves), then HR.`;
    return mgr ? `Goes to ${mgr.full_name} for approval.` : 'You have no supervisor or manager set, so HR will approve this.';
  })();

  main.innerHTML = `
    <div class="page-head"><h1>Apply for leave</h1></div>
    <form id="apply" class="card form-grid">
      <label class="full">Type of leave
        <select name="leave_type" required>${types.map((t) => {
    const b = balances.find((x) => x.type.code === t.code);
    const left = b && b.available != null ? ` (${Number(b.available).toLocaleString('en-ZA', { maximumFractionDigits: 2 })} days left)` : '';
    return `<option value="${esc(t.code)}">${esc(t.name)}${left}</option>`;
  }).join('')}</select></label>
      <label>Start date <input type="date" name="start_date" required value="${today()}"></label>
      <label>End date <input type="date" name="end_date" required value="${today()}"></label>
      <label class="full check part-toggle"><input type="checkbox" name="part_day"> Only part of a day${gov ? ' (Section B of the Z1)' : ''}</label>
      <label class="part">From <input type="time" name="start_time" value="08:00"></label>
      <label class="part">To <input type="time" name="end_time" value="12:00"></label>
      <label class="full special"><span>Type of special leave <span class="opt">(optional)</span></span> <input name="special_type" placeholder="e.g. examination leave, bereavement"></label>
      <p class="full parental-note muted">Parents share <strong>4 months and 10 days</strong> of parental leave (Constitutional Court, <em>Van Wyk</em>, 2025). If the other parent is also employed, say in the remarks how you are splitting it; HR then sets your share. A birth mother may not work for 6 weeks after the birth unless a doctor or midwife certifies her fit.</p>
      <label class="full union"><span>Union affiliation <span class="opt">(optional)</span></span> <input name="union_affiliation"></label>
      ${gov ? '<label class="full"><span>Address during the leave period <span class="opt">(optional)</span></span> <input name="leave_address" autocomplete="street-address"></label>' : ''}
      <label class="full"><span>Reason / remarks <span class="opt">(optional)</span></span> <textarea name="reason" rows="2"></textarea></label>
      <label class="full evidence"><span>Supporting evidence, e.g. medical certificate <span class="opt">(optional)</span></span>
        <input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></label>
      <div class="full summary" id="summary" aria-live="polite"></div>
      <p class="full muted">${esc(approverNote)}</p>
      <div class="full"><button class="btn primary">Submit application</button></div>
    </form>`;

  const form = $('#apply');
  const update = () => {
    const f = new FormData(form);
    const t = ctx.types.find((x) => x.code === f.get('leave_type'));
    const part = form.part_day.checked && t.part_day;
    form.querySelector('.part-toggle').hidden = !t.part_day;
    form.querySelectorAll('.part').forEach((el) => { el.hidden = !part; });
    form.end_date.disabled = part;
    if (part) form.end_date.value = form.start_date.value;
    form.querySelector('.special').hidden = t.code !== 'special';
    form.querySelector('.union').hidden = !t.code.startsWith('union');
    form.querySelector('.parental-note').hidden = t.code !== 'parental';
    form.querySelector('.evidence').hidden = !t.evidence && t.code !== 'sick';
    const n = part ? partDayFraction(f.get('start_time'), f.get('end_time'), settings.hours_per_day)
      : countLeaveDays(f.get('start_date'), form.end_date.value, { calendarDays: t.calendar_days, holidays, workDays: workDaysOf(me) });
    const b = balances.find((x) => x.type.code === t.code);
    const pattern = workDaysOf(me) === '12345' ? 'Monday to Friday' : describeWorkDays(workDaysOf(me));
    let msg = n > 0 ? `<strong>${days(n)}</strong> ${t.calendar_days ? '(calendar days)' : `(your working days: ${pattern}; public holidays not counted)`}` : '<span class="warn-text">None of your working days fall in this period.</span>';
    // First or last day on a weekend / public holiday: not counted, but usually a mistake.
    // (A day this person does not normally work, per their work pattern, or a public holiday.)
    const offDay = (d) => d && (!isWorkDay(d, workDaysOf(me)) || holidays.has(d));
    const offName = (d) => (holidays.has(d) ? 'a public holiday' : `a ${new Date(`${d}T00:00`).toLocaleDateString('en-ZA', { weekday: 'long' })}, which is not one of your working days`);
    if (!t.calendar_days && !part) {
      const s0 = f.get('start_date'); const e0 = form.end_date.value;
      if (offDay(s0)) msg += `<br><span class="warn-text">Your leave starts on ${offName(s0)}. It is not counted, but you may mean the next working day.</span>`;
      if (e0 && e0 !== s0 && offDay(e0)) msg += `<br><span class="warn-text">Your leave ends on ${offName(e0)}. It is not counted.</span>`;
    }
    if (b && b.available != null && n > b.available) msg += `<br><span class="warn-text">This is more than your ${b.available} days left. ${gov ? 'Capped leave may be used, or HR may decline.' : 'Your approver may decline.'}</span>`;
    $('#summary').innerHTML = msg;
  };
  form.oninput = update;
  update();

  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const t = ctx.types.find((x) => x.code === f.get('leave_type'));
    const part = form.part_day.checked && t.part_day;
    busy(e.submitter, async () => {
      let att = {};
      const file = f.get('attachment');
      if (file && file.size) {
        const up = await api.uploadAttachment(file);
        att = { attachment_path: up.path, attachment_name: up.name };
      }
      const id = await api.applyLeave({
        leave_type: t.code, start_date: f.get('start_date'), end_date: part ? f.get('start_date') : f.get('end_date'),
        part_day: part, start_time: f.get('start_time'), end_time: f.get('end_time'), reason: f.get('reason'),
        leave_address: f.get('leave_address') || '', special_type: t.code === 'special' ? f.get('special_type') : '',
        union_affiliation: t.code.startsWith('union') ? f.get('union_affiliation') : '', ...att,
      });
      toast('Leave application submitted');
      if (gov) {
        const req = (await api.requests()).find((r) => r.id === id);
        if (req) await nextStepsDialog(ctx, req);
      }
      go('mine');
    });
  };
}

// Government: the application still needs paper. Explain the steps and offer the filled-in Z1.
async function nextStepsDialog(ctx, req) {
  const sup = ctx.byId[req.supervisor_id]?.full_name;
  const mgr = ctx.byId[req.manager_id]?.full_name;
  await dialog({
    title: 'Application submitted',
    body: `<p>Your leave application (ref ${esc(req.ref_no ?? '')}) is in the system. For the paper trail:</p>
      <ol class="steps-list">
        <li><strong>Download your Z1 form</strong>: it is already filled in with your details and the dates.</li>
        <li>Print it and <strong>sign</strong> it as the employee. Attach any supporting evidence.</li>
        <li>Give it to ${sup ? `<strong>${esc(sup)}</strong> (supervisor) to recommend and sign, then ` : ''}${mgr ? `<strong>${esc(mgr)}</strong> (manager / HOD) to approve and sign.` : 'your approver to sign.'}</li>
        <li>HR then receives it on a transmittal slip and captures it.</li>
      </ol>
      <p class="muted">Each person also records their decision in this app, and the form can be downloaded again at any stage from <em>My leave</em> with the decisions filled in.</p>`,
    buttons: [{ label: 'Later', value: null }, { label: 'Download Z1 form (Word)', value: 'dl', kind: 'primary', validate: false }],
  }).then((r) => (r ? busy(null, () => downloadLeaveForm(ctx, req)) : null));
}

// Z1 forms exist only in government mode (enterprise is paperless), for applications made in government mode.
// The employee, their approvers and HR may download them.
export const canDownloadForm = (ctx, r) => ctx.settings.mode === 'government' && r.mode === 'government'
  && (r.employee_id === ctx.me.id || r.supervisor_id === ctx.me.id || r.manager_id === ctx.me.id || actsFor(ctx.me, r.supervisor_id) || actsFor(ctx.me, r.manager_id) || isHR(ctx.me));

// ------------------------------------------------------------------ my leave

export async function renderMine(main, ctx) {
  const { api, me, settings } = ctx;
  const mine = ctx.requests.filter((r) => r.employee_id === me.id);
  const [overrides, priv] = await Promise.all([api.balanceOverrides(me.id), api.privateOf(me.id)]);
  const balances = computeBalances({ profile: me, types: ctx.types, requests: mine, overrides, mode: settings.mode, gender: priv.gender || '' });
  main.innerHTML = `
    <div class="page-head"><h1>My leave</h1><div class="row"><a class="btn primary" href="#/apply">Apply for leave</a><button class="btn" id="xlsx">Export to Excel</button></div></div>
    <section class="card"><h2>Balances</h2>${balanceCards(balances.filter((b) => b.entitled != null || b.used || b.pending))}</section>
    <section class="card"><h2>History and leave log</h2>
      ${mine.length ? requestTable(ctx, mine, { employee: false }) : empty('You have not applied for leave yet.')}
      <p class="muted">Select a row to see its log or cancel it.${settings.mode === 'government' ? ' Use <strong>Z1 form</strong> to download the filled-in Word form to print and sign.' : ''}</p>
    </section>
    <section class="card"><h2>My details</h2>
      <dl class="details">
        <dt>Name</dt><dd>${esc(me.full_name)}</dd>
        <dt>Department</dt><dd>${esc(me.department || '–')}${me.component ? ` / ${esc(me.component)}` : ''}</dd>
        <dt>Job title</dt><dd>${esc(me.job_title || '–')}</dd>
        <dt>Working days</dt><dd>${esc(describeWorkDays(workDaysOf(me)))}</dd>
        <dt>${esc(staffNumberLabel(settings.mode))}</dt><dd>${esc(priv.persal_number || '–')}</dd>
        <dt>Supervisor</dt><dd>${esc(ctx.byId[me.supervisor_id]?.full_name || '–')}</dd>
        <dt>Manager / HOD</dt><dd>${esc(ctx.byId[me.manager_id]?.full_name || '–')}</dd>
      </dl>
      <p class="muted">Something wrong? Ask HR to update it.</p>
    </section>`;
  bindRequestTable(main, ctx, reload);
  $('#xlsx').onclick = () => exportWorkbook([leaveSheet(ctx, mine, 'My leave'), balancesSheet(ctx, overrides, [me], { [me.id]: priv })], `my-leave-${today()}`);
}

// ------------------------------------------------------------------ shared: request table + detail dialog

// "5 working days" (weekends and public holidays are never counted), or "120 calendar days"
// for leave the law counts in calendar days, such as maternity leave.
export const leaveDaysText = (ctx, r) => {
  const cal = ctx.types.find((t) => t.code === r.leave_type)?.calendar_days;
  const n = Number(r.days).toLocaleString('en-ZA', { maximumFractionDigits: 2 });
  return `${n} ${cal ? 'calendar' : 'working'} ${Number(r.days) === 1 ? 'day' : 'days'}`;
};

// Small tag for leave that was shortened, or has a recall waiting for an answer.
export const changeTag = (r) => (r.recall_request_end ? ' <span class="badge warn">Recall requested</span>'
  : r.shortened_kind === 'recalled' ? ' <span class="badge muted">Recalled</span>'
    : r.shortened_kind === 'returned_early' ? ' <span class="badge muted">Returned early</span>' : '');

export function requestTable(ctx, rows, { employee = true, select = false } = {}) {
  const tname = (c) => ctx.types.find((t) => t.code === c)?.name || c;
  const forms = rows.some((r) => canDownloadForm(ctx, r));
  return `<div class="table-wrap"><table class="list">
    <thead><tr>${select ? '<th><input type="checkbox" data-all aria-label="Select all"></th>' : ''}<th>Ref</th>${employee ? '<th>Employee</th>' : ''}<th>Leave</th><th>When</th><th title="Weekends and public holidays are not counted">Leave days</th><th>Status</th>${forms ? '<th>Form</th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${esc(r.id)}" tabindex="0">
      ${select ? `<td><input type="checkbox" data-sel value="${esc(r.id)}" aria-label="Select"></td>` : ''}
      <td>${esc(r.ref_no ?? '')}</td>
      ${employee ? `<td>${esc(ctx.byId[r.employee_id]?.full_name || '')}</td>` : ''}
      <td>${esc(tname(r.leave_type))}</td><td>${dateRange(r)}</td><td>${esc(leaveDaysText(ctx, r))}</td><td>${statusBadge(r.status)}${changeTag(r)}</td>${forms ? `<td>${canDownloadForm(ctx, r) ? `<button type="button" class="btn small" data-z1="${esc(r.id)}" title="Download the filled-in Z1 (Word)">Z1 form</button>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

export function bindRequestTable(root, ctx, onChange) {
  root.querySelectorAll('tr[data-id]').forEach((tr) => {
    const open = (e) => {
      if (e.target.closest('input,button,a')) return;
      const r = ctx.requests.find((x) => x.id === tr.dataset.id);
      if (r) showRequest(ctx, r, onChange);
    };
    tr.onclick = open;
    tr.onkeydown = (e) => { if (e.key === 'Enter') open(e); };
  });
  root.querySelectorAll('[data-z1]').forEach((b) => {
    b.onclick = () => busy(b, () => downloadLeaveForm(ctx, ctx.requests.find((x) => x.id === b.dataset.z1)));
  });
  const all = root.querySelector('[data-all]');
  if (all) all.onchange = () => root.querySelectorAll('[data-sel]').forEach((c) => { c.checked = all.checked; c.dispatchEvent(new Event('change', { bubbles: true })); });
}

export async function downloadLeaveForm(ctx, req) {
  const employee = ctx.byId[req.employee_id];
  const priv = (ctx.me.id === req.employee_id || isHR(ctx.me)) ? await ctx.api.privateOf(req.employee_id) : {};
  const tpl = await activeTemplate(ctx.api, 'leave_form');
  const blob = fill(tpl.buffer, leaveFormData(req, { employee, priv, types: ctx.types, byId: ctx.byId, settings: ctx.settings }));
  download(blob, formFileName(req, employee));
}

export async function showRequest(ctx, req, onChange) {
  const { api, me } = ctx;
  const events = await api.events(req.id);
  const e = ctx.byId[req.employee_id] || {};
  const type = ctx.types.find((t) => t.code === req.leave_type);
  const who = (id) => ctx.byId[id]?.full_name || 'Someone';
  // "Ayesha Patel (Refilwe Sithole acting)" while someone acts for the approver.
  const whoNow = (id) => { const a = actingToday(ctx.acting).find((x) => x.principal_id === id); return a ? `${who(id)} (${who(a.acting_id)} acting)` : who(id); };
  const byWho = (id, forId) => (forId ? `${who(id)} (acting for ${who(forId)})` : who(id));
  const decide = canDecide(req, me);
  const cancel = canCancel(req, me);
  const mayDownload = canDownloadForm(ctx, req);
  const returnEarly = canReturnEarly(req, me);
  const recall = canRecall(req, me);
  const respond = canRespondRecall(req, me);
  const step = (label, dec, by, at, comment, waitingFor, actingFor) => `<div class="step"><strong>${label}</strong>
    ${dec ? `<span>${esc(DECISIONS[dec]?.label || dec)} by ${esc(byWho(by, actingFor))}, ${esc(fmtDateTime(at))}</span>${comment ? `<em>“${esc(comment)}”</em>` : ''}`
    : `<span class="muted">${waitingFor ? `Waiting for ${esc(waitingFor)}` : '–'}</span>`}</div>`;

  const body = `
    <dl class="details">
      <dt>Employee</dt><dd>${esc(e.full_name)}</dd>
      <dt>Leave</dt><dd>${esc(type?.name || req.leave_type)}${req.special_type ? ` (${esc(req.special_type)})` : ''}</dd>
      <dt>When</dt><dd>${dateRange(req)}</dd>
      <dt>Leave days</dt><dd>${esc(leaveDaysText(ctx, req))}${type?.calendar_days ? '' : ' <span class="muted">(weekends and public holidays not counted)</span>'}</dd>
      ${req.shortened_kind ? `<dt>${req.shortened_kind === 'recalled' ? 'Recalled' : 'Returned early'}</dt><dd>Originally until ${esc(fmtDate(req.original_end_date))} (${esc(req.original_days)} days); ${esc(Number(req.original_days) - Number(req.days))} day(s) credited back${req.recall_reason ? `. Reason: “${esc(req.recall_reason)}”` : ''}${req.recall_costs ? `. Costs to claim: ${esc(req.recall_costs)}` : ''}</dd>` : ''}
      ${req.recall_request_end ? `<dt>Recall requested</dt><dd><strong>${esc(who(req.recall_request_by))}</strong> asks ${req.employee_id === me.id ? 'you' : esc(e.full_name)} to make ${esc(fmtDate(req.recall_request_end))} the last day of leave: “${esc(req.recall_request_reason)}”. ${req.employee_id === me.id ? 'You can accept or decline.' : 'Waiting for the employee to answer.'}</dd>` : ''}
      <dt>Status</dt><dd>${statusBadge(req.status)}</dd>
      ${req.reason ? `<dt>Reason</dt><dd>${esc(req.reason)}</dd>` : ''}
      ${req.leave_address ? `<dt>Address during leave</dt><dd>${esc(req.leave_address)}</dd>` : ''}
      ${req.union_affiliation ? `<dt>Union</dt><dd>${esc(req.union_affiliation)}</dd>` : ''}
      ${req.attachment_path ? `<dt>Evidence</dt><dd><button type="button" class="linkish" id="att">${esc(req.attachment_name || 'View file')}</button></dd>` : ''}
    </dl>
    <h3>Approvals</h3>
    <div class="steps">
      ${req.supervisor_id || req.supervisor_decision ? step('Supervisor recommendation', req.supervisor_decision, req.supervisor_by, req.supervisor_at, req.supervisor_comment, req.status === 'pending_supervisor' && whoNow(req.supervisor_id), req.supervisor_acting_for) : ''}
      ${step(req.mode === 'enterprise' ? 'Approval' : 'Approval (manager / HOD)', req.manager_decision, req.manager_by, req.manager_at, req.manager_comment,
    req.status === 'pending_manager' ? whoNow(req.manager_id) : req.status === 'pending_hr' ? 'HR' : '', req.manager_acting_for)}
      ${req.captured_at ? `<div class="step"><strong>Data capturing</strong><span>Captured by ${esc(who(req.captured_by))}, ${esc(fmtDate(req.captured_at))}${req.checked_at ? `; checked by ${esc(who(req.checked_by))}` : ''}</span></div>` : ''}
    </div>
    <h3>Leave log</h3>
    <ol class="log">${events.map((ev) => `<li><time>${esc(fmtDateTime(ev.at))}</time> <strong>${esc(DECISIONS[ev.action]?.label || EVENT_LABELS[ev.action] || STATUS_LABELS[ev.action] || ev.action)}</strong> by ${esc(who(ev.actor_id))}${ev.comment ? ` — ${esc(ev.comment)}` : ''}</li>`).join('')}</ol>
    ${decide ? `<h3>Your decision</h3>
      <label>Decision <select name="decision" required>${options(decisionsFor(req, ctx.settings.mode).map((d) => [d, DECISIONS[d].label]))}</select></label>
      <label><span>Remarks <span class="opt">(optional)</span></span> <textarea name="comment" rows="2"></textarea></label>` : ''}`;

  const buttons = [{ label: 'Close', value: null }];
  if (mayDownload) buttons.push({ label: 'Download Z1 form (Word)', value: 'form', validate: false });
  if (cancel) buttons.push({ label: 'Cancel this leave', value: 'cancel', kind: 'danger', validate: false });
  if (returnEarly) buttons.push({ label: req.employee_id === me.id ? 'Return early' : 'Record early return', value: 'return', validate: false });
  if (recall) buttons.push({ label: 'Recall from leave', value: 'recall', validate: false });
  if (respond) buttons.push({ label: 'Answer recall request', value: 'respond', kind: 'primary', validate: false });
  if (decide) buttons.push({ label: 'Save decision', value: 'decide', kind: 'primary' });

  const res = await dialog({
    title: `Leave request ${req.ref_no ? `#${req.ref_no}` : ''}`, body, buttons, wide: true,
    onOpen: (d) => {
      const a = d.querySelector('#att');
      if (a) a.onclick = () => busy(a, async () => window.open(await api.attachmentUrl(req.attachment_path), '_blank', 'noopener'));
    },
  });
  if (!res) return;
  if (res.value === 'form') { await busy(null, () => downloadLeaveForm(ctx, req)); return showRequest(ctx, req, onChange); }
  if (res.value === 'cancel') {
    const ok = await busy(null, async () => { await api.cancel(req.id); return true; });
    if (ok) { toast('Leave cancelled'); onChange?.(); }
  }
  if (res.value === 'return' || res.value === 'recall') { await shortenDialog(ctx, req, res.value === 'recall' ? 'recalled' : 'returned_early', onChange); return; }
  if (res.value === 'respond') { await respondRecallDialog(ctx, req, onChange); return; }
  if (res.value === 'decide') {
    const decision = res.form.get('decision');
    const comment = String(res.form.get('comment') || '').trim();
    if (!DECISIONS[decision].ok || decision === 'not_recommended') {
      if (!comment) { toast('The Z1 asks for a reason when leave is not recommended, rescheduled or not approved. Please add a short remark.', 'bad'); return showRequest(ctx, req, onChange); }
    }
    const ok = await busy(null, async () => { await api.decide(req.id, decision, comment); return true; });
    if (ok) { toast(`Saved: ${DECISIONS[decision].label}`); onChange?.(); }
  }
}

// Return early (employee / HR) or recall (supervisor / manager / HR): choose the new last day of leave.
export async function shortenDialog(ctx, req, kind, onChange) {
  const e = ctx.byId[req.employee_id] || {};
  const type = ctx.types.find((t) => t.code === req.leave_type) || {};
  const holidays = new Set(ctx.holidays.map((h) => h.date));
  const recall = kind === 'recalled';
  const ent = req.mode === 'enterprise';
  const own = req.employee_id === ctx.me.id;
  const minDay = req.start_date;
  const maxDay = addDays(req.end_date, -1);
  // Default: yesterday as the last day of leave (back at work today), kept inside the leave period.
  const yesterday = addDays(today(), -1);
  const suggest = yesterday < minDay ? minDay : yesterday > maxDay ? maxDay : yesterday;
  const res = await dialog({
    title: recall ? `Recall ${e.full_name} from leave` : own ? 'Return early from leave' : `Record ${e.full_name}'s early return`,
    body: `<p>${esc(ctx.types.find((t) => t.code === req.leave_type)?.name || '')}: ${dateRange(req)} (${esc(req.days)} days).</p>
      ${recall && ent ? '<p class="note">In enterprise mode a recall is a <strong>request</strong>: the employee must agree before it takes effect (the BCEA does not allow an employer to require work during annual leave).</p>' : ''}
      ${recall && !ent ? '<p class="note">Recalls are for exceptional circumstances. The unused days are credited back to the employee, and reasonable costs caused by the recall are usually refunded. Check your department\'s leave policy.</p>' : ''}
      <label>New last day of leave <input type="date" name="new_end" required min="${minDay}" max="${maxDay}" value="${suggest}"></label>
      <p class="summary" id="back" aria-live="polite"></p>
      <label><span>Reason${recall ? '' : ' <span class="opt">(optional)</span>'}</span> <textarea name="reason" rows="2" ${recall ? 'required' : ''}></textarea></label>
      ${recall && !ent ? '<label><span>Costs to claim <span class="opt">(optional)</span></span> <input name="costs" placeholder="e.g. taxi back R350, cancelled booking R1 200"></label>' : ''}`,
    buttons: [{ label: 'Cancel', value: null }, { label: recall ? (ent ? 'Send recall request' : 'Recall') : 'Save', value: 'ok', kind: 'primary' }],
    onOpen: (d) => {
      const input = d.querySelector('[name=new_end]');
      const show = () => {
        const n = input.value ? countLeaveDays(req.start_date, input.value, { calendarDays: type.calendar_days, holidays, workDays: workDaysOf(e) }) : 0;
        d.querySelector('#back').innerHTML = input.value && input.value >= minDay && input.value <= maxDay
          ? (n <= 0 ? `No leave days would be left, so the leave will be <strong>cancelled</strong> and all ${esc(req.days)} day(s) go back to ${own ? 'your' : 'the'} balance.`
            : `Leave becomes <strong>${n} day(s)</strong>; <strong>${Number(req.days) - n} day(s)</strong> go back to ${own ? 'your' : 'the'} balance. Back at work the next working day.`)
          : 'Pick a day inside the current leave, before its last day.';
      };
      input.oninput = show; show();
    },
  });
  if (!res) return;
  const done = await busy(null, () => ctx.api.shorten(req.id, res.form.get('new_end'), kind, String(res.form.get('reason') || '').trim(), String(res.form.get('costs') || '').trim()));
  if (done) {
    toast(done === 'requested' ? `Recall request sent to ${e.full_name}` : done === 'cancelled' ? 'No leave days were left, so the leave is cancelled and all days credited back'
      : recall ? `${e.full_name} recalled; unused days credited back` : 'Saved; unused days credited back');
    onChange?.();
  }
}

// Enterprise: the employee accepts or declines a recall request.
export async function respondRecallDialog(ctx, req, onChange) {
  const by = ctx.byId[req.recall_request_by]?.full_name || 'Your manager';
  const res = await dialog({
    title: 'Recall request',
    body: `<p><strong>${esc(by)}</strong> asks you to make <strong>${esc(fmtDate(req.recall_request_end))}</strong> the last day of your leave (${dateRange(req)}).</p>
      <p>“${esc(req.recall_request_reason)}”</p>
      <p class="muted">It is your choice. If you accept, the unused days go back to your balance.</p>
      <label><span>Comment <span class="opt">(optional)</span></span> <input name="comment"></label>`,
    buttons: [{ label: 'Close', value: null }, { label: 'Decline', value: 'no', validate: false }, { label: 'Accept', value: 'yes', kind: 'primary' }],
  });
  if (!res) return;
  const done = await busy(null, () => ctx.api.respondRecall(req.id, res.value === 'yes', String(res.form.get('comment') || '').trim()));
  if (done) { toast(res.value === 'yes' ? 'Recall accepted; unused days credited back' : 'Recall declined'); onChange?.(); }
}
