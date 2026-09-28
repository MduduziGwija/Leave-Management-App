// Fills Word (.docx) templates with leave data, using docxtemplater (vendor/).
// A template is any .docx with {tags} typed into it, e.g. {surname} or {annual_start}.
// Tags for a list of rows: {#items} ... {/items} around one table row repeats that row.
import { DECISIONS, fmtDateTime, parse } from './logic.js';

export const STARTERS = {
  leave_form: { name: 'Built-in Z1(a) leave form', url: 'templates/z1a-leave-form.docx', file: 'z1a-leave-form.docx' },
  transmittal: { name: 'Built-in transmittal slip', url: 'templates/transmittal-slip.docx', file: 'transmittal-slip.docx' },
};

export const dmy = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const hm = (t) => (t ? String(t).slice(0, 5) : '');
const X = (on) => (on ? 'X' : ' ');

function monthsBetween(start, end) {
  const days = (parse(end) - parse(start)) / 86400000 + 1;
  return Math.round((days / 30.44) * 10) / 10;
}

// ---------------------------------------------------------------- data for one leave form

export function leaveFormData(req, { employee, priv = {}, types, byId, settings }) {
  const type = types.find((t) => t.code === req.leave_type) || { name: req.leave_type };
  const name = (id) => byId[id]?.full_name || '';
  const sup = DECISIONS[req.supervisor_decision];
  const fin = DECISIONS[req.manager_decision];
  const d = {
    org_name: settings.org_name, ref_no: String(req.ref_no ?? ''),
    surname: employee.surname || employee.full_name, initials: employee.initials, full_name: employee.full_name,
    persal_number: priv.persal_number || req.persal_number || '', id_number: priv.id_number || '', job_title: employee.job_title,
    department: employee.department || settings.department_name, component: employee.component,
    shift_yes: X(employee.shift_worker), shift_no: X(!employee.shift_worker),
    casual_yes: X(employee.casual_employee), casual_no: X(!employee.casual_employee),
    leave_address: req.leave_address, reason: req.reason, special_type: req.special_type, union_affiliation: req.union_affiliation,
    leave_type: type.name, leave_type_code: req.leave_type,
    start_date: dmy(req.start_date), end_date: dmy(req.end_date), days: String(req.days),
    part_day_from: hm(req.start_time), part_day_to: hm(req.end_time),
    application_date: dmy(req.created_at), attachment_name: req.attachment_name || '',
    employee_esign: `Submitted electronically by ${employee.full_name} on ${fmtDateTime(req.created_at)} (ref ${req.ref_no ?? ''})`,

    rec_recommended: X(req.supervisor_decision === 'recommended'),
    rec_not_recommended: X(req.supervisor_decision === 'not_recommended'),
    rec_rescheduled: X(req.supervisor_decision === 'rescheduled'),
    rec_remarks: req.supervisor_comment || '', rec_name: name(req.supervisor_by), rec_date: dmy(req.supervisor_at),
    rec_esign: sup ? `${sup.label} electronically by ${name(req.supervisor_by)} on ${fmtDateTime(req.supervisor_at)}` : '',

    app_full_pay: X(req.manager_decision === 'approved_full_pay' || req.manager_decision === 'approved'),
    app_without_pay: X(req.manager_decision === 'approved_without_pay'),
    app_not_approved: X(req.manager_decision === 'not_approved' || req.manager_decision === 'rejected'),
    app_remarks: req.manager_comment || '', app_name: name(req.manager_by), app_date: dmy(req.manager_at),
    app_esign: fin ? `${fin.label} electronically by ${name(req.manager_by)} on ${fmtDateTime(req.manager_at)}` : '',
    decision: fin?.label || sup?.label || '',

    captured_by: name(req.captured_by), captured_on: dmy(req.captured_at),
    checked_by: name(req.checked_by), checked_on: dmy(req.checked_at),
  };
  // The Z1 has one box per PERSAL digit: {persal_1} … {persal_8}.
  const digits = String(d.persal_number).replace(/\s/g, '');
  for (let i = 1; i <= 8; i++) d[`persal_${i}`] = digits[i - 1] || '';
  // One set of fields per leave type, so each row of the form can be filled: {annual_start}, {sick_days}, ...
  for (const t of types) {
    const mine = t.code === req.leave_type;
    const c = t.code;
    const full = mine && !req.part_day;
    const part = mine && req.part_day;
    d[`${c}_x`] = X(mine);
    d[`${c}_start`] = full ? dmy(req.start_date) : '';
    d[`${c}_end`] = full ? dmy(req.end_date) : '';
    d[`${c}_days`] = full ? String(req.days) : '';
    d[`${c}_months`] = full ? String(monthsBetween(req.start_date, req.end_date)) : '';
    d[`${c}_weeks`] = full ? String(Math.round(((parse(req.end_date) - parse(req.start_date)) / 86400000 + 1) / 7 * 10) / 10) : '';
    d[`${c}_part_date`] = part ? dmy(req.start_date) : '';
    d[`${c}_part_from`] = part ? hm(req.start_time) : '';
    d[`${c}_part_to`] = part ? hm(req.end_time) : '';
    let h = '', m = '';
    if (part && req.start_time && req.end_time) {
      const [h1, m1] = hm(req.start_time).split(':').map(Number);
      const [h2, m2] = hm(req.end_time).split(':').map(Number);
      const mins = h2 * 60 + m2 - (h1 * 60 + m1);
      h = String(Math.floor(mins / 60)); m = String(mins % 60);
    }
    d[`${c}_part_h`] = h; d[`${c}_part_m`] = m;
  }
  return d;
}

