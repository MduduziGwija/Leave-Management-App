// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Builds the starter Word templates in templates/.
//
//   npm install
//   node tools/build-templates.mjs --z1 your-z1.docx --transmittal your-transmittal.docx
//
// 1. templates/z1a-leave-form.docx: made from your own Z1(a) saved as .docx (Word: File > Save As >
//    Word Document). The layout is kept exactly; tags go into the existing cells and empty lines,
//    so the form stays on one page. Without --z1, a similar layout is built from scratch instead.
// 2. templates/transmittal-slip.docx: made from your own transmittal .docx: logos are removed and
//    {tags} are put into the cells, with one table row repeated per leave application.
//    Without an input file, a plain transmittal slip is built instead.
//
// The tags are listed in the app under Templates -> "Tags you can use".

import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'templates');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ------------------------------------------------------------------ tiny docx writer

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function run(text, { b = false, i = false, sz = 16 } = {}) {
  const props = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return String(text).split('\n').map((line, n) =>
    `<w:r>${props}${n ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}

function para(content, { align = 'left', before = 0, after = 40, keep = false } = {}) {
  const runs = Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? run(c) : run(c.t, c))).join('')
    : typeof content === 'string' ? run(content) : run(content.t, content);
  return `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${before}" w:after="${after}"/><w:jc w:val="${align}"/></w:pPr>${runs}</w:p>`;
}

// cells: [{ c: content, w: twips, span, shade, align }]
function table(widths, rows) {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const border = (s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  const body = rows.map((cells) => {
    let col = 0;
    const tcs = cells.map((cell) => {
      const span = cell.span || 1;
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
      col += span;
      const shade = cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>` : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${shade}<w:vAlign w:val="center"/></w:tcPr>${para(cell.c ?? '', { align: cell.align || 'left', after: 0 })}</w:tc>`;
    }).join('');
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function docx(bodyXml, { landscape = false } = {}) {
  const [pw, ph] = landscape ? [16838, 11906] : [11906, 16838];
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="284" w:footer="284" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ------------------------------------------------------------------ Z1(a) leave form

function buildZ1() {
  const H = 'D9D9D9';
  const b = (t) => ({ t, b: true });
  const small = (t) => ({ t, sz: 13, i: true });
  const out = [];
  out.push(table([8000, 2772], [[{ c: b('APPLICATION FOR LEAVE OF ABSENCE'), }, { c: b('Z1 (a)'), align: 'right' }]])
    .replace(/<w:tblBorders>.*?<\/w:tblBorders>/, '<w:tblBorders/>'));
  out.push(para('', { after: 60 }));

  out.push(table([1500, 2400, 1300, 1400, 1300, 2872], [
    [{ c: b('Surname:') }, { c: '{surname}' }, { c: b('Initials:') }, { c: '{initials}' }, { c: b('PERSAL No:') }, { c: '{persal_number}' }],
    [{ c: b('Department:') }, { c: '{department}' }, { c: b('Component:') }, { c: '{component}', span: 3 }],
    [{ c: b('Shift worker:') }, { c: 'Yes [{shift_yes}]   No [{shift_no}]' }, { c: b('Casual employee:') }, { c: 'Yes [{casual_yes}]   No [{casual_no}]', span: 3 }],
    [{ c: b('Address during the leave period:') }, { c: '{leave_address}', span: 5 }],
  ]));

  out.push(para(b('SECTION A: For periods covering full days'), { before: 100, keep: true }));
  const wA = [5172, 1900, 1900, 1800];
  const rowA = (name, code) => [{ c: name }, { c: `{${code}_start}`, align: 'center' }, { c: `{${code}_end}`, align: 'center' }, { c: `{${code}_days}`, align: 'center' }];
  out.push(table(wA, [
    [{ c: b('Type of leave taken as working days'), shade: H }, { c: b('Start date'), shade: H, align: 'center' }, { c: b('End date'), shade: H, align: 'center' }, { c: b('Number of working days'), shade: H, align: 'center' }],
    rowA('Annual leave', 'annual'),
    rowA('Normal sick leave', 'sick'),
    rowA('Temporary incapacity leave', 'til'),
    rowA('Leave for occupational injuries and disease', 'iod'),
    rowA('Adoption leave (provide supporting evidence)', 'adoption'),
    rowA('Family responsibility leave (provide supporting evidence)', 'family'),
    rowA('Pre-natal leave (provide supporting evidence)', 'prenatal'),
    rowA('Paternity leave (provide supporting evidence)', 'paternity'),
    rowA('Special leave (provide supporting evidence)', 'special'),
    [{ c: 'Specify type of special leave' }, { c: '{special_type}', span: 3 }],
    rowA('Leave for union office bearers (provide supporting evidence)', 'union_office'),
    rowA('Leave for union shop stewards (provide supporting evidence)', 'union_steward'),
    [{ c: 'Specify union affiliation' }, { c: '{union_affiliation}', span: 3 }],
  ]));
  out.push(para('', { after: 40 }));
  out.push(table(wA, [
    [{ c: b('Type of leave taken as calendar days / months'), shade: H }, { c: b('Start date'), shade: H, align: 'center' }, { c: b('End date'), shade: H, align: 'center' }, { c: b('Number of days / months'), shade: H, align: 'center' }],
    [{ c: 'Unpaid leave (provide supporting evidence)' }, { c: '{unpaid_start}', align: 'center' }, { c: '{unpaid_end}', align: 'center' }, { c: '{unpaid_days} days', align: 'center' }],
    [{ c: 'Maternity leave (attach medical certificate)' }, { c: '{maternity_start}', align: 'center' }, { c: '{maternity_end}', align: 'center' }, { c: '{maternity_months} months', align: 'center' }],
    [{ c: 'Surrogacy leave: commissioning parent (provide supporting evidence)' }, { c: '{surrogacy_parent_start}', align: 'center' }, { c: '{surrogacy_parent_end}', align: 'center' }, { c: '{surrogacy_parent_months} months', align: 'center' }],
    [{ c: 'Surrogacy leave: surrogate mother (provide supporting evidence)' }, { c: '{surrogacy_mother_start}', align: 'center' }, { c: '{surrogacy_mother_end}', align: 'center' }, { c: '{surrogacy_mother_weeks} weeks', align: 'center' }],
  ]));

  out.push(para(b('SECTION B: For periods covering parts of a day or fractions'), { before: 100, keep: true }));
  const rowB = (name, code) => [{ c: name }, { c: `{${code}_part_date}`, align: 'center' }, { c: `{${code}_part_from}`, align: 'center' }, { c: `{${code}_part_to}`, align: 'center' }, { c: `{${code}_part_h} H`, align: 'center' }, { c: `{${code}_part_m} M`, align: 'center' }];
  out.push(table([4172, 1700, 1300, 1300, 1150, 1150], [
    [{ c: b('Type of leave taken as working days'), shade: H }, { c: b('Date'), shade: H, align: 'center' }, { c: b('Start time'), shade: H, align: 'center' }, { c: b('End time'), shade: H, align: 'center' }, { c: b('Number of hours / minutes'), shade: H, align: 'center', span: 2 }],
    rowB('Annual leave', 'annual'),
    rowB('Normal sick leave', 'sick'),
    rowB('Family responsibility leave (provide supporting evidence)', 'family'),
    rowB('Pre-natal leave (provide supporting evidence)', 'prenatal'),
    rowB('Paternity leave (provide supporting evidence)', 'paternity'),
    rowB('Special leave', 'special'),
    rowB('Leave for union office bearers (provide supporting evidence)', 'union_office'),
    rowB('Leave for union shop stewards (provide supporting evidence)', 'union_steward'),
  ]));

  out.push(para({ t: 'I hereby certify that I have acquainted myself of my available leave credits and with the rules governing the leave I have applied for. Further, I am certifying that the information provided is correct. Any falsification of information in this regard may form ground for disciplinary action. Furthermore, I fully understand that if I do not have sufficient leave credits from my previous or current leave cycle to cover for my application, my capped leave as at 30 June 2000 will be automatically utilised.', sz: 14 }, { before: 120 }));
  out.push(table([6772, 4000], [
    [{ c: [small('{employee_esign}'), '\n\n_________________________________'] }, { c: ['{application_date}', '\n\n__________________'] }],
    [{ c: b('EMPLOYEE SIGNATURE') }, { c: b('DATE') }],
  ]).replace(/<w:tblBorders>.*?<\/w:tblBorders>/, '<w:tblBorders/>'));

  out.push(para('', { after: 60 }));
  out.push(table([4272, 2200, 2200, 2100], [
    [{ c: [b('Recommendation by supervisor / manager (mark with X)'), '\n', small('Completion is not required if the supervisor / manager is also the delegated authority responsible to approve the application.')], shade: H }, { c: 'Recommended [{rec_recommended}]', align: 'center' }, { c: 'Not recommended [{rec_not_recommended}]', align: 'center' }, { c: 'Rescheduled [{rec_rescheduled}]', align: 'center' }],
    [{ c: [b('Remarks'), ' (if not recommended please state the reasons & the dates in the case of rescheduling): ', '{rec_remarks}'], span: 4 }],
    [{ c: [small('{rec_esign}'), '\n\n_________________________________\n', b("MANAGER'S / SUPERVISOR'S SIGNATURE"), '   {rec_name}'], span: 2 }, { c: ['{rec_date}\n\n__________________\n', b('DATE')], span: 2 }],
  ]));

  out.push(para('', { after: 60 }));
  out.push(table([4272, 2200, 2200, 2100], [
    [{ c: b('Approval by executive authority, head of department or designee (mark with X)'), shade: H }, { c: 'Approved with full pay [{app_full_pay}]', align: 'center' }, { c: 'Approved without pay [{app_without_pay}]', align: 'center' }, { c: 'Not approved [{app_not_approved}]', align: 'center' }],
    [{ c: [b('Remarks'), ' (if approved with a change in condition of payment or not approved, please provide motivation): ', '{app_remarks}'], span: 4 }],
    [{ c: [small('{app_esign}'), '\n\n_________________________________\n', b('SIGNATURE OF EXECUTIVE AUTHORITY, HOD OR DESIGNEE'), '   {app_name}'], span: 2 }, { c: ['{app_date}\n\n__________________\n', b('DATE')], span: 2 }],
  ]));

  out.push(para('', { after: 60 }));
  out.push(table([10772], [
    [{ c: b('DATA CAPTURING'), shade: H }],
    [{ c: 'CAPTURED BY: {captured_by}      CAPTURED ON: {captured_on}      Signature: ____________________' }],
    [{ c: 'CHECKED BY: {checked_by}      CHECKED ON: {checked_on}      Signature: ____________________' }],
  ]));
  out.push(para({ t: 'Ref: {ref_no}', sz: 12, i: true }, { align: 'right', before: 40 }));
  return docx(out.join(''));
}

// ------------------------------------------------------------------ transmittal slip

const text = (n) => { let s = ''; const ts = n.getElementsByTagNameNS(W, 't'); for (let i = 0; i < ts.length; i++) s += ts[i].textContent; return s; };
const kids = (n, name) => { const out = []; for (let c = n.firstChild; c; c = c.nextSibling) if (c.localName === name) out.push(c); return out; };

// Replace everything in a cell with a single paragraph holding `value`, keeping the cell's formatting.
function setCell(tc, value, size = null) {
  const doc = tc.ownerDocument;
  const ps = kids(tc, 'p');
  const p = ps[0];
  ps.slice(1).forEach((x) => tc.removeChild(x));
  const rPr = p.getElementsByTagNameNS(W, 'rPr')[0];
  for (const r of kids(p, 'r').concat(kids(p, 'hyperlink'), kids(p, 'proofErr'), kids(p, 'bookmarkStart'), kids(p, 'bookmarkEnd'))) p.removeChild(r);
  const r = doc.createElementNS(W, 'w:r');
  if (rPr) {
    const copy = rPr.cloneNode(true);
    copy.localName === 'rPr' && r.appendChild(copy);
  }
  if (size) sizeRun(r, size);
  const t = doc.createElementNS(W, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(value));
  r.appendChild(t);
  p.appendChild(r);
}

// Sets a run's font size (half-points, 16 = 8pt) and optionally italic.
function sizeRun(r, size, italic = false) {
  const doc = r.ownerDocument;
  let rPr = kids(r, 'rPr')[0];
  if (!rPr) { rPr = doc.createElementNS(W, 'w:rPr'); r.insertBefore(rPr, r.firstChild); }
  for (const n of [...kids(rPr, 'sz'), ...kids(rPr, 'szCs')]) rPr.removeChild(n);
  if (italic && !kids(rPr, 'i').length) rPr.appendChild(doc.createElementNS(W, 'w:i'));
  for (const tag of ['w:sz', 'w:szCs']) { const e = doc.createElementNS(W, tag); e.setAttribute('w:val', String(size)); rPr.appendChild(e); }
}

// A small (8pt) run with text, for values added to the form.
function smallRun(doc, value, italic = false) {
  const r = doc.createElementNS(W, 'w:r');
  sizeRun(r, 16, italic);
  const t = doc.createElementNS(W, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(value));
  r.appendChild(t);
  return r;
}

// Remove picture runs (logos). Text boxes, such as page numbers, are kept.
function stripImages(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const runs = doc.getElementsByTagNameNS(W, 'r');
  const doomed = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const s = new XMLSerializer().serializeToString(r);
    if (s.includes('a:blip') && !s.includes('txbx') && !s.includes('txbxContent')) doomed.push(r);
  }
  // Only remove outermost matches.
  doomed.forEach((r) => r.parentNode && r.parentNode.removeChild(r));
  return new XMLSerializer().serializeToString(doc);
}

function buildTransmittalFrom(file) {
  const zip = new PizZip(fs.readFileSync(file));
  // Logos: drop the picture runs and the image files.
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name) || name === 'word/document.xml') {
      zip.file(name, stripImages(zip.file(name).asText()));
    }
  }
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^word\/_rels\/((?:header|footer)\d*\.xml)\.rels$/);
    if (!m) continue;
    const part = zip.file(`word/${m[1]}`).asText();
    const rels = new DOMParser().parseFromString(zip.file(name).asText(), 'text/xml');
    for (const rel of Array.from(rels.getElementsByTagName('Relationship'))) {
      if (rel.getAttribute('Type').endsWith('/image') && !part.includes(`"${rel.getAttribute('Id')}"`)) rel.parentNode.removeChild(rel);
    }
    zip.file(name, new XMLSerializer().serializeToString(rels));
  }
  const stillUsed = Object.keys(zip.files).filter((n) => n.endsWith('.rels')).map((n) => zip.file(n).asText()).join('');
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('word/media/') && !stillUsed.includes(name.replace('word/', ''))) zip.remove(name);
  }

  const doc = new DOMParser().parseFromString(zip.file('word/document.xml').asText(), 'text/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  // "To:" paragraph above the table.
  for (const p of kids(body, 'p')) {
    if (/^\s*To:/.test(text(p))) {
      const rs = kids(p, 'r');
      rs.slice(1).forEach((r) => p.removeChild(r));
      const t = rs[0].getElementsByTagNameNS(W, 't')[0];
      t.textContent = 'To: {to}';
      t.setAttribute('xml:space', 'preserve');
      break;
    }
  }
  const tbl = kids(body, 'tbl').find((t) => text(t).includes('VACATION LEAVE'));
  if (!tbl) throw new Error('Could not find the transmittal table (looked for "VACATION LEAVE")');
  const rows = kids(tbl, 'tr');
  const label = (tr) => text(kids(tr, 'tc')[0]).trim().toUpperCase();
  const valueCell = (tr) => kids(tr, 'tc')[1];

  for (const tr of rows) {
    const l = label(tr);
    const cells = kids(tr, 'tc');
    if (l.startsWith('FROM:')) {
      setCell(cells[0], 'From: {from}');
      const nested = cells[1].getElementsByTagNameNS(W, 'tc')[0];
      if (nested) setCell(nested, '{slip_no}');
    } else if (l.startsWith('BRANCH') || l.startsWith('DEPARTMENT')) setCell(valueCell(tr), '{department}');
    else if (l.startsWith('COMPONENT')) setCell(valueCell(tr), '{component}');
    else if (l.startsWith('CONTACT')) setCell(valueCell(tr), '{contact_person}');
    else if (l.startsWith('TEL')) setCell(valueCell(tr), '{tel}');
  }

  // Data rows: the empty rows between the FROM/TO header row and "NO. OF FORMS SUBMITTED".
  const headerIdx = rows.findIndex((tr) => kids(tr, 'tc').some((tc) => text(tc).trim().toUpperCase() === 'FROM'));
  const footIdx = rows.findIndex((tr) => label(tr).startsWith('NO. OF FORMS SUBMITTED'));
  const dataRows = rows.slice(headerIdx + 1, footIdx);
  if (!dataRows.length) throw new Error('Could not find the empty name rows in the transmittal table');
  const first = dataRows[0];
  dataRows.slice(1).forEach((tr) => tbl.removeChild(tr));
  const dc = kids(first, 'tc');
  // Cells: [no] [name] [vac from] [vac to] [sick from] [sick to] [other from] [other to]
  const values = dc.length >= 8
    ? ['{#items}{no}', '{name_with_type}', '{vac_from}', '{vac_to}', '{sick_from}', '{sick_to}', '{other_from}', '{other_to}{/items}']
    : ['{#items}{name_with_type}', '{vac_from}', '{vac_to}', '{sick_from}', '{sick_to}', '{other_from}', '{other_to}{/items}'];
  dc.forEach((tc, i) => setCell(tc, values[i] ?? '', 16));

  // Footer: number of forms, and who submitted.
  const foot = rows.slice(footIdx);
  const sub = foot.slice(0, 3);
  setCell(kids(sub[0], 'tc')[1], '{forms_count}');
  setCell(kids(sub[0], 'tc').at(-1), '');
  setCell(kids(sub[1], 'tc').at(-1), '{submitted_by}');
  setCell(kids(sub[2], 'tc').at(-1), '{submitted_date}');
  // "Received" blocks are signed by hand at CRU / HRM: clear the example values.
  for (const tr of foot.slice(3)) {
    const cells = kids(tr, 'tc');
    if (/RECEIVED/.test(label(tr))) setCell(cells[1], '');
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function buildPlainTransmittal() {
  const b = (t) => ({ t, b: true });
  const H = 'D9D9D9';
  const out = [];
  out.push(para(b('TRANSMITTAL SLIP: Z1(a) APPLICATIONS FOR LEAVE'), { align: 'center', after: 120 }));
  out.push(para('To: {to}'));
  out.push(table([2000, 5772, 1500, 1500], [
    [{ c: b('From:') }, { c: '{from}' }, { c: b('Slip No.') }, { c: '{slip_no}' }],
    [{ c: b('Branch / Department') }, { c: '{department}' }, { c: b('Date') }, { c: '{date}' }],
    [{ c: b('Component') }, { c: '{component}', span: 3 }],
    [{ c: b('Contact person') }, { c: '{contact_person}' }, { c: b('Tel') }, { c: '{tel}' }],
  ]));
  out.push(para('', { after: 60 }));
  out.push(table([500, 3272, 1150, 1150, 1150, 1150, 1200, 1200], [
    [{ c: b('No'), shade: H }, { c: b('NAME'), shade: H }, { c: b('VACATION LEAVE'), shade: H, span: 2, align: 'center' }, { c: b('SICK LEAVE'), shade: H, span: 2, align: 'center' }, { c: b('OTHER LEAVE'), shade: H, span: 2, align: 'center' }],
    [{ c: '', shade: H }, { c: '', shade: H }, { c: b('FROM'), shade: H }, { c: b('TO'), shade: H }, { c: b('FROM'), shade: H }, { c: b('TO'), shade: H }, { c: b('FROM'), shade: H }, { c: b('TO'), shade: H }],
    [{ c: '{#items}{no}' }, { c: '{name_with_type}' }, { c: '{vac_from}' }, { c: '{vac_to}' }, { c: '{sick_from}' }, { c: '{sick_to}' }, { c: '{other_from}' }, { c: '{other_to}{/items}' }],
  ]));
  out.push(para('', { after: 60 }));
  out.push(table([3772, 1500, 2000, 3500], [
    [{ c: b('NO. OF FORMS SUBMITTED') }, { c: '{forms_count}' }, { c: b('SIGNATURE') }, { c: '' }],
    [{ c: '' }, { c: '' }, { c: b('SURNAME & INITIAL') }, { c: '{submitted_by}' }],
    [{ c: '' }, { c: '' }, { c: b('DATE') }, { c: '{submitted_date}' }],
    [{ c: b('NO. OF FORMS RECEIVED CRU (HR CONTACT CENTRE)') }, { c: '' }, { c: b('SIGNATURE') }, { c: '' }],
    [{ c: '' }, { c: '' }, { c: b('SURNAME & INITIAL') }, { c: '' }],
    [{ c: '' }, { c: '' }, { c: b('DATE') }, { c: '' }],
    [{ c: b('NO. OF FORMS RECEIVED (HRM)') }, { c: '' }, { c: b('SIGNATURE') }, { c: '' }],
    [{ c: '' }, { c: '' }, { c: b('SURNAME & INITIAL') }, { c: '' }],
    [{ c: '' }, { c: '' }, { c: b('DATE') }, { c: '' }],
  ]));
  return docx(out.join(''));
}

// ------------------------------------------------------------------ Z1(a) from your own file

// Sets a cell to `value` but keeps its label: "Address during the Leave Period" + value underneath.
function appendToCell(tc, value) {
  const doc = tc.ownerDocument;
  const last = kids(tc, 'p').at(-1);
  const p = last.cloneNode(true);
  for (const r of kids(p, 'r')) p.removeChild(r);
  p.appendChild(smallRun(doc, value));
  tc.appendChild(p);
}

// Adds a tag to the first text in `root` that contains `find`, e.g. "DATE" -> "DATE {rec_date}".
function tagText(root, find, replacement) {
  const ts = root.getElementsByTagNameNS(W, 't');
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].textContent.includes(find)) {
      ts[i].textContent = ts[i].textContent.replace(find, replacement);
      ts[i].setAttribute('xml:space', 'preserve');
      return true;
    }
  }
  return false;
}

