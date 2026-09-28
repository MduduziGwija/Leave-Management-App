// Shared business rules used by both the demo backend and the Supabase backend.

export const STATUS_LABELS = {
  pending_supervisor: 'Awaiting supervisor',
  pending_manager: 'Awaiting manager / HOD',
  pending_hr: 'Awaiting HR',
  approved: 'Approved',
  transmitted: 'Sent to HR (transmittal)',
  captured: 'Captured by HR',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const PENDING = ['pending_supervisor', 'pending_manager', 'pending_hr'];
export const APPROVED = ['approved', 'transmitted', 'captured'];

export const ROLE_LABELS = {
  staff: 'Staff',
  approver: 'Supervisor / Manager',
  hr: 'HR',
  admin: 'Admin (HR + settings)',
};

// Government uses PERSAL numbers and salary levels; enterprise mode uses neutral names.
export const staffNumberLabel = (mode) => (mode === 'government' ? 'PERSAL number' : 'Employee number');
export const payLabel = (mode) => (mode === 'government' ? 'Salary level' : 'Pay grade');

export const isHR = (p) => !!p && (p.role === 'hr' || p.role === 'admin');
export const isAdmin = (p) => !!p && p.role === 'admin';

// ---------- dates ----------
export function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function addMonths(s, n) {
  const d = parse(s);
  d.setMonth(d.getMonth() + n);
  return iso(d);
}
export const today = () => iso(new Date());

export function fmtDate(s) {
  if (!s) return '';
  return parse(s.slice(0, 10)).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- South African public holidays ----------
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(y, month - 1, day));
}

export function saPublicHolidays(year) {
  const fixed = [
    ['01-01', "New Year's Day"], ['03-21', 'Human Rights Day'], ['04-27', 'Freedom Day'],
    ['05-01', "Workers' Day"], ['06-16', 'Youth Day'], ['08-09', "National Women's Day"],
    ['09-24', 'Heritage Day'], ['12-16', 'Day of Reconciliation'], ['12-25', 'Christmas Day'],
    ['12-26', 'Day of Goodwill'],
  ];
  const out = [];
  for (const [md, name] of fixed) {
    const date = `${year}-${md}`;
    out.push({ date, name });
    if (parse(date).getDay() === 0) out.push({ date: addDays(date, 1), name: `${name} (observed)` });
  }
  const e = easter(year);
  out.push({ date: addDays(e, -2), name: 'Good Friday' });
  out.push({ date: addDays(e, 1), name: 'Family Day' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Working days between two ISO dates, inclusive. Weekends and public holidays are skipped.
export function countLeaveDays(start, end, { calendarDays = false, holidays = new Set() } = {}) {
  if (!start || !end || end < start) return 0;
  if (calendarDays) return Math.round((parse(end) - parse(start)) / 86400000) + 1;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = parse(d).getDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(d)) n++;
  }
  return n;
}

// ---------- balances ----------
// The cycle containing `onDate`, e.g. annual leave = calendar year, sick leave = 36-month cycle.
export function cyclePeriod(type, onDate = today()) {
  const months = type.cycle_months || 12;
  const anchor = type.cycle_anchor || '2025-01-01';
  const a = parse(anchor), d = parse(onDate);
  const diff = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth()) - (d.getDate() < a.getDate() ? 1 : 0);
  const k = Math.floor(diff / months);
  const start = addMonths(anchor, k * months);
  const end = addDays(addMonths(start, months), -1);
  return { start, end };
}

export function yearsOfService(profile, onDate = today()) {
  if (!profile.employment_start) return 0;
  return (parse(onDate) - parse(profile.employment_start)) / (365.25 * 86400000);
}

export function defaultEntitlement(type, mode, profile) {
  let days = mode === 'government' ? type.gov_days : type.ent_days;
  if (days == null) return null;
  if (mode === 'government' && type.senior_days != null && type.senior_years != null
      && yearsOfService(profile) >= type.senior_years) days = type.senior_days;
  return Number(days);
}

