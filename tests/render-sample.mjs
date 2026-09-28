// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Fills the starter templates with sample data and writes them to a folder, for checking by eye.
//   node tests/render-sample.mjs out-folder
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { DEFAULT_LEAVE_TYPES } from '../js/logic.js';
import { leaveFormData, transmittalData } from '../js/forms.js';

const out = process.argv[2] || '.';
const read = (f) => fs.readFileSync(new URL(`../templates/${f}`, import.meta.url));
const fill = (buf, data) => { const d = new Docxtemplater(new PizZip(buf), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' }); d.render(data); return d.getZip().generate({ type: 'nodebuffer' }); };

const employee = { id: 'e', full_name: 'Lindiwe Mahlangu', surname: 'Mahlangu', initials: 'L', department: 'Public Works', component: 'Roads Maintenance', shift_worker: false, casual_employee: false };
const byId = { e: employee, s: { full_name: 'Johan van Wyk' }, m: { full_name: 'Ayesha Patel' }, h: { full_name: 'Lerato Mokoena', surname: 'Mokoena', initials: 'L', component: 'Human Resources' } };
const settings = { org_name: 'Department of Public Works', department_name: 'Public Works', transmittal_to: 'HR Records Centre, 12 Example Street, Sampleton, 0001', transmittal_from: 'Roads Maintenance Programme', contact_person: 'Lerato Mokoena', contact_tel: '012 345 6789' };
const req = {
  id: 'r', ref_no: 4, employee_id: 'e', leave_type: 'annual', start_date: '2026-10-12', end_date: '2026-10-16', days: 5, part_day: false,
  leave_address: '7 Sample Road, Sampleton', created_at: '2026-09-28T10:00:00Z',
  supervisor_decision: 'recommended', supervisor_by: 's', supervisor_at: '2026-09-29T09:15:00Z', supervisor_comment: 'Work handed over.',
  manager_decision: 'approved_full_pay', manager_by: 'm', manager_at: '2026-09-30T11:40:00Z',
  captured_by: 'h', captured_at: '2026-10-02T08:00:00Z',
};
fs.writeFileSync(path.join(out, 'sample-z1.docx'), fill(read('z1a-leave-form.docx'), leaveFormData(req, { employee, priv: { persal_number: '21006895' }, types: DEFAULT_LEAVE_TYPES, byId, settings })));
const reqs = [req, { ...req, id: 'r2', leave_type: 'sick', start_date: '2026-10-05', end_date: '2026-10-06' }, { ...req, id: 'r3', leave_type: 'family', start_date: '2026-10-20', end_date: '2026-10-20' }];
fs.writeFileSync(path.join(out, 'sample-transmittal.docx'), fill(read('transmittal-slip.docx'), transmittalData({ slip_no: 3, created_at: '2026-10-01T08:00:00Z', created_by: 'h' }, reqs, { types: DEFAULT_LEAVE_TYPES, byId, settings })));
console.log('Wrote sample-z1.docx and sample-transmittal.docx to', out);
