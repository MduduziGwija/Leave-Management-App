// HR pages: employee records, the leave register, and transmittal slips.
import { computeBalances, defaultEntitlement, isAdmin, ROLE_LABELS, STATUS_LABELS, fmtDate, today } from '../logic.js';
import { esc, $, $$, dialog, toast, busy, options, empty, download, csv, dateRange, confirmBox } from '../ui.js';
import { requestTable, bindRequestTable } from './leave.js';
import { leaveFormData, transmittalData, activeTemplate, fill, zip, formFileName } from '../forms.js';
import { reload } from '../app.js';

// ------------------------------------------------------------------ employees

let search = '';

export async function renderEmployees(main, ctx) {
  const q = search.toLowerCase();
  const rows = ctx.profiles.filter((p) => !q || [p.full_name, p.email, p.department, p.component, p.job_title].join(' ').toLowerCase().includes(q));
  main.innerHTML = `
    <div class="page-head"><h1>Employees</h1><button class="btn primary" id="add">Add employee</button></div>
    <div class="card">
      <label class="search">Search <input type="search" id="q" value="${esc(search)}" placeholder="Name, department, job title…"></label>
      <div class="table-wrap"><table class="list">
        <thead><tr><th>Name</th><th>Department</th><th>Job title</th><th>Role</th><th>Supervisor</th><th>Manager / HOD</th><th>Status</th></tr></thead>
        <tbody>${rows.map((p) => `<tr data-emp="${esc(p.id)}" tabindex="0">
          <td><strong>${esc(p.full_name)}</strong><br><small class="muted">${esc(p.email || '')}</small></td>
          <td>${esc(p.department)}${p.component ? `<br><small class="muted">${esc(p.component)}</small>` : ''}</td>
          <td>${esc(p.job_title)}</td><td>${esc(ROLE_LABELS[p.role] || p.role)}</td>
          <td>${esc(ctx.byId[p.supervisor_id]?.full_name || '–')}</td><td>${esc(ctx.byId[p.manager_id]?.full_name || '–')}</td>
          <td>${p.active ? '<span class="badge ok">Active</span>' : '<span class="badge muted">Inactive</span>'}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  const q$ = $('#q');
  q$.oninput = () => { search = q$.value; renderEmployees(main, ctx).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
  $$('tr[data-emp]', main).forEach((tr) => {
    const open = () => editEmployee(ctx, ctx.byId[tr.dataset.emp]);
    tr.onclick = open;
    tr.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
  $('#add').onclick = () => addEmployee(ctx);
}

async function addEmployee(ctx) {
  if (ctx.api.kind !== 'demo') {
    const link = location.origin + location.pathname;
    await dialog({
      title: 'Add an employee',
      body: `<p>Each employee needs their own login, so they create it themselves:</p>
        <ol><li>Send them this link: <code>${esc(link)}</code></li>
        <li>They choose <em>Create an account</em> and confirm their email.</li>
        <li>They then appear in this list. Open them to set their department, supervisor, manager, PERSAL number and leave balances.</li></ol>
        <p class="muted">Or invite them from Supabase: Authentication → Users → Invite user.</p>`,
    });
    return;
  }
  const res = await dialog({
    title: 'Add employee (demo)', body: `<label>Full name <input name="full_name" required></label><label>Email <input name="email" type="email"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Add', value: 'add', kind: 'primary' }],
  });
  if (!res) return;
  const name = String(res.form.get('full_name')).trim();
  const id = await busy(null, () => ctx.api.addEmployee({ full_name: name, email: res.form.get('email'), surname: name.split(' ').at(-1), initials: name[0] }));
  if (id) { await reload(); editEmployee(ctx, ctx.byId[id]); }
}

async function editEmployee(ctx, p) {
  const { api, me, settings } = ctx;
  const [priv, overrides] = await Promise.all([api.privateOf(p.id), api.balanceOverrides(p.id)]);
  const mine = ctx.requests.filter((r) => r.employee_id === p.id);
  const balances = computeBalances({ profile: p, types: ctx.types, requests: mine, overrides, mode: settings.mode });
  const people = [['', '— none —'], ...ctx.profiles.filter((x) => x.id !== p.id && x.active).map((x) => [x.id, x.full_name])];
  const v = (x) => esc(x ?? '');
  const body = `
    <div class="form-grid">
      <h3 class="full">Work details</h3>
      <label class="full">Full name <input name="full_name" value="${v(p.full_name)}" required></label>
      <label>Surname <input name="surname" value="${v(p.surname)}"></label>
      <label>Initials <input name="initials" value="${v(p.initials)}"></label>
      <label>Department <input name="department" value="${v(p.department)}" list="depts"></label>
      <label>Component / section <input name="component" value="${v(p.component)}"></label>
      <label>Job title <input name="job_title" value="${v(p.job_title)}"></label>
      <label>Employment start <input type="date" name="employment_start" value="${v(p.employment_start)}"></label>
      <label>Supervisor (recommends) <select name="supervisor_id">${options(people, p.supervisor_id)}</select></label>
      <label>Manager / HOD (approves) <select name="manager_id">${options(people, p.manager_id)}</select></label>
      <label>Role <select name="role" ${isAdmin(me) ? '' : 'disabled title="Only an admin can change roles"'}>${options(Object.entries(ROLE_LABELS), p.role)}</select></label>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active (can sign in)</label>
      <label class="check"><input type="checkbox" name="shift_worker" ${p.shift_worker ? 'checked' : ''}> Shift worker</label>
      <label class="check"><input type="checkbox" name="casual_employee" ${p.casual_employee ? 'checked' : ''}> Casual employee</label>
      <h3 class="full">Private details <small>(only this employee and HR can see these)</small></h3>
      <label>PERSAL number <input name="persal_number" value="${v(priv.persal_number)}"></label>
      <label>ID number <input name="id_number" value="${v(priv.id_number)}"></label>
      <label>Phone <input name="phone" value="${v(priv.phone)}"></label>
      <label>Salary level <input name="salary_level" value="${v(priv.salary_level)}"></label>
      <label>Date of birth <input type="date" name="date_of_birth" value="${v(priv.date_of_birth)}"></label>
      <label>Emergency contact <input name="emergency_contact" value="${v(priv.emergency_contact)}"></label>
      <label class="full">Home address <input name="address" value="${v(priv.address)}"></label>
      <label class="full">HR notes <textarea name="notes" rows="2">${v(priv.notes)}</textarea></label>
      <h3 class="full">Leave balances for the current cycle</h3>
      <p class="full muted">Leave "Allowed" empty to use the default for ${settings.mode} mode. "Carried over" adds days from a previous cycle.</p>
      <div class="full table-wrap"><table class="list compact">
        <thead><tr><th>Leave type</th><th>Cycle</th><th>Allowed</th><th>Carried over</th><th>Taken</th><th>Pending</th><th>Left</th></tr></thead>
        <tbody>${balances.map((b) => {
    const ov = overrides.find((o) => o.leave_type === b.type.code && o.period_start === b.period.start);
    const def = defaultEntitlement(b.type, settings.mode, p);
    return `<tr><td>${esc(b.type.name)}</td><td><small>${esc(fmtDate(b.period.start))} – ${esc(fmtDate(b.period.end))}</small></td>
      <td><input class="num" type="number" step="0.5" min="0" name="ent_${esc(b.type.code)}" value="${ov?.entitled ?? ''}" placeholder="${def ?? '—'}" aria-label="Allowed ${esc(b.type.name)}"></td>
      <td><input class="num" type="number" step="0.5" name="car_${esc(b.type.code)}" value="${ov?.carried_over || ''}" placeholder="0" aria-label="Carried over ${esc(b.type.name)}"></td>
      <td>${b.used}</td><td>${b.pending}</td><td><strong>${b.available ?? '–'}</strong></td></tr>`;
  }).join('')}</tbody></table></div>
      <h3 class="full">Leave history</h3>
      <div class="full">${mine.length ? requestTable(ctx, mine, { employee: false }) : empty('No leave yet.')}</div>
    </div>
    <datalist id="depts">${[...new Set(ctx.profiles.map((x) => x.department).filter(Boolean))].map((d) => `<option value="${esc(d)}">`).join('')}</datalist>`;

  const res = await dialog({
    title: p.full_name, body, wide: true,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', kind: 'primary' }],
    onOpen: (d) => bindRequestTable(d, ctx, reload),
  });
  if (!res) return;
  const f = res.form;
  const patch = {
    full_name: f.get('full_name'), surname: f.get('surname'), initials: f.get('initials'), department: f.get('department'),
    component: f.get('component'), job_title: f.get('job_title'), employment_start: f.get('employment_start') || null,
    supervisor_id: f.get('supervisor_id') || null, manager_id: f.get('manager_id') || null,
    active: f.get('active') === 'on', shift_worker: f.get('shift_worker') === 'on', casual_employee: f.get('casual_employee') === 'on',
  };
  if (isAdmin(me)) patch.role = f.get('role');
  const privPatch = Object.fromEntries(['persal_number', 'id_number', 'phone', 'salary_level', 'emergency_contact', 'address', 'notes'].map((k) => [k, f.get(k) || '']));
  privPatch.date_of_birth = f.get('date_of_birth') || null;
  const ok = await busy(null, async () => {
    await api.saveProfile(p.id, patch);
    await api.savePrivate(p.id, privPatch);
    for (const b of balances) {
      const ent = f.get(`ent_${b.type.code}`); const car = f.get(`car_${b.type.code}`);
      const ov = overrides.find((o) => o.leave_type === b.type.code && o.period_start === b.period.start);
      const entitled = ent === '' || ent === null ? null : Number(ent);
      const carried = car === '' || car === null ? 0 : Number(car);
      if (ov || entitled !== null || carried) {
        if (!ov || ov.entitled !== entitled || Number(ov.carried_over || 0) !== carried) {
          await api.saveBalanceOverride({ employee_id: p.id, leave_type: b.type.code, period_start: b.period.start, entitled, carried_over: carried });
        }
      }
    }
    return true;
  });
  if (ok) { toast('Saved'); reload(); }
}

// ------------------------------------------------------------------ register

const filters = { status: '', type: '', dept: '', from: '', to: '', q: '' };

export async function renderRegister(main, ctx) {
  const gov = ctx.settings.mode === 'government';
  const rows = ctx.requests.filter((r) => {
    const e = ctx.byId[r.employee_id] || {};
    return (!filters.status || (filters.status === 'open' ? r.status.startsWith('pending') : r.status === filters.status))
      && (!filters.type || r.leave_type === filters.type) && (!filters.dept || e.department === filters.dept)
      && (!filters.from || r.end_date >= filters.from) && (!filters.to || r.start_date <= filters.to)
      && (!filters.q || e.full_name?.toLowerCase().includes(filters.q.toLowerCase()));
  }).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const depts = [...new Set(ctx.profiles.map((p) => p.department).filter(Boolean))].sort();
  main.innerHTML = `
    <div class="page-head"><h1>Leave register</h1><button class="btn" id="csv">Export CSV</button></div>
    <form class="card filters" id="f">
      <label>Name <input type="search" name="q" value="${esc(filters.q)}"></label>
      <label>Status <select name="status">${options([['', 'Any'], ['open', 'Awaiting a decision'], ...Object.entries(STATUS_LABELS)], filters.status)}</select></label>
      <label>Leave type <select name="type">${options([['', 'Any'], ...ctx.types.map((t) => [t.code, t.name])], filters.type)}</select></label>
      <label>Department <select name="dept">${options([['', 'Any'], ...depts.map((d) => [d, d])], filters.dept)}</select></label>
      <label>From <input type="date" name="from" value="${esc(filters.from)}"></label>
      <label>To <input type="date" name="to" value="${esc(filters.to)}"></label>
    </form>
    <div class="card">
      <div class="actions" id="bulk">
        <span id="nsel" class="muted">Select rows to act on them</span>
        <button class="btn" data-act="forms" disabled>Download forms (.zip)</button>
        ${gov ? '<button class="btn primary" data-act="slip" disabled>Put on a transmittal slip</button>' : ''}
        <button class="btn" data-act="captured" disabled>Mark captured</button>
      </div>
      ${rows.length ? requestTable(ctx, rows, { select: true }) : empty('No leave matches these filters.')}
    </div>`;
  $('#f').oninput = (e) => { filters[e.target.name] = e.target.value; renderRegister(main, ctx); };
  $('#f').onsubmit = (e) => e.preventDefault();
  bindRequestTable(main, ctx, reload);
  const selected = () => $$('[data-sel]:checked', main).map((c) => ctx.requests.find((r) => r.id === c.value));
  main.addEventListener('change', (e) => {
    if (!e.target.matches('[data-sel],[data-all]')) return;
    const s = selected();
    $('#nsel').textContent = s.length ? `${s.length} selected` : 'Select rows to act on them';
    $$('#bulk button', main).forEach((b) => { b.disabled = !s.length; });
  });
  $('#csv').onclick = () => {
    const tname = (c) => ctx.types.find((t) => t.code === c)?.name || c;
    download(csv([
      ['Ref', 'Employee', 'Department', 'Leave type', 'Start', 'End', 'Days', 'Status', 'Applied', 'Reason'],
      ...rows.map((r) => [r.ref_no, ctx.byId[r.employee_id]?.full_name, ctx.byId[r.employee_id]?.department, tname(r.leave_type), r.start_date, r.end_date, r.days, STATUS_LABELS[r.status], r.created_at.slice(0, 10), r.reason]),
    ]), `leave-register-${today()}.csv`);
  };
  $$('#bulk button', main).forEach((b) => b.onclick = () => busy(b, async () => {
    const s = selected();
    if (b.dataset.act === 'forms') return downloadForms(ctx, s, `Z1-forms-${today()}.zip`);
    if (b.dataset.act === 'captured') {
      if (!await confirmBox(`Mark ${s.length} request(s) as captured on the HR system?`)) return;
      await ctx.api.markCaptured(s.map((r) => r.id));
      toast('Marked as captured'); return reload();
    }
    if (b.dataset.act === 'slip') return createSlip(ctx, s);
  }));
}

export async function downloadForms(ctx, reqs, name) {
  const tpl = await activeTemplate(ctx.api, 'leave_form');
  const privs = await privMap(ctx, reqs);
  const files = reqs.map((r) => {
    const employee = ctx.byId[r.employee_id];
    return { name: formFileName(r, employee), blob: fill(tpl.buffer, leaveFormData(r, { employee, priv: privs[r.employee_id], types: ctx.types, byId: ctx.byId, settings: ctx.settings })) };
  });
  if (files.length === 1) download(files[0].blob, files[0].name);
  else download(await zip(files), name);
}

async function privMap(ctx, reqs) {
  const ids = [...new Set(reqs.map((r) => r.employee_id))];
  const privs = await Promise.all(ids.map((id) => ctx.api.privateOf(id)));
  return Object.fromEntries(ids.map((id, i) => [id, privs[i] || {}]));
}

async function createSlip(ctx, reqs) {
  const bad = reqs.filter((r) => r.status !== 'approved' || r.batch_id);
  if (bad.length) { toast(`${bad.length} selected request(s) are not "Approved" (or are already on a slip). Only approved leave can go on a slip.`, 'bad'); return; }
  const res = await dialog({
    title: `Transmittal slip for ${reqs.length} application(s)`,
    body: `<label>To <input name="to" value="${esc(ctx.settings.transmittal_to)}"></label>
      <label>Note (optional) <input name="note"></label>
      <p class="muted">The requests are marked "Sent to HR". You can then download the slip and all the forms together.</p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Create slip', value: 'ok', kind: 'primary' }],
  });
  if (!res) return;
  const id = await ctx.api.createTransmittal(reqs.map((r) => r.id), res.form.get('to'), res.form.get('note'));
  toast('Transmittal slip created');
  const batch = (await ctx.api.batches()).find((b) => b.id === id);
  await downloadSlip(ctx, batch, reqs);
  location.hash = '#/transmittals';
}

// ------------------------------------------------------------------ transmittal slips

async function downloadSlip(ctx, batch, reqs) {
  const tpl = await activeTemplate(ctx.api, 'transmittal');
  const privById = await privMap(ctx, reqs);
  const data = transmittalData(batch, reqs, { types: ctx.types, byId: ctx.byId, privById, settings: ctx.settings, me: ctx.me });
  download(fill(tpl.buffer, data), `Transmittal-slip-${batch.slip_no}.docx`);
}

export async function renderTransmittals(main, ctx) {
  const batches = await ctx.api.batches();
  const ready = ctx.requests.filter((r) => r.status === 'approved' && !r.batch_id).sort((a, b) => a.start_date.localeCompare(b.start_date));
  main.innerHTML = `
    <div class="page-head"><h1>Transmittal slips</h1></div>
    <p class="muted">Approved Z1 forms go to HR together with one transmittal slip listing them all. Select the approved applications, create a slip, then download the slip and the forms (to print, sign and send, or to email).</p>
    <section class="card"><h2>Approved, not yet sent (${ready.length})</h2>
      ${ready.length ? `<div class="actions"><button class="btn primary" id="mk" disabled>Create slip from selected</button></div>${requestTable(ctx, ready, { select: true })}` : empty('No approved applications are waiting to be sent.')}
    </section>
    <section class="card"><h2>Slips</h2>
      ${batches.length ? batches.map((b) => {
    const items = ctx.requests.filter((r) => r.batch_id === b.id);
    return `<article class="slip" data-b="${esc(b.id)}">
          <header><h3>Slip ${esc(b.slip_no)}</h3><small class="muted">${esc(fmtDate(b.created_at))} · ${items.length} form(s) · to ${esc(b.sent_to || ctx.settings.transmittal_to || '—')} · by ${esc(ctx.byId[b.created_by]?.full_name || '')}</small></header>
          <ul>${items.map((r) => `<li>${esc(ctx.byId[r.employee_id]?.full_name)}: ${esc(ctx.types.find((t) => t.code === r.leave_type)?.name)}, ${dateRange(r)} <span class="muted">(${esc(STATUS_LABELS[r.status])}${r.checked_at ? ', checked' : ''})</span></li>`).join('')}</ul>
          <div class="actions">
            <button class="btn primary" data-act="slip">Download slip</button>
            <button class="btn" data-act="forms">Download all forms (.zip)</button>
            <button class="btn" data-act="captured" ${items.every((r) => r.status === 'captured') ? 'disabled' : ''}>Mark captured</button>
            <button class="btn" data-act="checked" ${items.some((r) => r.status === 'captured' && !r.checked_at) ? '' : 'disabled'}>Mark checked</button>
          </div></article>`;
  }).join('') : empty('No slips yet.')}
    </section>`;

  bindRequestTable(main, ctx, reload);
  const mk = $('#mk');
  if (mk) {
    main.addEventListener('change', () => { mk.disabled = !$$('[data-sel]:checked', main).length; });
    mk.onclick = () => busy(mk, () => createSlip(ctx, $$('[data-sel]:checked', main).map((c) => ctx.requests.find((r) => r.id === c.value))).then(() => reload()));
  }
  $$('article.slip', main).forEach((a) => {
    const batch = batches.find((b) => b.id === a.dataset.b);
    const items = ctx.requests.filter((r) => r.batch_id === batch.id);
    a.querySelectorAll('[data-act]').forEach((btn) => btn.onclick = () => busy(btn, async () => {
      const act = btn.dataset.act;
      if (act === 'slip') return downloadSlip(ctx, batch, items);
      if (act === 'forms') return downloadForms(ctx, items, `Slip-${batch.slip_no}-forms.zip`);
      await ctx.api.markCaptured(items.map((r) => r.id), act === 'checked');
      toast(act === 'checked' ? 'Marked as checked' : 'Marked as captured');
      reload();
    }));
  });
}
