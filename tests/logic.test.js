// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saPublicHolidays, countLeaveDays, cyclePeriod, computeBalances, initialRouting, nextStatus, canDecide,
  partDayFraction, DEFAULT_LEAVE_TYPES, defaultEntitlement, canReturnEarly, canRecall, canRespondRecall, addDays, today, workDaysOf, describeWorkDays,
  actingCheck, actingOverlap, actingToday, levelNum, actsFor,
} from '../js/logic.js';

const hols = (...years) => new Set(years.flatMap(saPublicHolidays).map((h) => h.date));

test('South African public holidays, including Easter and Sunday rule', () => {
  const h = saPublicHolidays(2026).map((x) => x.date);
  assert.ok(h.includes('2026-04-03'), 'Good Friday 2026');
  assert.ok(h.includes('2026-04-06'), 'Family Day 2026');
  assert.ok(h.includes('2026-08-10'), "Women's Day falls on Sunday, so Monday is off");
  assert.ok(saPublicHolidays(2025).map((x) => x.date).includes('2025-04-18'), 'Good Friday 2025');
});

test('working days skip weekends and public holidays', () => {
  assert.equal(countLeaveDays('2026-12-21', '2027-01-04', { holidays: hols(2026, 2027) }), 9);
  assert.equal(countLeaveDays('2026-10-05', '2026-10-09', { holidays: hols(2026) }), 5);
  assert.equal(countLeaveDays('2026-10-10', '2026-10-11', { holidays: hols(2026) }), 0, 'weekend only');
  assert.equal(countLeaveDays('2027-02-01', '2027-05-31', { calendarDays: true }), 120, 'maternity counts calendar days');
});

test('part-day leave is a fraction of the working day', () => {
  assert.equal(partDayFraction('08:00', '12:00', 8), 0.5);
  assert.equal(partDayFraction('09:00', '10:30', 8), 0.19);
  assert.equal(partDayFraction('12:00', '08:00', 8), 0);
});

