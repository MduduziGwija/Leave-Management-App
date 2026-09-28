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
export function countLeaveDays(start, end, { calendarDays = false, halfDay = false, holidays = new Set() } = {}) {
  if (!start || !end || end < start) return 0;
  if (calendarDays) return Math.round((parse(end) - parse(start)) / 86400000) + 1;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = parse(d).getDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(d)) n++;
  }
  if (halfDay && start === end && n === 1) return 0.5;
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

// Returns one row per active leave type: entitled, used, pending, available.
export function computeBalances({ profile, types, requests, overrides, mode, onDate = today() }) {
  return types.filter((t) => t.active !== false).map((t) => {
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
// gov_* follows the public service (PSCBC / DPSA determination); ent_* follows the BCEA.
// HR can change every value in Settings. Check against your department's current determination.
export const DEFAULT_LEAVE_TYPES = [
  { code: 'annual', name: 'Annual / vacation leave', gov_days: 22, senior_days: 30, senior_years: 10, ent_days: 15, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 1 },
  { code: 'sick', name: 'Sick leave (normal)', gov_days: 36, ent_days: 30, cycle_months: 36, cycle_anchor: '2025-01-01', calendar_days: false, sort: 2 },
  { code: 'til', name: 'Sick leave – temporary incapacity', gov_days: null, ent_days: null, cycle_months: 36, cycle_anchor: '2025-01-01', calendar_days: false, sort: 3 },
  { code: 'family', name: 'Family responsibility leave', gov_days: 5, ent_days: 3, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 4 },
  { code: 'maternity', name: 'Maternity leave', gov_days: 120, ent_days: 120, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: true, sort: 5 },
  { code: 'parental', name: 'Parental leave', gov_days: 10, ent_days: 10, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 6 },
  { code: 'adoption', name: 'Adoption leave', gov_days: 45, ent_days: 50, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 7 },
  { code: 'study', name: 'Study leave', gov_days: null, ent_days: null, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 8 },
  { code: 'special', name: 'Special leave', gov_days: null, ent_days: null, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 9 },
  { code: 'unpaid', name: 'Unpaid leave', gov_days: null, ent_days: null, cycle_months: 12, cycle_anchor: '2025-01-01', calendar_days: false, sort: 10 },
];

// ---------- approval routing ----------
// Government: supervisor recommends, then manager/HOD approves (two approvers).
// Enterprise: a single approver (supervisor, or the manager if there is no supervisor).
// Anyone missing is skipped; if nobody is set, HR approves.
export function initialRouting(profile, mode) {
  let sup = profile.supervisor_id || null;
  let mgr = profile.manager_id || null;
  if (mode === 'enterprise') { sup = sup || mgr; mgr = null; }
  if (sup === profile.id) sup = null;
  if (mgr === profile.id) mgr = null;
  const status = sup ? 'pending_supervisor' : mgr ? 'pending_manager' : 'pending_hr';
  return { supervisor_id: sup, manager_id: mgr, status };
}

export function canDecide(req, me) {
  if (!me || req.employee_id === me.id) return false;
  if (isHR(me) && PENDING.includes(req.status)) return true;
  if (req.status === 'pending_supervisor') return req.supervisor_id === me.id;
  if (req.status === 'pending_manager') return req.manager_id === me.id;
  return false;
}

export function nextStatus(req, approve) {
  if (!approve) return 'rejected';
  if (req.status === 'pending_supervisor') return req.manager_id ? 'pending_manager' : 'approved';
  return 'approved';
}
