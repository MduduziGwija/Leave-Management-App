// Excel reports. Each function returns a sheet description for workbook() in xlsx.js.
import { STATUS_LABELS, DECISIONS, computeBalances, staffNumberLabel, payLabel, ROLE_LABELS, isHR } from './logic.js';
import { workbook } from './xlsx.js';
import { download } from './ui.js';

const typeName = (ctx, code) => ctx.types.find((t) => t.code === code)?.name || code;
const nameOf = (ctx, id) => ctx.byId[id]?.full_name || '';
const d10 = (s) => (s ? String(s).slice(0, 10) : '');
const hm = (t) => (t ? String(t).slice(0, 5) : '');

export function exportWorkbook(sheets, filename) {
  download(workbook(sheets), filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

// Every detail of each leave application, including the approval trail.
export function leaveSheet(ctx, rows, name = 'Leave') {
  const gov = ctx.settings.mode === 'government';
  const hr = isHR(ctx.me);
  const columns = [
    { header: 'Ref', type: 'number', width: 8 }, { header: 'Employee', width: 24 },
    ...(hr ? [{ header: staffNumberLabel(ctx.settings.mode), width: 16 }] : []),
    { header: 'Department', width: 18 }, { header: 'Component', width: 18 }, { header: 'Leave type', width: 30 },
    { header: 'Start', type: 'date' }, { header: 'End', type: 'date' }, { header: 'Days', type: 'number', width: 8 },
    { header: 'Part day from', width: 12 }, { header: 'Part day to', width: 12 }, { header: 'Status', width: 22 },
    { header: 'Applied on', type: 'date' }, { header: 'Reason / remarks', width: 30 },
    ...(gov ? [{ header: 'Supervisor', width: 22 }, { header: 'Recommendation', width: 18 }, { header: 'Recommended on', type: 'date' }, { header: 'Supervisor remarks', width: 28 }] : []),
    { header: gov ? 'Manager / HOD' : 'Approver', width: 22 }, { header: 'Decision', width: 22 }, { header: 'Decided on', type: 'date' }, { header: 'Approver remarks', width: 28 },
    ...(gov ? [{ header: 'Transmittal slip', width: 14 }, { header: 'Captured by', width: 20 }, { header: 'Captured on', type: 'date' }] : []),
  ];
  const slipNo = (id) => ctx.batches?.find((b) => b.id === id)?.slip_no ?? '';
  const data = rows.map((r) => {
    const e = ctx.byId[r.employee_id] || {};
    return [
      r.ref_no, e.full_name, ...(hr ? [r.persal_number || ''] : []), e.department, e.component, typeName(ctx, r.leave_type),
      r.start_date, r.end_date, Number(r.days), r.part_day ? hm(r.start_time) : '', r.part_day ? hm(r.end_time) : '', STATUS_LABELS[r.status] || r.status,
      d10(r.created_at), r.reason,
      ...(gov ? [nameOf(ctx, r.supervisor_by || r.supervisor_id), DECISIONS[r.supervisor_decision]?.label || '', d10(r.supervisor_at), r.supervisor_comment || ''] : []),
      nameOf(ctx, r.manager_by || r.manager_id), DECISIONS[r.manager_decision]?.label || '', d10(r.manager_at), r.manager_comment || '',
      ...(gov ? [r.batch_id ? slipNo(r.batch_id) : '', nameOf(ctx, r.captured_by), d10(r.captured_at)] : []),
    ];
  });
  return { name, columns, rows: data };
}

// Staff list. Private details are included only for HR (the database hides them from everyone else anyway).
export function employeesSheet(ctx, privById = {}) {
  const mode = ctx.settings.mode;
  const gov = mode === 'government';
  const columns = [
    { header: 'Full name', width: 24 }, { header: 'Surname', width: 16 }, { header: 'Initials', width: 8 }, { header: 'Email', width: 28 },
    { header: 'Role', width: 20 }, { header: 'Department', width: 18 }, { header: 'Component', width: 18 }, { header: 'Job title', width: 22 },
    { header: 'Supervisor', width: 22 }, { header: gov ? 'Manager / HOD' : 'Manager', width: 22 }, { header: 'Employment start', type: 'date' },
    { header: 'Active', width: 8 },
    ...(gov ? [{ header: 'Shift worker', width: 12 }, { header: 'Casual employee', width: 14 }] : []),
    { header: staffNumberLabel(mode), width: 16 }, { header: 'ID number', width: 16 }, { header: 'Phone', width: 14 },
    { header: payLabel(mode), width: 12 }, { header: 'Date of birth', type: 'date' }, { header: 'Home address', width: 30 }, { header: 'Emergency contact', width: 24 },
  ];
  const yn = (b) => (b ? 'Yes' : 'No');
  const rows = ctx.profiles.map((p) => {
    const v = privById[p.id] || {};
    return [p.full_name, p.surname, p.initials, p.email, ROLE_LABELS[p.role] || p.role, p.department, p.component, p.job_title,
      nameOf(ctx, p.supervisor_id), nameOf(ctx, p.manager_id), p.employment_start, yn(p.active),
      ...(gov ? [yn(p.shift_worker), yn(p.casual_employee)] : []),
      v.persal_number, v.id_number, v.phone, v.salary_level, v.date_of_birth, v.address, v.emergency_contact];
  });
  return { name: 'Employees', columns, rows };
}

// Balance of every leave type for every active employee, for the current cycle.
export function balancesSheet(ctx, overrides, people = ctx.profiles.filter((p) => p.active)) {
  const columns = [
    { header: 'Employee', width: 24 }, { header: 'Department', width: 18 }, { header: 'Leave type', width: 30 },
    { header: 'Cycle start', type: 'date' }, { header: 'Cycle end', type: 'date' }, { header: 'Allowed', type: 'number', width: 9 },
    { header: 'Carried over', type: 'number', width: 12 }, { header: 'Taken', type: 'number', width: 8 }, { header: 'Pending', type: 'number', width: 9 },
    { header: 'Left', type: 'number', width: 8 },
  ];
  const rows = [];
  for (const p of people) {
    const bal = computeBalances({ profile: p, types: ctx.types, requests: ctx.requests.filter((r) => r.employee_id === p.id), overrides, mode: ctx.settings.mode });
    for (const b of bal) {
      if (b.entitled == null && !b.used && !b.pending) continue;
      rows.push([p.full_name, p.department, b.type.name, b.period.start, b.period.end, b.entitled ?? '', b.carried || '', b.used, b.pending, b.available ?? '']);
    }
  }
  return { name: 'Leave balances', columns, rows };
}

// Who is out in a period. Leave types appear only where the viewer may see them.
export function whoIsOutSheet(ctx, rows, name = "Who's out") {
  return {
    name,
    columns: [{ header: 'Employee', width: 24 }, { header: 'Department', width: 18 }, { header: 'Leave type', width: 30 },
      { header: 'Start', type: 'date' }, { header: 'End', type: 'date' }, { header: 'Part day', width: 10 }, { header: 'Status', width: 22 }],
    rows: rows.map((r) => [r.full_name, r.department, r.leave_type ? typeName(ctx, r.leave_type) : '', r.start_date, r.end_date, r.part_day ? 'Yes' : '', STATUS_LABELS[r.status] || r.status]),
  };
}
