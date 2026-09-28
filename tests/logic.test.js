// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saPublicHolidays, countLeaveDays, cyclePeriod, computeBalances, initialRouting, nextStatus, canDecide,
  partDayFraction, DEFAULT_LEAVE_TYPES, defaultEntitlement,
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
