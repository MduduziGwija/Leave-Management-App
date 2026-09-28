// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Demo backend: everything is stored in this browser (localStorage) with made-up staff.
// It follows the same rules as supabase/schema.sql so the app can be tried without any setup.
// It is NOT secure: anyone can switch user. Use Supabase for real data.
import {
  DEFAULT_LEAVE_TYPES, PENDING, saPublicHolidays, countLeaveDays, partDayFraction, initialRouting,
  nextStatus, DECISIONS, isHR, isAdmin, today, addDays, iso, typeAvailable, typeEligible,
} from '../logic.js';

const KEY = 'leave-app-demo-v3';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function seed() {
  const t = today();
  const y = new Date().getFullYear();
  const P = (id, full_name, role, extra = {}) => {
    const parts = full_name.split(' ');
    return {
      id, email: `${parts[0].toLowerCase()}@example.org`, full_name, surname: parts.at(-1), initials: parts[0][0],
      role, department: 'Public Works', component: 'Roads Maintenance', job_title: '', supervisor_id: null, manager_id: null,
      employment_start: '2018-04-01', shift_worker: false, casual_employee: false, active: true, ...extra,
    };
  };
  const profiles = [
    P('u-admin', 'Nomsa Dlamini', 'admin', { job_title: 'Director: HR', component: 'Human Resources', employment_start: '2009-02-01' }),
    P('u-hr', 'Lerato Mokoena', 'hr', { job_title: 'HR Practitioner', component: 'Human Resources', manager_id: 'u-admin' }),
    P('u-hod', 'Ayesha Patel', 'approver', { job_title: 'Chief Director (HOD delegate)', manager_id: 'u-admin', employment_start: '2012-07-01' }),
    P('u-sup', 'Johan van Wyk', 'approver', { job_title: 'Deputy Director', manager_id: 'u-hod' }),
    P('u-s1', 'Sipho Ndlovu', 'staff', { job_title: 'Project Officer', supervisor_id: 'u-sup', manager_id: 'u-hod' }),
    P('u-s2', 'Lindiwe Mahlangu', 'staff', { job_title: 'Admin Clerk', supervisor_id: 'u-sup', manager_id: 'u-hod', employment_start: '2021-03-01' }),
    P('u-s3', 'Pieter Botha', 'staff', { job_title: 'Engineer', supervisor_id: 'u-sup', manager_id: 'u-hod', component: 'Bridges', employment_start: '2014-01-15' }),
    P('u-s4', 'Zanele Mthembu', 'staff', { job_title: 'Finance Clerk', supervisor_id: 'u-sup', manager_id: 'u-hod', shift_worker: true }),
    P('u-s5', 'Kagiso Molefe', 'staff', { job_title: 'Artisan', supervisor_id: 'u-sup', manager_id: 'u-hod', component: 'Roads' }),
    P('u-s6', 'Fatima Adams', 'staff', { job_title: 'Data Capturer', supervisor_id: 'u-sup', manager_id: 'u-hod', casual_employee: true, employment_start: '2024-06-01' }),
    P('u-s7', 'Bongani Zulu', 'staff', { job_title: 'Driver', supervisor_id: 'u-sup', manager_id: 'u-hod', component: 'Roads' }),
  ];
  const priv = Object.fromEntries(profiles.map((p, i) => [p.id, {
    id: p.id, persal_number: String(21000000 + i * 1379), id_number: `8${i}0${i}015${800 + i}08${i}`,
    phone: `000 555 01${String(i).padStart(2, '0')}`, address: `${10 + i} Sample Road, Sampleton`, salary_level: String(5 + (i % 8)),
    date_of_birth: null, emergency_contact: '', notes: '', gender: GENDER_OF[p.id] || '',
  }]));
  const types = DEFAULT_LEAVE_TYPES.map((x) => ({ ...x }));
  const holidays = [y - 1, y, y + 1, y + 2].flatMap(saPublicHolidays);
  const state = {
    currentUser: null,
    settings: {
      id: 1, mode: 'government', org_name: 'Department of Public Works', department_name: 'Public Works', hours_per_day: 8,
      transmittal_to: 'HR Records Centre, 12 Example Street, Sampleton, 0001', transmittal_from: 'Roads Maintenance Programme',
      contact_person: 'Lerato Mokoena', contact_tel: '000 123 4567',
    },
    profiles, priv, types, holidays, balances: [], requests: [], events: [], batches: [], templates: [], files: {},
    counters: { ref: 1, slip: 1 },
  };
  // Leave around today so the dashboard has something to show.
  const add = (who, type, s, e, status, extra = {}) => {
    const p = profiles.find((x) => x.id === who);
    const r = {
      id: uid(), ref_no: state.counters.ref++, employee_id: who, leave_type: type, start_date: s, end_date: e,
      part_day: false, start_time: null, end_time: null, reason: '', leave_address: '', special_type: '', union_affiliation: '',
      attachment_path: null, attachment_name: null, mode: 'government', ...initialRouting(p, 'government'), persal_number: priv[who].persal_number,
      days: countLeaveDays(s, e, { calendarDays: types.find((x) => x.code === type).calendar_days, holidays: new Set(holidays.map((h) => h.date)) }),
      supervisor_decision: null, supervisor_comment: '', supervisor_by: null, supervisor_at: null,
      manager_decision: null, manager_comment: '', manager_by: null, manager_at: null,
      batch_id: null, captured_by: null, captured_at: null, checked_by: null, checked_at: null,
      created_at: new Date(Date.now() - 86400000 * 7).toISOString(), ...extra,
    };
    r.status = status;
    state.requests.push(r);
    state.events.push({ id: state.events.length + 1, request_id: r.id, actor_id: who, action: 'submitted', comment: '', at: r.created_at });
    if (status !== 'pending_supervisor' && r.supervisor_id) {
      Object.assign(r, { supervisor_decision: 'recommended', supervisor_by: r.supervisor_id, supervisor_at: r.created_at });
      state.events.push({ id: state.events.length + 1, request_id: r.id, actor_id: r.supervisor_id, action: 'recommended', comment: '', at: r.created_at });
    }
    if (['approved', 'transmitted', 'captured'].includes(status)) {
      Object.assign(r, { manager_decision: 'approved_full_pay', manager_by: r.manager_id, manager_at: r.created_at });
      state.events.push({ id: state.events.length + 1, request_id: r.id, actor_id: r.manager_id, action: 'approved_full_pay', comment: '', at: r.created_at });
    }
    return r;
  };
  const mon = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); })();
  add('u-s1', 'annual', addDays(t, -2), addDays(t, 4), 'approved');
  add('u-s3', 'sick', t, t, 'approved', { reason: 'Flu' });
  add('u-s4', 'family', addDays(t, -1), addDays(t, 1), 'approved');
  add('u-s2', 'annual', addDays(mon, 14), addDays(mon, 18), 'pending_supervisor', { reason: 'Family holiday' });
  add('u-s5', 'annual', addDays(mon, 21), addDays(mon, 25), 'pending_manager');
  add('u-s6', 'special', addDays(t, 9), addDays(t, 10), 'approved', { special_type: 'Examination leave', reason: 'Exams' });
  add('u-sup', 'annual', addDays(mon, 28), addDays(mon, 32), 'approved');
  add('u-s7', 'annual', addDays(t, -40), addDays(t, -36), 'captured', { captured_by: 'u-hr', captured_at: new Date(Date.now() - 86400000 * 30).toISOString() });
  add('u-s1', 'sick', addDays(t, -60), addDays(t, -59), 'captured', { captured_by: 'u-hr', captured_at: new Date(Date.now() - 86400000 * 50).toISOString() });
  return state;
}

