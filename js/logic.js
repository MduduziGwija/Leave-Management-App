// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Shared business rules used by both the demo backend and the Supabase backend.

export const STATUS_LABELS = {
  pending_supervisor: 'Awaiting supervisor',
  pending_manager: 'Awaiting approver',
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
// ---------- work patterns ----------
// Which weekdays someone works, as ISO day digits: 1 = Monday … 7 = Sunday. Default Monday to Friday.
// Weekend and shift workers (e.g. '123456' or '1234567') have those days counted as leave days.
export const DEFAULT_WORK_DAYS = '12345';
export const WORK_PATTERNS = [
  ['12345', 'Monday to Friday'], ['123456', 'Monday to Saturday'], ['1234567', 'Every day (7 days)'], ['custom', 'Other days…'],
];
export const DAY_NAMES = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']];
export const workDaysOf = (profile) => (profile && /^[1-7]{1,7}$/.test(profile.work_days || '') ? profile.work_days : DEFAULT_WORK_DAYS);
export const isoDay = (d) => parse(d).getDay() || 7;
export const isWorkDay = (d, workDays = DEFAULT_WORK_DAYS) => workDays.includes(String(isoDay(d)));
export const describeWorkDays = (w) => WORK_PATTERNS.find(([k]) => k === w)?.[1] || DAY_NAMES.filter(([k]) => w.includes(k)).map(([, n]) => n).join(', ');

// Leave days between two ISO dates, inclusive: the days this person normally works, minus public
// holidays. Leave the law counts in calendar days (e.g. maternity) counts every day.
export function countLeaveDays(start, end, { calendarDays = false, holidays = new Set(), workDays = DEFAULT_WORK_DAYS } = {}) {
  if (!start || !end || end < start) return 0;
  if (calendarDays) return Math.round((parse(end) - parse(start)) / 86400000) + 1;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWorkDay(d, workDays) && !holidays.has(d)) n++;
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
  // Government: when the supervisor is also the approver (or there is no separate manager / HOD), that
  // one person recommends and approves in a single step, as a chief director does for their own staff.
  if (mode === 'enterprise') { mgr = sup || mgr; sup = null; } else if (!mgr) mgr = sup;
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
  if (req.status === 'pending_supervisor' && isOneStep(req)) return ['approved_full_pay', 'approved_without_pay', 'not_approved', 'rescheduled'];
  if (req.status === 'pending_supervisor') return ['recommended', 'not_recommended', 'rescheduled'];
  if ((req.mode || mode) === 'enterprise') return ['approved', 'rejected'];
  return ['approved_full_pay', 'approved_without_pay', 'not_approved'];
}

// The same person recommends and approves (supervisor and manager / HOD are one person).
export const isOneStep = (req) => !!req.supervisor_id && req.supervisor_id === req.manager_id;
// Labels for the one-step choices, so it is clear both parts of the Z1 are being signed.
const ONE_STEP_LABELS = {
  approved_full_pay: 'Recommended and approved with full pay', approved_without_pay: 'Recommended and approved without pay',
  not_approved: 'Not recommended and not approved',
};
export const decisionLabel = (req, d) => (req.status === 'pending_supervisor' && isOneStep(req) && ONE_STEP_LABELS[d]) || DECISIONS[d]?.label || d;
// What the recommendation is recorded as when a one-step approver gives the final decision.
export const recommendationFor = (d) => (d === 'not_approved' ? 'not_recommended' : 'recommended');

export function canDecide(req, me) {
  if (!me || req.employee_id === me.id) return false;
  if (isHR(me) && PENDING.includes(req.status)) return true;
  if (req.status === 'pending_supervisor') return req.supervisor_id === me.id || actsFor(me, req.supervisor_id);
  if (req.status === 'pending_manager') {
    return (req.manager_id === me.id || actsFor(me, req.manager_id)) && !secondSignatureBlocked(req, me);
  }
  return false;
}

