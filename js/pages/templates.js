// Form templates: upload a department's own Word forms and see which {tags} the app fills in.
import { fmtDate, today, addDays } from '../logic.js';
import { esc, $$, toast, busy, download, confirmBox } from '../ui.js';
import { STARTERS, TAGS, findTags, checkTemplate, fill, activeTemplate, leaveFormData, transmittalData } from '../forms.js';
import { reload } from '../app.js';

const KINDS = {
  leave_form: { title: 'Leave application form (e.g. Z1(a))', blurb: 'Filled in for one leave application.' },
  transmittal: { title: 'Transmittal slip', blurb: 'One slip listing several leave applications sent to HR together.' },
};

// Sample data used for "Try it" and to know which tags exist.
function samples(ctx) {
  const employee = { ...ctx.me, surname: ctx.me.surname || 'Sample', initials: ctx.me.initials || 'S' };
  const req = {
    id: 'sample', ref_no: 123, employee_id: ctx.me.id, leave_type: 'annual', start_date: addDays(today(), 7), end_date: addDays(today(), 11),
    part_day: false, days: 5, reason: 'Sample reason', leave_address: '1 Sample Street', special_type: '', union_affiliation: '',
    created_at: new Date().toISOString(), supervisor_decision: 'recommended', supervisor_by: ctx.me.id, supervisor_at: new Date().toISOString(),
    manager_decision: 'approved_full_pay', manager_by: ctx.me.id, manager_at: new Date().toISOString(), status: 'approved', mode: ctx.settings.mode,
  };
  const leave = leaveFormData(req, { employee, priv: { persal_number: '12345678', id_number: '8001015009087' }, types: ctx.types, byId: ctx.byId, settings: ctx.settings });
  const batch = { slip_no: 1, created_at: new Date().toISOString(), created_by: ctx.me.id, sent_to: ctx.settings.transmittal_to };
  const reqs = [req, { ...req, id: 's2', ref_no: 124, leave_type: 'sick', start_date: today(), end_date: today(), days: 1 }, { ...req, id: 's3', ref_no: 125, leave_type: 'family', days: 1 }];
  const transmittal = transmittalData(batch, reqs, { types: ctx.types, byId: ctx.byId, settings: ctx.settings, me: ctx.me });
  return { leave_form: leave, transmittal };
}

const knownTags = (data) => new Set([...Object.keys(data), ...(data.items?.[0] ? Object.keys(data.items[0]) : [])]);