// Turns the department's own Z1(a) (saved as .docx) into a template: same layout, tags in the cells.
// Rows are found by their labels, so small differences between versions of the form are tolerated.
function buildZ1From(file) {
  const zip = new PizZip(fs.readFileSync(file));
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name) || name === 'word/document.xml') zip.file(name, stripImages(zip.file(name).asText()));
  }
  const doc = new DOMParser().parseFromString(zip.file('word/document.xml').asText(), 'text/xml');
  const tbl = Array.from(doc.getElementsByTagNameNS(W, 'tbl')).find((t) => text(t).includes('SECTION A'));
  if (!tbl) throw new Error('Could not find the Z1 table (looked for "SECTION A")');
  const rows = kids(tbl, 'tr');
  const cells = (tr) => kids(tr, 'tc');
  const label = (tr) => text(cells(tr)[0]).trim().toLowerCase();
  const find = (start, test) => { for (let i = start; i < rows.length; i++) if (test(label(rows[i]), rows[i])) return i; return -1; };

  // Personal details
  const r0 = rows[find(0, (l) => l.startsWith('surname'))];
  setCell(cells(r0)[1], '{surname}');
  setCell(cells(r0)[3], '{initials}');
  const rp = rows[find(0, (l) => l.startsWith('persal'))];
  const pc = cells(rp);
  for (let i = 1; i <= 8; i++) setCell(pc[i], `{persal_${i}}`);
  const yesNo = (tr, yes, no) => {
    const c = cells(tr);
    const iy = c.findIndex((x) => text(x).trim() === 'Yes');
    const iN = c.findIndex((x) => text(x).trim() === 'No');
    setCell(c[iy + 1], yes);
    setCell(c[iN + 1], no);
  };
  yesNo(rp, '{shift_yes}', '{shift_no}');
  const ra = rows[find(0, (l) => l.startsWith('address during'))];
  yesNo(ra, '{casual_yes}', '{casual_no}');
  appendToCell(cells(ra)[0], '{leave_address}');
  const iDept = find(0, (l, tr) => cells(tr).some((c) => text(c).trim() === 'Department'));
  setCell(cells(rows[iDept + 1]).at(-1), '{department}');
  const iComp = find(0, (l, tr) => cells(tr).some((c) => text(c).trim() === 'Component'));
  setCell(cells(rows[iComp + 1]).at(-1), '{component}');

  // Section A (full days) and the calendar-days block
  const iA = find(0, (l) => l.startsWith('section a'));
  const iB = find(0, (l) => l.startsWith('section b'));
  const full = [
    ['annual leave', 'annual'], ['normal sick leave', 'sick'], ['leave for occupational', 'iod'], ['adoption leave', 'adoption'],
    ['family responsibility', 'family'], ['pre-natal', 'prenatal'], ['paternity', 'paternity'], ['special leave', 'special'],
    ['leave for union office', 'union_office'], ['leave for union shop', 'union_steward'], ['unpaid leave', 'unpaid'],
  ];
  for (const [start, code] of full) {
    const i = find(iA, (l) => l.startsWith(start));
    if (i < 0 || i > iB) continue;
    const c = cells(rows[i]);
    setCell(c[1], `{${code}_start}`); setCell(c[2], `{${code}_end}`); setCell(c[3], `{${code}_days}`);
  }
  const iSpec = find(iA, (l) => l.startsWith('specify type of special'));
  if (iSpec > 0 && iSpec < iB) setCell(cells(rows[iSpec])[1], '{special_type}');
  const iUnion = find(iA, (l) => l.startsWith('specify union'));
  if (iUnion > 0 && iUnion < iB) setCell(cells(rows[iUnion])[1], '{union_affiliation}');
  for (const [start, code, unit] of [['maternity', 'maternity', 'months'], ['surrogacy leave: commit', 'surrogacy_parent', 'months'], ['surrogacy leave: surrogate', 'surrogacy_mother', 'weeks']]) {
    const i = find(iA, (l) => l.startsWith(start));
    if (i < 0 || i > iB) continue;
    const c = cells(rows[i]);
    setCell(c[1], `{${code}_start}`); setCell(c[2], `{${code}_end}`); setCell(c.at(-1), `{${code}_${unit}}`);
  }

  // Section B (part of a day)
  const part = [['annual leave', 'annual'], ['normal sick leave', 'sick'], ['family responsibility', 'family'], ['pre-natal', 'prenatal'],
    ['paternity', 'paternity'], ['special leave', 'special'], ['leave for union office', 'union_office'], ['leave for union shop', 'union_steward']];
  for (const [start, code] of part) {
    const i = find(iB, (l) => l.startsWith(start));
    if (i < 0) continue;
    const c = cells(rows[i]);
    setCell(c[1], `{${code}_part_date}`); setCell(c[2], `{${code}_part_from}`); setCell(c[3], `{${code}_part_to}`);
    setCell(c[4], `{${code}_part_h} H`); setCell(c[5], `{${code}_part_m} M`);
  }

  // Values go into the form's existing empty lines, so the page count does not change.
  const lastBlankBefore = (tc, line) => { const ps = kids(tc, 'p'); const i = ps.indexOf(line); for (let j = i - 1; j >= 0; j--) if (!text(ps[j]).trim()) return ps[j]; return null; };
  const dateLabel = (tc, tag) => {
    const t = Array.from(tc.getElementsByTagNameNS(W, 't')).filter((x) => x.textContent.trim().toUpperCase() === 'DATE').at(-1);
    if (t) { t.textContent = t.textContent.replace('DATE', `DATE: ${tag}`); t.setAttribute('xml:space', 'preserve'); }
  };
  const signBlock = (tc, esign, date) => {
    const line = kids(tc, 'p').filter((p) => /_{5,}/.test(text(p))).at(-1);
    const spot = line && lastBlankBefore(tc, line);
    if (spot) spot.appendChild(smallRun(doc, esign, true));
    dateLabel(tc, date);
  };

  // Declaration
  const iDecl = find(iB, (l) => l.startsWith('i hereby certify'));
  signBlock(cells(rows[iDecl])[0], '{employee_esign}', '{application_date}');

  // Recommendation and approval: X in the right box, remarks, e-signature and date.
  const marks = (i, a, b, c) => { const cs = cells(rows[i]); setCell(cs[1], a); setCell(cs[3], b); setCell(cs[5], c); };
  marks(find(iB, (l) => l === 'recommended'), '{rec_recommended}', '{rec_not_recommended}', '{rec_rescheduled}');
  marks(find(iB, (l) => l.startsWith('approved with full pay')), '{app_full_pay}', '{app_without_pay}', '{app_not_approved}');
  const remarks = (i, who) => {
    const tc = cells(rows[i])[0];
    const ps = kids(tc, 'p');
    const labelAt = ps.findIndex((p) => /^REMARKS/i.test(text(p).trim()));
    const first = ps.slice(labelAt + 1).find((p) => !text(p).trim());
    if (first) first.appendChild(smallRun(doc, `{${who}_remarks}`));
    signBlock(tc, `{${who}_esign}`, `{${who}_date}`);
  };
  remarks(find(iB, (l) => l.startsWith('remarks (if not recommended')), 'rec');
  remarks(find(iB, (l) => l.startsWith('remarks (if approved')), 'app');

  // Data capturing: the name replaces the dotted line once known; until then the dots stay for handwriting.
  const cap = rows[find(iB, (l) => l.startsWith('captured by'))];
  const ts = Array.from(cap.getElementsByTagNameNS(W, 't'));
  for (const [labelText, tag] of [['CAPTURED BY', 'captured_by'], ['CAPTURED ON', 'captured_on'], ['CHECKED BY', 'checked_by'], ['CHECKED ON', 'checked_on']]) {
    const i = ts.findIndex((t) => t.textContent.trim() === labelText);
    const next = ts[i + 1];
    const m = next && /^(:?)([.\u2026]+)(\s*)$/.exec(next.textContent);
    if (!m) continue;
    next.textContent = `${m[1]}{#${tag}} {${tag}} {/${tag}}{^${tag}}${m[2]}{/${tag}}${m[3]}`;
    next.setAttribute('xml:space', 'preserve');
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Makes a transmittal's header/footer generic: the organisation name becomes a tag, website removed.
function genericHeaders(zip) {
  for (const name of Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) {
    let x = zip.file(name).asText();
    x = x.replace(/Department of [A-Z][a-z]+(?: [A-Z][a-z]+)*/, '{org_name}').replace(/www\.[a-z.]+\.gov\.za/g, '');
    zip.file(name, x);
  }
}

// Usage: node tools/build-templates.mjs [--z1 your-z1.docx] [--transmittal your-transmittal.docx]
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
fs.mkdirSync(outDir, { recursive: true });
const z1 = arg('--z1');
fs.writeFileSync(path.join(outDir, 'z1a-leave-form.docx'), z1 ? buildZ1From(z1) : buildZ1());
const tx = arg('--transmittal');
if (tx) {
  const zip = new PizZip(buildTransmittalFrom(tx));
  genericHeaders(zip);
  fs.writeFileSync(path.join(outDir, 'transmittal-slip.docx'), zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
} else fs.writeFileSync(path.join(outDir, 'transmittal-slip.docx'), buildPlainTransmittal());
console.log(`Wrote templates/z1a-leave-form.docx (${z1 ? 'from your Z1' : 'built-in layout'}) and templates/transmittal-slip.docx (${tx ? 'from your transmittal' : 'built-in layout'})`);