// ---------- acting appointments ----------
// While an approver is away, the admin appoints someone to act for them. me.acting_for holds the
// ids of the people this person is acting for today (set when data loads).
export const actsFor = (me, principalId) => !!me && !!principalId && (me.acting_for || []).includes(principalId);
export const isActingNow = (a, day = today()) => !!a && !a.cancelled_at && a.start_date <= day && a.end_date >= day;
export const actingToday = (list, day = today()) => (list || []).filter((a) => isActingNow(a, day));
// Two signatures: whoever recommended cannot also give the final decision, unless they are the
// manager / HOD themself.
export const secondSignatureBlocked = (req, me) => !!me && req.status === 'pending_manager' && req.supervisor_by === me.id
  && req.manager_id !== me.id && !isOneStep(req) && !isHR(me);
// Waiting for this person's decision in an acting capacity (they recommended it, so they can't approve).
export const actingBlocked = (req, me) => !!me && actsFor(me, req.manager_id) && secondSignatureBlocked(req, me);

// The number in a salary level / pay grade such as '12' or 'Level 12'.
export const levelNum = (v) => { const m = /\d+/.exec(String(v ?? '')); return m ? Number(m[0]) : null; };
// Checks the level rule: the acting person must be at most `below` levels under the person they act for.
export function actingCheck(principalLevel, actingLevel, below = 1) {
  const pl = levelNum(principalLevel); const al = levelNum(actingLevel);
  if (pl === null) return { ok: false, why: 'the person being acted for has no level recorded' };
  if (al === null) return { ok: false, why: 'no level recorded' };
  if (al < pl - Number(below ?? 1)) return { ok: false, why: `level ${al}; needs ${pl - Number(below ?? 1)} or higher` };
  return { ok: true, why: `level ${al}` };
}
// Returns an error message if the new appointment clashes with an existing one, else ''.
export function actingOverlap(list, principalId, start, end) {
  const clash = (list || []).find((a) => a.principal_id === principalId && !a.cancelled_at && a.start_date <= end && a.end_date >= start);
  return clash ? `Someone is already acting for this person from ${clash.start_date} to ${clash.end_date}` : '';
}

// A "not recommended" still goes to the manager / HOD, who makes the final decision.
export function nextStatus(req, decision) {
  const d = DECISIONS[decision];
  if (!d) throw new Error('Unknown decision');
  if (req.status === 'pending_supervisor' && d.step === 'supervisor') return decision === 'rescheduled' ? 'rejected' : 'pending_manager';
  return d.ok ? 'approved' : 'rejected';
}

// ---------- return early / recall ----------
// Approved leave that is not over yet can be shortened: the employee returns early, or the
// supervisor / manager / HR recalls them. Part-day leave can only be cancelled.
const shortenable = (req) => APPROVED.includes(req.status) && !req.part_day && req.end_date > req.start_date && req.end_date >= today();
export const canReturnEarly = (req, me) => !!me && shortenable(req) && (req.employee_id === me.id || isHR(me));
export const canRecall = (req, me) => !!me && shortenable(req) && req.employee_id !== me.id
  && (req.supervisor_id === me.id || req.manager_id === me.id || actsFor(me, req.supervisor_id) || actsFor(me, req.manager_id) || isHR(me))
  && !req.recall_request_end;
// Enterprise recalls wait for the employee's answer (BCEA s20(9): no work during annual leave unless agreed).
export const canRespondRecall = (req, me) => !!me && req.employee_id === me.id && !!req.recall_request_end;

// Log entries for these changes, in plain words.
export const EVENT_LABELS = {
  returned_early: 'Returned early', recalled: 'Recalled from leave', recall_requested: 'Recall requested',
  recall_accepted: 'Recall accepted', recall_declined: 'Recall declined', submitted: 'Submitted',
  transmitted: 'Put on a transmittal slip', captured: 'Captured by HR', checked: 'Checked by HR', cancelled: 'Cancelled',
};

export const canCancel = (req, me) => !!me && (req.employee_id === me.id || isHR(me))
  && (PENDING.includes(req.status) || (req.status === 'approved' && (isHR(me) || req.start_date > today())));