// ---------- who can take which leave ----------
// available_in: which mode offers the type ('both' | 'government' | 'enterprise').
// eligible: 'all' | 'female' | 'male'. Leave only a birth mother can take (pre-natal, maternity,
// surrogate mother) is limited to women; everything else is open to any parent. If an employee's
// gender is not recorded, nothing is hidden.
export const GENDERS = [['', 'Not recorded'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other / prefer not to say']];
export const ELIGIBLE = [['all', 'Anyone'], ['female', 'Women only'], ['male', 'Men only']];
export const AVAILABLE_IN = [['both', 'Both modes'], ['government', 'Government only'], ['enterprise', 'Enterprise only']];
export const typeAvailable = (t, mode) => t.active !== false && (!t.available_in || t.available_in === 'both' || t.available_in === mode);
export const typeEligible = (t, gender) => !((t.eligible === 'female' && gender === 'male') || (t.eligible === 'male' && gender === 'female'));
export const typesFor = (types, mode, gender) => types.filter((t) => typeAvailable(t, mode) && typeEligible(t, gender));

// Returns one row per leave type this person can take: entitled, used, pending, available.
export function computeBalances({ profile, types, requests, overrides, mode, gender = '', onDate = today() }) {
  return typesFor(types, mode, gender).map((t) => {
    const period = cyclePeriod(t, onDate);
    const ov = overrides.find((o) => o.employee_id === profile.id && o.leave_type === t.code && o.period_start === period.start);
    const entitled = ov && ov.entitled != null ? Number(ov.entitled) : defaultEntitlement(t, mode, profile);
    const carried = ov ? Number(ov.carried_over || 0) : 0;
    const mine = requests.filter((r) => r.employee_id === profile.id && r.leave_type === t.code
      && r.start_date >= period.start && r.start_date <= period.end);
    const used = sum(mine.filter((r) => APPROVED.includes(r.status)));
    const pending = sum(mine.filter((r) => PENDING.includes(r.status)));
    const available = entitled == null ? null : entitled + carried - used - pending;
    return { type: t, period, entitled, carried, used, pending, available };
  });
}
const sum = (rows) => rows.reduce((s, r) => s + Number(r.days || 0), 0);

// ---------- default leave types (South Africa) ----------
// Matches the leave types on the public service Z1(a) form.
// gov_* follows the public service (PSCBC / DPSA determination); ent_* follows the BCEA.
// null days = no fixed allowance (granted as approved). HR can change every value in Settings.
// Check these against your department's current determination before going live.
// transmittal: which column of the transmittal slip the leave goes in (vacation / sick / other).
// part_day: may be taken for part of a day (Section B of the Z1 form).
const T = (code, name, gov_days, ent_days, extra = {}) => ({
  code, name, gov_days, ent_days, senior_days: null, senior_years: null, cycle_months: 12,
  cycle_anchor: '2025-01-01', calendar_days: false, part_day: false, transmittal: 'other',
  evidence: false, active: true, available_in: 'both', eligible: 'all', ...extra,
});
export const DEFAULT_LEAVE_TYPES = [
  T('annual', 'Annual leave', 22, 15, { senior_days: 30, senior_years: 10, part_day: true, transmittal: 'vacation', sort: 1 }),
  T('sick', 'Normal sick leave', 36, 30, { cycle_months: 36, part_day: true, transmittal: 'sick', sort: 2 }),
  T('til', 'Temporary incapacity leave', null, null, { cycle_months: 36, transmittal: 'sick', evidence: true, sort: 3 }),
  T('iod', 'Leave for occupational injuries and disease', null, null, { evidence: true, sort: 4 }),
  T('adoption', 'Adoption leave', 45, 50, { evidence: true, available_in: 'government', sort: 5 }),
  T('family', 'Family responsibility leave', 5, 3, { part_day: true, evidence: true, sort: 6 }),
  T('prenatal', 'Pre-natal leave', 8, null, { part_day: true, evidence: true, available_in: 'government', eligible: 'female', sort: 7 }),
  T('paternity', 'Paternity leave', 10, 10, { part_day: true, evidence: true, available_in: 'government', sort: 8 }),
  T('special', 'Special leave', null, null, { part_day: true, evidence: true, sort: 9 }),
  T('union_office', 'Leave for union office bearers', null, null, { part_day: true, evidence: true, sort: 10 }),
  T('union_steward', 'Leave for union shop stewards', null, null, { part_day: true, evidence: true, sort: 11 }),
  T('unpaid', 'Unpaid leave', null, null, { evidence: true, sort: 12 }),
  T('maternity', 'Maternity leave', 120, 120, { calendar_days: true, evidence: true, available_in: 'government', eligible: 'female', sort: 13 }),
  T('surrogacy_parent', 'Surrogacy leave: commissioning parent', null, 70, { calendar_days: true, evidence: true, available_in: 'government', sort: 14 }),
  T('surrogacy_mother', 'Surrogacy leave: surrogate mother', null, null, { calendar_days: true, evidence: true, eligible: 'female', sort: 15 }),
  // Van Wyk judgment (Constitutional Court, 3 Oct 2025): every parent (birth, adoptive or through
  // surrogacy, any gender) is entitled to parental leave; employed parents share 4 months and 10 days.
  // On by default in enterprise (BCEA). Public service: switch on in Settings once the DPSA confirms.
  T('parental', 'Parental leave (birth, adoption or surrogacy)', null, 132, { calendar_days: true, evidence: true, available_in: 'enterprise', sort: 16 }),
];

// Part-day leave: the fraction of a working day between two HH:MM times.
export function partDayFraction(startTime, endTime, hoursPerDay = 8) {
  if (!startTime || !endTime) return 0;
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const diff = mins(endTime) - mins(startTime);
  if (diff <= 0) return 0;
  return Math.round((diff / (hoursPerDay * 60)) * 100) / 100;
}

// ---------- approval routing ----------
// Government: supervisor recommends, then manager / HOD (the delegated authority) approves.
//   If only one of them is set, that person is the approving authority (as the Z1 form allows).
// Enterprise: one approver (supervisor, or the manager if there is no supervisor).
// If nobody is set, HR approves.
export function initialRouting(profile, mode) {
  let sup = profile.supervisor_id || null;
  let mgr = profile.manager_id || null;
  if (sup === profile.id) sup = null;
  if (mgr === profile.id) mgr = null;
  if (sup === mgr) sup = null;
  if (mode === 'enterprise') { mgr = sup || mgr; sup = null; }
  if (!mgr) { mgr = sup; sup = null; }
  const status = sup ? 'pending_supervisor' : mgr ? 'pending_manager' : 'pending_hr';
  return { supervisor_id: sup, manager_id: mgr, status };
}

// The choices an approver has at each step, worded as on the Z1(a) form.
export const DECISIONS = {
  recommended: { label: 'Recommended', step: 'supervisor', ok: true },
  not_recommended: { label: 'Not recommended', step: 'supervisor', ok: true },
  rescheduled: { label: 'Rescheduled (return to employee)', step: 'supervisor', ok: false },
  approved_full_pay: { label: 'Approved with full pay', step: 'final', ok: true },
  approved_without_pay: { label: 'Approved without pay', step: 'final', ok: true },
  not_approved: { label: 'Not approved', step: 'final', ok: false },
  approved: { label: 'Approved', step: 'final', ok: true },
  rejected: { label: 'Rejected', step: 'final', ok: false },
};

// Uses the mode the request was submitted under, so switching modes doesn't change pending requests.
export function decisionsFor(req, mode) {
  if (req.status === 'pending_supervisor') return ['recommended', 'not_recommended', 'rescheduled'];
  if ((req.mode || mode) === 'enterprise') return ['approved', 'rejected'];
  return ['approved_full_pay', 'approved_without_pay', 'not_approved'];
}

export function canDecide(req, me) {
  if (!me || req.employee_id === me.id) return false;
  if (isHR(me) && PENDING.includes(req.status)) return true;
  if (req.status === 'pending_supervisor') return req.supervisor_id === me.id;
  if (req.status === 'pending_manager') return req.manager_id === me.id;
  return false;
}

// A "not recommended" still goes to the manager / HOD, who makes the final decision.
export function nextStatus(req, decision) {
  const d = DECISIONS[decision];
  if (!d) throw new Error('Unknown decision');
  if (req.status === 'pending_supervisor') return decision === 'rescheduled' ? 'rejected' : 'pending_manager';
  return d.ok ? 'approved' : 'rejected';
}

export const canCancel = (req, me) => !!me && (req.employee_id === me.id || isHR(me))
  && (PENDING.includes(req.status) || (req.status === 'approved' && (isHR(me) || req.start_date > today())));
