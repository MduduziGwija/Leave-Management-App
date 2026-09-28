// Settings: government / enterprise mode, organisation details, leave types, public holidays.
import { isAdmin, fmtDate, saPublicHolidays, AVAILABLE_IN, ELIGIBLE } from '../logic.js';
import { esc, $, $$, toast, busy, options, confirmBox } from '../ui.js';
import { reload } from '../app.js';
import { renderAppearance } from './appearance.js';

export async function render(main, ctx) {
  const { settings: s, me } = ctx;
  const admin = isAdmin(me);
  const dis = admin ? '' : 'disabled';
  const year = new Date().getFullYear();
  const hol = ctx.holidays.filter((h) => h.date >= `${year}-01-01` && h.date <= `${year + 1}-12-31`);
  const v = (x) => esc(x ?? '');

  main.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    ${admin ? '' : '<p class="muted">Only an admin can change the mode, organisation details and leave types. HR can manage public holidays.</p>'}
    <form class="card" id="general">
      <h2>How leave is processed</h2>
      <fieldset class="mode-choice" ${dis}>
        <legend class="sr-only">Mode</legend>
        <label class="choice"><input type="radio" name="mode" value="government" ${s.mode === 'government' ? 'checked' : ''}>
          <span><strong>Government</strong><small>Z1(a) forms. Supervisor recommends, then manager / HOD approves. Approved forms go to HR on a transmittal slip. Public service leave allowances (PSCBC).</small></span></label>
        <label class="choice"><input type="radio" name="mode" value="enterprise" ${s.mode === 'enterprise' ? 'checked' : ''}>
          <span><strong>Enterprise</strong><small>One approver (supervisor or manager). No transmittal slips. BCEA leave allowances.</small></span></label>
      </fieldset>
      <p class="muted">Changing the mode affects new applications and default allowances. Existing requests keep the process they started with.</p>
      <h2>Organisation</h2>
      <div class="form-grid">
        <label>Organisation name <input name="org_name" value="${v(s.org_name)}" ${dis}></label>
        <label>Department <input name="department_name" value="${v(s.department_name)}" ${dis}></label>
        <label>Working hours per day <small>(for part-day leave)</small><input type="number" step="0.5" min="1" max="24" name="hours_per_day" value="${v(s.hours_per_day)}" ${dis}></label>
      </div>
      <h2>Transmittal slip defaults</h2>
      <div class="form-grid">
        <label class="full">To <input name="transmittal_to" value="${v(s.transmittal_to)}" ${dis} placeholder="e.g. HR Records Centre, 12 Example Street, Sampleton, 0001"></label>
        <label class="full">From <input name="transmittal_from" value="${v(s.transmittal_from)}" ${dis}></label>
        <label>Contact person <input name="contact_person" value="${v(s.contact_person)}" ${dis}></label>
        <label>Tel <input name="contact_tel" value="${v(s.contact_tel)}" ${dis}></label>
      </div>
      ${admin ? '<button class="btn primary">Save settings</button>' : ''}
    </form>

    ${admin ? '<div id="appearance"></div>' : ''}

    <section class="card">
      <h2>Leave types</h2>
      <p class="muted"><strong>Parental leave:</strong> since the Constitutional Court's <em>Van Wyk</em> judgment (3 Oct 2025) all parents share 4 months and 10 days. It is on in enterprise mode. For the public service, the DPSA issued interim guidance in January 2026; switch "Parental leave" to <em>Both modes</em> once your department confirms how it applies.</p>
      <p class="muted">Days per cycle for each mode. Leave a days box empty for "no fixed allowance". Senior days apply in government mode after the given years of service (annual leave: 30 days after 10 years). <strong>Check these against your current collective agreement / determination.</strong></p>
      <form id="types"><div class="table-wrap"><table class="list compact types">
        <thead><tr><th>Name</th><th>Gov days</th><th>Enterprise days</th><th>Senior days / after yrs</th><th>Cycle (months) / starts</th><th>Counts</th><th>Transmittal column</th><th>Offered in</th><th>Who can take it</th><th>Part day</th><th>Evidence</th><th>Active</th></tr></thead>
        <tbody>${ctx.types.map((t) => `<tr data-code="${esc(t.code)}">
          <td><input name="name" value="${v(t.name)}" ${dis} aria-label="Name"><small class="muted">${esc(t.code)}</small></td>
          <td><input class="num" type="number" step="0.5" name="gov_days" value="${v(t.gov_days)}" ${dis} aria-label="Government days"></td>
          <td><input class="num" type="number" step="0.5" name="ent_days" value="${v(t.ent_days)}" ${dis} aria-label="Enterprise days"></td>
          <td class="pair"><input class="num" type="number" step="0.5" name="senior_days" value="${v(t.senior_days)}" ${dis} aria-label="Senior days"><input class="num" type="number" name="senior_years" value="${v(t.senior_years)}" ${dis} aria-label="After years"></td>
          <td class="pair"><input class="num" type="number" min="1" name="cycle_months" value="${v(t.cycle_months)}" ${dis} aria-label="Cycle months"><input type="date" name="cycle_anchor" value="${v(t.cycle_anchor)}" ${dis} aria-label="Cycle start"></td>
          <td><select name="calendar_days" ${dis} aria-label="Counts">${options([['false', 'Working days'], ['true', 'Calendar days']], String(!!t.calendar_days))}</select></td>
          <td><select name="transmittal" ${dis} aria-label="Transmittal column">${options([['vacation', 'Vacation'], ['sick', 'Sick'], ['other', 'Other']], t.transmittal)}</select></td>
          <td><select name="available_in" ${dis} aria-label="Offered in">${options(AVAILABLE_IN, t.available_in || 'both')}</select></td>
          <td><select name="eligible" ${dis} aria-label="Who can take it">${options(ELIGIBLE, t.eligible || 'all')}</select></td>
          <td><input type="checkbox" name="part_day" ${t.part_day ? 'checked' : ''} ${dis} aria-label="Part day allowed"></td>
          <td><input type="checkbox" name="evidence" ${t.evidence ? 'checked' : ''} ${dis} aria-label="Evidence asked for"></td>
          <td><input type="checkbox" name="active" ${t.active !== false ? 'checked' : ''} ${dis} aria-label="Active"></td>
        </tr>`).join('')}</tbody></table></div>
        ${admin ? `<div class="actions"><button class="btn primary">Save leave types</button>
          <span class="grow"></span><label>New type code <input name="new_code" pattern="[a-z_]+" placeholder="e.g. study" size="12"></label><button type="button" class="btn" id="addtype">Add</button></div>` : ''}
      </form>
    </section>

    <section class="card">
      <h2>Public holidays <small>${year}–${year + 1}</small></h2>
      <p class="muted">Not counted as leave days. South African holidays are added automatically; add special days (e.g. election days) here.</p>
      <form id="addhol" class="actions">
        <label>Date <input type="date" name="date" required></label>
        <label class="grow">Name <input name="name" required placeholder="e.g. Local government elections"></label>
        <button class="btn">Add holiday</button>
        <button type="button" class="btn" id="seed">Add SA holidays for ${year + 2}</button>
      </form>
      <ul class="holidays">${hol.map((h) => `<li><span>${esc(fmtDate(h.date))}</span><span class="grow">${esc(h.name)}</span><button class="btn small" data-del="${esc(h.date)}">Remove</button></li>`).join('')}</ul>
    </section>`;

  if (admin) renderAppearance($('#appearance'), ctx);
  if (admin) {
    $('#general').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const patch = Object.fromEntries(['mode', 'org_name', 'department_name', 'transmittal_to', 'transmittal_from', 'contact_person', 'contact_tel'].map((k) => [k, f.get(k) ?? '']));
      patch.hours_per_day = Number(f.get('hours_per_day')) || 8;
      busy(e.submitter, async () => {
        if (patch.mode !== s.mode && !await confirmBox(`Switch to ${patch.mode} mode? New applications will follow the ${patch.mode} process.`, 'Switch')) return;
        await ctx.api.saveSettings(patch); toast('Settings saved'); reload();
      });
    };
    $('#types').onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        const num = (x) => (x === '' || x == null ? null : Number(x));
        for (const tr of $$('tr[data-code]', main)) {
          const g = (n) => tr.querySelector(`[name=${n}]`);
          const old = ctx.types.find((t) => t.code === tr.dataset.code);
          const t = {
            ...old, name: g('name').value, gov_days: num(g('gov_days').value), ent_days: num(g('ent_days').value),
            senior_days: num(g('senior_days').value), senior_years: num(g('senior_years').value),
            cycle_months: num(g('cycle_months').value) || 12, cycle_anchor: g('cycle_anchor').value || '2025-01-01',
            calendar_days: g('calendar_days').value === 'true', transmittal: g('transmittal').value,
            available_in: g('available_in').value, eligible: g('eligible').value,
            part_day: g('part_day').checked, evidence: g('evidence').checked, active: g('active').checked,
          };
          if (JSON.stringify(t) !== JSON.stringify(old)) await ctx.api.saveLeaveType(t);
        }
        toast('Leave types saved'); reload();
      });
    };
    $('#addtype').onclick = (e) => {
      const code = $('#types [name=new_code]').value.trim().toLowerCase();
      if (!/^[a-z_]+$/.test(code)) return toast('Use lowercase letters and _ only, e.g. study', 'bad');
      if (ctx.types.some((t) => t.code === code)) return toast('That code already exists', 'bad');
      busy(e.target, async () => {
        await ctx.api.saveLeaveType({ code, name: code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), gov_days: null, ent_days: null, senior_days: null, senior_years: null, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, part_day: false, transmittal: 'other', evidence: false, active: true, available_in: 'both', eligible: 'all', sort: ctx.types.length + 1 });
        toast('Added. Set its days and press Save.'); reload();
      });
    };
  }
  $('#addhol').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => { await ctx.api.addHoliday(f.get('date'), f.get('name')); toast('Holiday added'); reload(); });
  };
  $('#seed').onclick = (e) => busy(e.target, async () => {
    for (const h of saPublicHolidays(year + 2)) await ctx.api.addHoliday(h.date, h.name);
    toast(`Added ${year + 2} holidays`); reload();
  });
  $$('[data-del]', main).forEach((b) => b.onclick = () => busy(b, async () => { await ctx.api.removeHoliday(b.dataset.del); reload(); }));
}
