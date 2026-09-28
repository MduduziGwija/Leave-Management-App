// Checks that the built-in templates fill completely. Run with: npm test (after npm install).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { DEFAULT_LEAVE_TYPES } from '../js/logic.js';
import { leaveFormData, transmittalData } from '../js/forms.js';

const read = (f) => fs.readFileSync(new URL(`../templates/${f}`, import.meta.url));
const render = (buf, data) => {
  const d = new Docxtemplater(new PizZip(buf), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  d.render(data);
  return d.getZip().file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
};
const tags = (buf) => {
  const z = new PizZip(buf);
  const text = Object.keys(z.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).map((n) => z.file(n).asText().replace(/<[^>]+>/g, '')).join(' ');
  return [...new Set([...text.matchAll(/\{([#/]?[\w.]+)\}/g)].map((m) => m[1].replace(/^[#/]/, '')))];
};

const employee = { id: 'e', full_name: 'Sipho Ndlovu', surname: 'Ndlovu', initials: 'S', department: 'Infrastructure', component: 'EPWP', shift_worker: false, casual_employee: true };
const settings = { org_name: 'Dept', department_name: 'Infrastructure', transmittal_to: 'CRU', transmittal_from: 'Programme', contact_person: 'L M', contact_tel: '021' };
const byId = { e: employee, s: { full_name: 'Sam Sup' }, m: { full_name: 'Mandla Mgr' } };
const req = {
  id: 'r', ref_no: 7, employee_id: 'e', leave_type: 'annual', start_date: '2026-10-05', end_date: '2026-10-09', days: 5, part_day: false,
  created_at: '2026-09-28T10:00:00Z', supervisor_decision: 'recommended', supervisor_by: 's', supervisor_at: '2026-09-29T10:00:00Z',
  manager_decision: 'approved_full_pay', manager_by: 'm', manager_at: '2026-09-30T10:00:00Z', leave_address: '1 Road',
};

test('every tag in the Z1 template has data', () => {
  const data = leaveFormData(req, { employee, priv: { persal_number: '123' }, types: DEFAULT_LEAVE_TYPES, byId, settings });
  const missing = tags(read('z1a-leave-form.docx')).filter((t) => !(t in data));
  assert.deepEqual(missing, []);
  const text = render(read('z1a-leave-form.docx'), data);
  assert.match(text, /Surname: Ndlovu/);
  assert.match(text, /Annual leave 05\/10\/2026 09\/10\/2026 5/);
  assert.match(text, /Recommended \[X\]/);
  assert.match(text, /Approved with full pay \[X\]/);
  assert.match(text, /Casual employee: Yes \[X\]/);
});

test('part-day leave fills Section B', () => {
  const data = leaveFormData({ ...req, leave_type: 'family', part_day: true, start_date: '2026-10-05', end_date: '2026-10-05', start_time: '08:00:00', end_time: '10:30:00', days: 0.31 },
    { employee, types: DEFAULT_LEAVE_TYPES, byId, settings });
  assert.equal(data.family_part_h, '2');
  assert.equal(data.family_part_m, '30');
  assert.equal(data.family_start, '');
});

test('every tag in the transmittal template has data, one row per application', () => {
  const reqs = [req, { ...req, id: 'r2', leave_type: 'sick' }, { ...req, id: 'r3', leave_type: 'family' }];
  const data = transmittalData({ slip_no: 3, created_at: '2026-10-01T08:00:00Z', created_by: 's' }, reqs, { types: DEFAULT_LEAVE_TYPES, byId, settings });
  const known = new Set([...Object.keys(data), ...Object.keys(data.items[0])]);
  assert.deepEqual(tags(read('transmittal-slip.docx')).filter((t) => !known.has(t)), []);
  const text = render(read('transmittal-slip.docx'), data);
  assert.match(text, /1 Ndlovu S 05\/10\/2026 09\/10\/2026/);
  assert.match(text, /3 Ndlovu S \(Family responsibility leave\)/);
  assert.match(text, /NO\. OF FORMS SUBMITTED 3/);
  assert.doesNotMatch(text, /\{[a-z#/]/);
});