test('leave cycles: calendar year for annual, 3 years for sick', () => {
  const annual = DEFAULT_LEAVE_TYPES.find((t) => t.code === 'annual');
  const sick = DEFAULT_LEAVE_TYPES.find((t) => t.code === 'sick');
  assert.deepEqual(cyclePeriod(annual, '2026-09-28'), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(cyclePeriod(sick, '2026-09-28'), { start: '2025-01-01', end: '2027-12-31' });
  assert.deepEqual(cyclePeriod(sick, '2028-01-01'), { start: '2028-01-01', end: '2030-12-31' });
});

test('annual leave: 22 days, 30 after 10 years (government); 15 (enterprise)', () => {
  const annual = DEFAULT_LEAVE_TYPES.find((t) => t.code === 'annual');
  assert.equal(defaultEntitlement(annual, 'government', { employment_start: '2022-01-01' }), 22);
  assert.equal(defaultEntitlement(annual, 'government', { employment_start: '2010-01-01' }), 30);
  assert.equal(defaultEntitlement(annual, 'enterprise', { employment_start: '2010-01-01' }), 15);
});

test('balances count approved and pending leave in the cycle, and HR overrides', () => {
  const profile = { id: 'e1', employment_start: '2020-01-01' };
  const requests = [
    { employee_id: 'e1', leave_type: 'annual', start_date: '2026-03-02', days: 5, status: 'captured' },
    { employee_id: 'e1', leave_type: 'annual', start_date: '2026-10-05', days: 3, status: 'pending_manager' },
    { employee_id: 'e1', leave_type: 'annual', start_date: '2026-06-01', days: 4, status: 'rejected' },
    { employee_id: 'e1', leave_type: 'annual', start_date: '2025-06-01', days: 10, status: 'approved' },
  ];
  const [annual] = computeBalances({ profile, types: DEFAULT_LEAVE_TYPES.slice(0, 1), requests, overrides: [], mode: 'government', onDate: '2026-09-28' });
  assert.deepEqual([annual.entitled, annual.used, annual.pending, annual.available], [22, 5, 3, 14]);
  const overrides = [{ employee_id: 'e1', leave_type: 'annual', period_start: '2026-01-01', entitled: 25, carried_over: 2 }];
  const [o] = computeBalances({ profile, types: DEFAULT_LEAVE_TYPES.slice(0, 1), requests, overrides, mode: 'government', onDate: '2026-09-28' });
  assert.equal(o.available, 19);
});

test('routing: government uses two approvers, enterprise one', () => {
  const p = { id: 'e', supervisor_id: 's', manager_id: 'm' };
  assert.deepEqual(initialRouting(p, 'government'), { supervisor_id: 's', manager_id: 'm', status: 'pending_supervisor' });
  assert.deepEqual(initialRouting(p, 'enterprise'), { supervisor_id: null, manager_id: 's', status: 'pending_manager' });
  assert.deepEqual(initialRouting({ id: 'e', supervisor_id: 's' }, 'government'), { supervisor_id: null, manager_id: 's', status: 'pending_manager' });
  assert.deepEqual(initialRouting({ id: 'e' }, 'government'), { supervisor_id: null, manager_id: null, status: 'pending_hr' });
});

test('decisions follow the Z1 form', () => {
  const r = { employee_id: 'e', supervisor_id: 's', manager_id: 'm', status: 'pending_supervisor' };
  assert.equal(nextStatus(r, 'recommended'), 'pending_manager');
  assert.equal(nextStatus(r, 'not_recommended'), 'pending_manager', 'HOD still decides');
  assert.equal(nextStatus(r, 'rescheduled'), 'rejected');
  const r2 = { ...r, status: 'pending_manager' };
  assert.equal(nextStatus(r2, 'approved_full_pay'), 'approved');
  assert.equal(nextStatus(r2, 'approved_without_pay'), 'approved');
  assert.equal(nextStatus(r2, 'not_approved'), 'rejected');
});

test('nobody decides on their own leave; HR can act on any pending request', () => {
  const r = { employee_id: 'e', supervisor_id: 's', manager_id: 'm', status: 'pending_supervisor' };
  assert.equal(canDecide(r, { id: 's', role: 'approver' }), true);
  assert.equal(canDecide(r, { id: 'm', role: 'approver' }), false, 'manager waits for the supervisor');
  assert.equal(canDecide(r, { id: 'h', role: 'hr' }), true);
  assert.equal(canDecide({ ...r, supervisor_id: 'e' }, { id: 'e', role: 'hr' }), false);
});

test('return early and recall: who may do what', () => {
  const t = today();
  const onLeave = { employee_id: 'e', supervisor_id: 's', manager_id: 'm', status: 'approved', start_date: addDays(t, -2), end_date: addDays(t, 3), part_day: false };
  const staff = { id: 'e', role: 'staff' }; const sup = { id: 's', role: 'approver' }; const other = { id: 'x', role: 'staff' }; const hr = { id: 'h', role: 'hr' };
  assert.equal(canReturnEarly(onLeave, staff), true, 'employee can return early');
  assert.equal(canReturnEarly(onLeave, sup), false, 'supervisor recalls instead');
  assert.equal(canRecall(onLeave, sup), true);
  assert.equal(canRecall(onLeave, hr), true);
  assert.equal(canRecall(onLeave, other), false, 'unrelated staff cannot recall');
  assert.equal(canRecall(onLeave, staff), false, 'nobody recalls themselves');
  assert.equal(canRecall({ ...onLeave, status: 'pending_manager' }, sup), false, 'only approved leave');
  assert.equal(canRecall({ ...onLeave, part_day: true }, sup), false, 'part-day leave is cancelled, not shortened');
  assert.equal(canRecall({ ...onLeave, end_date: addDays(t, -1) }, sup), false, 'leave already over');
  assert.equal(canRecall({ ...onLeave, recall_request_end: t }, sup), false, 'one recall request at a time');
  assert.equal(canRespondRecall({ ...onLeave, recall_request_end: t }, staff), true);
  assert.equal(canRespondRecall({ ...onLeave, recall_request_end: t }, sup), false);
});

test('work patterns: weekend and shift workers have their weekend days counted', () => {
  const h = hols(2026);
  assert.equal(countLeaveDays('2026-11-06', '2026-11-09', { holidays: h }), 2, 'Mon-Fri worker: Fri + Mon');
  assert.equal(countLeaveDays('2026-11-06', '2026-11-09', { holidays: h, workDays: '123456' }), 3, 'Mon-Sat worker: Fri, Sat, Mon');
  assert.equal(countLeaveDays('2026-11-06', '2026-11-09', { holidays: h, workDays: '1234567' }), 4, '7-day worker: every day');
  assert.equal(countLeaveDays('2026-12-24', '2026-12-27', { holidays: h, workDays: '1234567' }), 2, 'public holidays still not counted (25, 26 Dec)');
  assert.equal(workDaysOf({ work_days: '67' }), '67');
  assert.equal(workDaysOf({}), '12345', 'default Monday to Friday');
  assert.equal(workDaysOf({ work_days: 'junk' }), '12345');
  assert.equal(describeWorkDays('1234567'), 'Every day (7 days)');
  assert.equal(describeWorkDays('136'), 'Mon, Wed, Sat');
});

test('acting appointments: level rule, two signatures, acting approver can decide and recall', () => {
  assert.equal(levelNum('Level 12'), 12);
  assert.equal(levelNum(''), null);
  assert.equal(actingCheck('14', '13').ok, true);
  assert.equal(actingCheck('14', '12').ok, false);
  assert.equal(actingCheck('14', '12', 2).ok, true, 'admin can allow two levels below');
  assert.equal(actingCheck('14', '').ok, false);
  const t = today();
  const list = [{ principal_id: 'hod', acting_id: 'dir', start_date: addDays(t, -1), end_date: addDays(t, 2) },
    { principal_id: 'hod', acting_id: 'x', start_date: addDays(t, 10), end_date: addDays(t, 12), cancelled_at: '2026-01-01' }];
  assert.equal(actingToday(list).length, 1);
  assert.ok(actingOverlap(list, 'hod', addDays(t, 2), addDays(t, 5)));
  assert.equal(actingOverlap(list, 'hod', addDays(t, 10), addDays(t, 11)), '', 'cancelled ones do not clash');
  const dir = { id: 'dir', role: 'approver', acting_for: ['hod'] };
  const req = { employee_id: 's1', supervisor_id: 'sup', manager_id: 'hod', status: 'pending_manager', supervisor_by: 'sup' };
  assert.equal(actsFor(dir, 'hod'), true);
  assert.equal(canDecide(req, dir), true, 'acting HOD approves');
  assert.equal(canDecide(req, { id: 'dir', role: 'approver' }), false, 'not when not acting');
  assert.equal(canDecide({ ...req, supervisor_by: 'dir' }, dir), false, 'the person who recommended cannot also approve');
  assert.equal(canDecide({ ...req, status: 'pending_supervisor', supervisor_id: 'hod' }, dir), true, 'acting for a supervisor');
  const onLeave = { ...req, status: 'approved', start_date: addDays(t, -1), end_date: addDays(t, 3) };
  assert.equal(canRecall(onLeave, dir), true);
});