export async function render(main, ctx) {
  const list = await ctx.api.templates();
  const sample = samples(ctx);
  main.innerHTML = `
    <div class="page-head"><h1>Form templates</h1></div>
    <section class="card">
      <h2>How to use your own form</h2>
      <ol class="steps-list">
        <li>Open your department's form in Microsoft Word (or start from a built-in template below).</li>
        <li>Delete any logos you don't want, and keep the layout as it is.</li>
        <li>Where a value should go, type a tag in curly brackets, for example <code>{surname}</code> or <code>{annual_start}</code>. The tag lists are below each template.</li>
        <li>For the transmittal slip, put <code>{#items}</code> at the start of the first cell and <code>{/items}</code> at the end of the last cell of <em>one</em> table row. That row is repeated for each application.</li>
        <li>Save as <strong>Word Document (.docx)</strong>. Old <code>.doc</code> files must be re-saved as .docx first. Then upload it here and press <em>Try it</em>.</li>
      </ol>
    </section>
    ${Object.entries(KINDS).map(([kind, k]) => {
    const mine = list.filter((t) => t.kind === kind);
    const active = mine.find((t) => t.active);
    return `<section class="card" data-kind="${kind}">
        <h2>${esc(k.title)}</h2><p class="muted">${esc(k.blurb)}</p>
        <p>In use: <strong>${esc(active ? active.name : STARTERS[kind].name)}</strong></p>
        <div class="actions">
          <label class="btn primary file-btn">Upload .docx<input type="file" accept=".docx,.doc" data-upload hidden></label>
          <button class="btn" data-try>Try it with sample data</button>
          <a class="btn" href="${STARTERS[kind].url}" download="${STARTERS[kind].file}">Download built-in template</a>
        </div>
        <div class="check-result" aria-live="polite"></div>
        ${mine.length ? `<div class="table-wrap"><table class="list compact"><thead><tr><th>Uploaded template</th><th>Date</th><th></th></tr></thead><tbody>
          ${mine.map((t) => `<tr data-t="${esc(t.id)}"><td>${esc(t.name)} ${t.active ? '<span class="badge ok">In use</span>' : ''}</td><td>${esc(fmtDate(t.created_at))}</td>
            <td class="row-actions">${t.active ? '<button class="btn small" data-off>Use built-in instead</button>' : '<button class="btn small" data-on>Use this</button>'}
            <button class="btn small" data-dl>Download</button><button class="btn small danger" data-del>Delete</button></td></tr>`).join('')}
        </tbody></table></div>` : ''}
        <details><summary>Tags you can use</summary>
          <table class="list compact tags"><tbody>${TAGS[kind].map(([tag, what]) => `<tr><td><code>${esc(tag)}</code></td><td>${esc(what)}</td></tr>`).join('')}</tbody></table>
          ${kind === 'leave_form' ? `<p class="muted">Leave type codes: ${ctx.types.map((t) => `<code>${esc(t.code)}</code>`).join(' ')}</p>` : ''}
        </details>
      </section>`;
  }).join('')}`;

  $$('section[data-kind]', main).forEach((sec) => {
    const kind = sec.dataset.kind;
    const out = sec.querySelector('.check-result');
    sec.querySelector('[data-upload]').onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      busy(null, async () => {
        if (!/\.docx$/i.test(file.name)) throw new Error('Please save the form as a Word Document (.docx) first: in Word choose File → Save As → Word Document (*.docx).');
        const buf = await file.arrayBuffer();
        checkTemplate(buf);
        const tags = findTags(buf);
        if (!tags.length) throw new Error('No {tags} were found in this file. Type tags such as {surname} where the values should go, then upload again.');
        const known = knownTags(sample[kind]);
        const unknown = tags.filter((t) => !known.has(t.replace(/^[#/^]/, '')));
        if (kind === 'transmittal' && !tags.includes('#items')) throw new Error('This transmittal has no {#items} … {/items} row, so it can only list one person. See the steps above.');
        if (unknown.length && !await confirmBox(`These tags are not known and will be left blank: ${unknown.join(', ')}. Upload anyway?`, 'Upload anyway')) return;
        await ctx.api.uploadTemplate(kind, file.name, file);
        toast(`Uploaded. ${tags.length} tag(s) found.`);
        reload();
      });
    };
    sec.querySelector('[data-try]').onclick = (e) => busy(e.target, async () => {
      const tpl = await activeTemplate(ctx.api, kind);
      download(fill(tpl.buffer, sample[kind]), `SAMPLE-${kind}.docx`);
      out.innerHTML = `<p class="muted">Downloaded a sample filled from “${esc(tpl.name)}”. Open it in Word to check everything lands in the right place.</p>`;
    });
    sec.querySelectorAll('tr[data-t]').forEach((tr) => {
      const t = list.find((x) => x.id === tr.dataset.t);
      const on = tr.querySelector('[data-on]'); const off = tr.querySelector('[data-off]');
      if (on) on.onclick = () => busy(on, async () => { await ctx.api.setTemplateActive(t.id, true); reload(); });
      if (off) off.onclick = () => busy(off, async () => { await ctx.api.setTemplateActive(t.id, false); reload(); });
      tr.querySelector('[data-dl]').onclick = (e) => busy(e.target, async () => download(new Blob([await ctx.api.templateBytes(t)]), t.name));
      tr.querySelector('[data-del]').onclick = (e) => busy(e.target, async () => {
        if (!await confirmBox(`Delete “${t.name}”?`, 'Delete', 'danger')) return;
        await ctx.api.deleteTemplate(t.id); reload();
      });
    });
  });
}