// ---------------------------------------------------------------- data for a transmittal slip

export function transmittalData(batch, reqs, { types, byId, privById = {}, settings, me }) {
  const items = reqs.map((r, i) => {
    const e = byId[r.employee_id] || {};
    const t = types.find((x) => x.code === r.leave_type) || { name: r.leave_type, transmittal: 'other' };
    const col = t.transmittal || 'other';
    const name = `${e.surname || e.full_name || ''} ${e.initials || ''}`.trim();
    const f = dmy(r.start_date), to = dmy(r.end_date);
    return {
      no: String(i + 1), name, full_name: e.full_name || '', surname: e.surname || '', initials: e.initials || '',
      persal_number: privById[r.employee_id]?.persal_number || '',
      leave_type: t.name, days: String(r.days), start_date: f, end_date: to, ref_no: String(r.ref_no ?? ''),
      name_with_type: col === 'other' ? `${name} (${t.name})` : name,
      vac_from: col === 'vacation' ? f : '', vac_to: col === 'vacation' ? to : '',
      sick_from: col === 'sick' ? f : '', sick_to: col === 'sick' ? to : '',
      other_from: col === 'other' ? f : '', other_to: col === 'other' ? to : '', other_type: col === 'other' ? t.name : '',
    };
  });
  const by = byId[batch.created_by] || me || {};
  // Department / component of the staff on the slip, when they all share one.
  const common = (key) => { const v = [...new Set(reqs.map((r) => byId[r.employee_id]?.[key]).filter(Boolean))]; return v.length === 1 ? v[0] : ''; };
  return {
    org_name: settings.org_name,
    to: batch.sent_to || settings.transmittal_to, from: settings.transmittal_from || settings.org_name,
    slip_no: String(batch.slip_no), date: dmy(batch.created_at), note: batch.note || '',
    department: common('department') || settings.department_name, component: common('component'),
    contact_person: settings.contact_person, tel: settings.contact_tel,
    forms_count: String(items.length), submitted_by: `${by.surname || by.full_name || ''} ${by.initials || ''}`.trim(),
    submitted_date: dmy(batch.created_at), items,
  };
}

// ---------------------------------------------------------------- tag reference (shown in the app)