const GENDER_OF = { 'u-admin': 'female', 'u-hr': 'female', 'u-hod': 'female', 'u-sup': 'male', 'u-s1': 'male', 'u-s2': 'female', 'u-s3': 'male', 'u-s4': 'female', 'u-s5': 'male', 'u-s6': 'female', 'u-s7': 'male' };

let S = null;
const load = () => { try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; } if (!S) { S = seed(); save(); } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { throw new Error('This browser is out of storage space for the demo. Remove uploaded files or reset the demo.'); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const me = () => S.profiles.find((p) => p.id === S.currentUser && p.active) || null;
const need = (ok, msg = 'You do not have permission to do that') => { if (!ok) throw new Error(msg); };
const log = (request_id, action, comment = '') => S.events.push({ id: S.events.length + 1, request_id, actor_id: S.currentUser, action, comment: comment || '', at: new Date().toISOString() });
const visibleRequest = (r, m) => r.employee_id === m.id || r.supervisor_id === m.id || r.manager_id === m.id || isHR(m);

const b64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

export const demoApi = {
  kind: 'demo',
  async init() { load(); },
  async session() { return clone(me()); },
  async demoUsers() { return clone(S.profiles.filter((p) => p.active)); },
  async demoLogin(id) { S.currentUser = id; save(); },
  async demoReset() { localStorage.removeItem(KEY); load(); },
  async signOut() { S.currentUser = null; save(); },

  async settings() { return clone(S.settings); },
  async saveSettings(patch) { need(isAdmin(me()), 'Only an admin can change settings'); Object.assign(S.settings, patch); save(); },

  async profiles() { need(me()); return clone(S.profiles).sort((a, b) => a.full_name.localeCompare(b.full_name)); },
  async saveProfile(id, patch) {
    const m = me(); need(isHR(m));
    const p = S.profiles.find((x) => x.id === id);
    if (patch.role !== undefined && patch.role !== p.role) need(isAdmin(m), 'Only an admin can change roles');
    Object.assign(p, patch); save();
  },
  async addEmployee(data) {
    need(isHR(me()));
    const p = { id: uid(), email: '', full_name: '', surname: '', initials: '', role: 'staff', department: '', component: '', job_title: '', supervisor_id: null, manager_id: null, employment_start: null, shift_worker: false, casual_employee: false, active: true, ...data };
    S.profiles.push(p);
    S.priv[p.id] = { id: p.id, persal_number: '', id_number: '', phone: '', address: '', salary_level: '', date_of_birth: null, emergency_contact: '', notes: '' };
    save(); return p.id;
  },
  async privateOf(id) { const m = me(); need(m && (m.id === id || isHR(m))); return clone(S.priv[id] || {}); },
  async privateAll() { need(isHR(me()), 'HR only'); return clone(Object.values(S.priv)); },
  async savePrivate(id, patch) { need(isHR(me())); Object.assign(S.priv[id] ||= { id }, patch); save(); },

  async leaveTypes() { return clone(S.types).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)); },
  async saveLeaveType(t) {
    need(isAdmin(me()), 'Only an admin can change leave types');
    const i = S.types.findIndex((x) => x.code === t.code);
    if (i >= 0) S.types[i] = { ...S.types[i], ...t }; else S.types.push(t);
    save();
  },

  async holidays() { return clone(S.holidays).sort((a, b) => a.date.localeCompare(b.date)); },
  async addHoliday(date, name) { need(isHR(me())); S.holidays = S.holidays.filter((h) => h.date !== date); S.holidays.push({ date, name }); save(); },
  async removeHoliday(date) { need(isHR(me())); S.holidays = S.holidays.filter((h) => h.date !== date); save(); },

  async balanceOverrides(employeeId) {
    const m = me(); need(m && (!employeeId || employeeId === m.id || isHR(m)));
    return clone(S.balances.filter((b) => (employeeId ? b.employee_id === employeeId : (isHR(m) || b.employee_id === m.id))));
  },
  async saveBalanceOverride(row) {
    need(isHR(me()));
    S.balances = S.balances.filter((b) => !(b.employee_id === row.employee_id && b.leave_type === row.leave_type && b.period_start === row.period_start));
    S.balances.push(row); save();
  },

  async requests() { const m = me(); need(m); return clone(S.requests.filter((r) => visibleRequest(r, m))).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
  async events(requestId) {
    const m = me(); const r = S.requests.find((x) => x.id === requestId); need(r && visibleRequest(r, m));
    return clone(S.events.filter((e) => e.request_id === requestId));
  },

  async applyLeave(a) {
    const m = me(); need(m, 'Your account is not active');
    const type = S.types.find((t) => t.code === a.leave_type && t.active !== false); need(type, 'Unknown leave type');
    need(typeAvailable(type, S.settings.mode), `${type.name} is not offered in ${S.settings.mode} mode`);
    need(typeEligible(type, S.priv[m.id]?.gender), `${type.name} does not apply to you. Please choose another leave type, or ask HR to check your details.`);
    need(a.end_date >= a.start_date, 'The end date is before the start date');
    const clash = S.requests.some((r) => r.employee_id === m.id && !['rejected', 'cancelled'].includes(r.status)
      && r.start_date <= a.end_date && r.end_date >= a.start_date && !(r.part_day && a.part_day));
    need(!clash, 'You already have leave booked in this period');
    let d;
    if (a.part_day) {
      need(type.part_day, 'This leave type cannot be taken for part of a day');
      need(a.start_date === a.end_date && a.start_time && a.end_time && a.end_time > a.start_time, 'Part-day leave needs one date and a start time before the end time');
      d = partDayFraction(a.start_time, a.end_time, S.settings.hours_per_day);
    } else {
      d = countLeaveDays(a.start_date, a.end_date, { calendarDays: type.calendar_days, holidays: new Set(S.holidays.map((h) => h.date)) });
    }
    need(d > 0, 'The selected period has no working days');
    const r = {
      id: uid(), ref_no: S.counters.ref++, employee_id: m.id, leave_type: a.leave_type, start_date: a.start_date, end_date: a.end_date,
      part_day: !!a.part_day, start_time: a.part_day ? a.start_time : null, end_time: a.part_day ? a.end_time : null, days: d,
      reason: a.reason || '', leave_address: a.leave_address || '', special_type: a.special_type || '', union_affiliation: a.union_affiliation || '',
      attachment_path: a.attachment_path || null, attachment_name: a.attachment_name || null, mode: S.settings.mode,
      persal_number: S.priv[m.id]?.persal_number || '',
      ...initialRouting(m, S.settings.mode),
      supervisor_decision: null, supervisor_comment: '', supervisor_by: null, supervisor_at: null,
      manager_decision: null, manager_comment: '', manager_by: null, manager_at: null,
      batch_id: null, captured_by: null, captured_at: null, checked_by: null, checked_at: null, created_at: new Date().toISOString(),
    };
    S.requests.push(r); log(r.id, 'submitted', `${d} day(s)`); save();
    return r.id;
  },

  async decide(id, decision, comment = '') {
    const m = me(); const r = S.requests.find((x) => x.id === id);
    need(r, 'Request not found');
    need(r.employee_id !== m.id, 'You cannot decide on your own leave');
    need(DECISIONS[decision], 'Invalid decision');
    const now = new Date().toISOString();
    if (r.status === 'pending_supervisor') {
      need(r.supervisor_id === m.id || isHR(m), 'Not your request to decide');
      need(DECISIONS[decision].step === 'supervisor', 'Invalid decision');
      r.status = nextStatus(r, decision);
      Object.assign(r, { supervisor_decision: decision, supervisor_comment: comment, supervisor_by: m.id, supervisor_at: now });
    } else if (r.status === 'pending_manager' || r.status === 'pending_hr') {
      need((r.status === 'pending_manager' && r.manager_id === m.id) || isHR(m), 'Not your request to decide');
      need(DECISIONS[decision].step === 'final', 'Invalid decision');
      r.status = nextStatus(r, decision);
      Object.assign(r, { manager_decision: decision, manager_comment: comment, manager_by: m.id, manager_at: now });
    } else throw new Error('This request is not waiting for a decision');
    log(id, decision, comment); save();
    return r.status;
  },

  async cancel(id, comment = '') {
    const m = me(); const r = S.requests.find((x) => x.id === id);
    need(r && (r.employee_id === m.id || isHR(m)), 'Request not found');
    need(PENDING.includes(r.status) || (r.status === 'approved' && (isHR(m) || r.start_date > today())), 'This request can no longer be cancelled');
    r.status = 'cancelled'; log(id, 'cancelled', comment); save();
  },

  async whoIsOut(from, to) {
    const m = me(); need(m);
    return S.requests
      .filter((r) => !['rejected', 'cancelled'].includes(r.status) && r.start_date <= to && r.end_date >= from)
      .map((r) => {
        const p = S.profiles.find((x) => x.id === r.employee_id);
        return {
          request_id: r.id, employee_id: r.employee_id, full_name: p.full_name, department: p.department, start_date: r.start_date,
          end_date: r.end_date, part_day: r.part_day, status: r.status, leave_type: visibleRequest(r, m) ? r.leave_type : null,
        };
      })
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.full_name.localeCompare(b.full_name));
  },

  async createTransmittal(ids, sentTo = '', note = '') {
    const m = me(); need(isHR(m), 'HR only');
    const rs = S.requests.filter((r) => ids.includes(r.id) && r.status === 'approved' && !r.batch_id);
    need(rs.length && rs.length === ids.length, 'Only approved requests that are not on a slip yet can be added');
    const b = { id: uid(), slip_no: S.counters.slip++, sent_to: sentTo, note, created_by: m.id, created_at: new Date().toISOString() };
    S.batches.push(b);
    rs.forEach((r) => { r.status = 'transmitted'; r.batch_id = b.id; log(r.id, 'transmitted'); });
    save(); return b.id;
  },
  async markCaptured(ids, checked = false) {
    const m = me(); need(isHR(m), 'HR only');
    const now = new Date().toISOString();
    for (const r of S.requests.filter((x) => ids.includes(x.id))) {
      if (checked && r.status === 'captured') { Object.assign(r, { checked_by: m.id, checked_at: now }); log(r.id, 'checked'); }
      if (!checked && ['approved', 'transmitted'].includes(r.status)) { Object.assign(r, { status: 'captured', captured_by: m.id, captured_at: now }); log(r.id, 'captured'); }
    }
    save();
  },
  async batches() { need(isHR(me()), 'HR only'); return clone(S.batches).sort((a, b) => b.created_at.localeCompare(a.created_at)); },

  async templates() { need(me()); return clone(S.templates); },
  async uploadTemplate(kind, name, file) {
    const m = me(); need(isHR(m));
    const buf = await file.arrayBuffer();
    need(buf.byteLength < 1_500_000, 'In the demo, templates must be smaller than 1.5 MB');
    const id = uid();
    S.files[`templates/${id}`] = b64(buf);
    S.templates.forEach((t) => { if (t.kind === kind) t.active = false; });
    S.templates.push({ id, kind, name, storage_path: `templates/${id}`, active: true, uploaded_by: m.id, created_at: new Date().toISOString() });
    save(); return id;
  },
  async templateBytes(t) { return unb64(S.files[t.storage_path]); },
  async deleteTemplate(id) {
    need(isHR(me()));
    const t = S.templates.find((x) => x.id === id);
    delete S.files[t.storage_path];
    S.templates = S.templates.filter((x) => x.id !== id); save();
  },
  async setTemplateActive(id, active) {
    need(isHR(me()));
    const t = S.templates.find((x) => x.id === id);
    S.templates.forEach((x) => { if (x.kind === t.kind) x.active = false; });
    t.active = active; save();
  },

  async uploadBranding(blob) {
    need(isAdmin(me()), 'Only an admin can change the appearance');
    need(blob.size < 900_000, 'In the demo, pictures must be smaller than 900 KB');
    return `data:image/jpeg;base64,${b64(await blob.arrayBuffer())}`;
  },

  async uploadAttachment(file) {
    const m = me(); need(m);
    const buf = await file.arrayBuffer();
    need(buf.byteLength < 700_000, 'In the demo, attachments must be smaller than 700 KB');
    const path = `${m.id}/${Date.now()}-${file.name}`;
    S.files[`attachments/${path}`] = b64(buf);
    S.files[`attachments/${path}#type`] = file.type;
    save();
    return { path, name: file.name };
  },
  async attachmentUrl(path) {
    const data = S.files[`attachments/${path}`];
    need(data, 'File not found');
    return URL.createObjectURL(new Blob([unb64(data)], { type: S.files[`attachments/${path}#type`] || 'application/octet-stream' }));
  },
};