export const TAGS = {
  leave_form: [
    ['{surname} {initials} {full_name}', 'Employee name'],
    ['{persal_number} {id_number}', 'PERSAL and ID number'],
    ['{persal_1} … {persal_8}', 'PERSAL number one digit per box, as on the Z1(a)'],
    ['{department} {component} {job_title}', 'Where the employee works'],
    ['{shift_yes} {shift_no} {casual_yes} {casual_no}', '"X" in the right Yes / No box'],
    ['{leave_address}', 'Address during the leave period'],
    ['{leave_type} {start_date} {end_date} {days}', 'The leave applied for (any type)'],
    ['{annual_start} {annual_end} {annual_days}', 'Section A, one row per type. Swap "annual" for any leave type code (see Settings).'],
    ['{maternity_months} {surrogacy_mother_weeks}', 'Calendar months / weeks'],
    ['{annual_part_date} {annual_part_from} {annual_part_to} {annual_part_h} {annual_part_m}', 'Section B (part of a day), per type'],
    ['{annual_x}', '"X" next to the chosen leave type (per type)'],
    ['{special_type} {union_affiliation} {reason}', 'Extra details'],
    ['{application_date} {employee_esign}', 'Date applied, and an electronic signature line'],
    ['{rec_recommended} {rec_not_recommended} {rec_rescheduled}', 'Supervisor recommendation boxes ("X")'],
    ['{rec_remarks} {rec_name} {rec_date} {rec_esign}', 'Supervisor remarks, name, date, e-signature line'],
    ['{app_full_pay} {app_without_pay} {app_not_approved}', 'HOD / delegate approval boxes ("X")'],
    ['{app_remarks} {app_name} {app_date} {app_esign}', 'HOD remarks, name, date, e-signature line'],
    ['{captured_by} {captured_on} {checked_by} {checked_on}', 'HR data capturing'],
    ['{ref_no} {org_name}', 'Application reference number, organisation name'],
  ],
  transmittal: [
    ['{to} {from} {slip_no} {date}', 'Slip header'],
    ['{department} {component} {contact_person} {tel}', 'Sender details'],
    ['{#items} ... {/items}', 'Put {#items} in the first cell and {/items} in the last cell of one table row. That row is repeated for every application.'],
    ['{no} {name} {name_with_type} {persal_number}', 'Inside the row: number and name. name_with_type adds the leave type for "other" leave.'],
    ['{vac_from} {vac_to} {sick_from} {sick_to} {other_from} {other_to}', 'Inside the row: dates in the right column'],
    ['{leave_type} {start_date} {end_date} {days} {ref_no}', 'Inside the row: other details'],
    ['{forms_count} {submitted_by} {submitted_date}', 'Totals and sender sign-off'],
  ],
};

// ---------------------------------------------------------------- docx helpers

// Returns the tags written in a template, e.g. ["surname", "#items", ...].
export function findTags(buffer) {
  const zip = new window.PizZip(buffer);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  const text = parts.map((n) => zip.file(n).asText().replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')).join(' ');
  return [...new Set([...text.matchAll(/\{([#/^]?[\w.]+)\}/g)].map((m) => m[1]))];
}

// Throws a readable error if the template has broken tags (e.g. a {#items} without {/items}).
export function checkTemplate(buffer) {
  try {
    const d = new window.docxtemplater(new window.PizZip(buffer), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    d.render({});
  } catch (e) {
    const errs = e.properties?.errors?.map((x) => x.properties?.explanation || x.message) || [e.message];
    throw new Error(`This template has a problem: ${errs.slice(0, 3).join('; ')}`);
  }
}

export function fill(buffer, data) {
  const d = new window.docxtemplater(new window.PizZip(buffer), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  d.render(data);
  return d.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

// Returns { name, buffer } for the active uploaded template of a kind, or the built-in starter.
export async function activeTemplate(api, kind) {
  const list = await api.templates();
  const t = list.find((x) => x.kind === kind && x.active);
  if (t) return { name: t.name, buffer: await api.templateBytes(t) };
  const res = await fetch(STARTERS[kind].url);
  if (!res.ok) throw new Error('Could not load the built-in template');
  return { name: STARTERS[kind].name, buffer: await res.arrayBuffer() };
}

export async function zip(files) {
  const z = new window.PizZip();
  for (const f of files) z.file(f.name, await f.blob.arrayBuffer());
  return z.generate({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
}

export const formFileName = (req, employee) => `Z1-${(employee.surname || employee.full_name || 'employee').replace(/\W+/g, '_')}-${req.start_date}-ref${req.ref_no ?? ''}.docx`;
