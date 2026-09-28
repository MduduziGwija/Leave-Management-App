// Approvals: requests waiting for this person's recommendation or decision.
import { PENDING, canDecide, decisionsFor, DECISIONS, fmtDateTime, isHR } from '../logic.js';
import { esc, statusBadge, dateRange, days, empty, toast, busy, options } from '../ui.js';
import { showRequest, requestTable, bindRequestTable } from './leave.js';
import { reload } from '../app.js';

export async function render(main, ctx) {
  const { me, settings } = ctx;
  const waiting = ctx.requests.filter((r) => PENDING.includes(r.status) && canDecide(r, me))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  // For HR, separate their "own" queue (pending_hr or where they are the approver) from the override list.
  const mineFirst = waiting.filter((r) => r.status === 'pending_hr' || r.supervisor_id === me.id || r.manager_id === me.id);
  const others = waiting.filter((r) => !mineFirst.includes(r));
  const decided = ctx.requests.filter((r) => (r.supervisor_by === me.id || r.manager_by === me.id)).slice(0, 20);
  const tname = (c) => ctx.types.find((t) => t.code === c)?.name || c;

  const card = (r) => {
    const e = ctx.byId[r.employee_id] || {};
    const step = r.status === 'pending_supervisor' ? 'Recommendation' : 'Final approval';
    const hrOverride = isHR(me) && !(r.status === 'pending_hr' || r.supervisor_id === me.id || r.manager_id === me.id);
    return `<article class="card approval" data-id="${esc(r.id)}">
      <header><div><h3>${esc(e.full_name)}</h3><small>${esc(e.job_title || '')}${e.department ? ` · ${esc(e.department)}` : ''}</small></div>${statusBadge(r.status)}</header>
      <p><strong>${esc(tname(r.leave_type))}</strong>${r.special_type ? ` (${esc(r.special_type)})` : ''} · ${dateRange(r)} · ${days(r.days)}</p>
      ${r.reason ? `<p class="muted">“${esc(r.reason)}”</p>` : ''}
      ${r.supervisor_decision ? `<p class="muted">Supervisor: ${esc(DECISIONS[r.supervisor_decision]?.label)} by ${esc(ctx.byId[r.supervisor_by]?.full_name || '')}${r.supervisor_comment ? ` — “${esc(r.supervisor_comment)}”` : ''}</p>` : ''}
      <p class="muted">Applied ${esc(fmtDateTime(r.created_at))}${r.attachment_path ? ' · has supporting evidence' : ''}${hrOverride ? ' · <strong>you are acting as HR</strong>' : ''}</p>
      <form class="decide">
        <label>${step} <select name="decision">${options(decisionsFor(r, settings.mode).map((d) => [d, DECISIONS[d].label]))}</select></label>
        <label class="grow">Remarks <input name="comment" placeholder="Required if not recommended / rescheduled / not approved"></label>
        <button class="btn primary">Save</button>
        <button type="button" class="btn" data-open>Details</button>
      </form>
    </article>`;
  };

  main.innerHTML = `
    <div class="page-head"><h1>Approvals</h1></div>
    ${settings.mode === 'government' ? '<p class="muted">Government mode: the supervisor recommends, then the manager / HOD (delegated authority) approves. A "not recommended" still goes to the manager / HOD; "rescheduled" returns it to the employee.</p>' : ''}
    <section><h2>Waiting for you (${mineFirst.length})</h2>${mineFirst.length ? mineFirst.map(card).join('') : empty('Nothing is waiting for your decision.')}</section>
    ${others.length ? `<section><h2>Other pending requests (HR can act on any)</h2>${others.map(card).join('')}</section>` : ''}
    <section class="card"><h2>Recently decided by you</h2>${decided.length ? requestTable(ctx, decided) : empty('No decisions yet.')}</section>`;

  main.querySelectorAll('article.approval').forEach((a) => {
    const r = ctx.requests.find((x) => x.id === a.dataset.id);
    a.querySelector('[data-open]').onclick = () => showRequest(ctx, r, reload);
    a.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const decision = f.get('decision');
      const comment = String(f.get('comment') || '').trim();
      if ((!DECISIONS[decision].ok || decision === 'not_recommended') && !comment) { toast('Please give a reason in the remarks', 'bad'); return; }
      busy(e.submitter, async () => {
        await ctx.api.decide(r.id, decision, comment);
        toast(`${ctx.byId[r.employee_id]?.full_name}: ${DECISIONS[decision].label}`);
        reload();
      });
    };
  });
  bindRequestTable(main, ctx, reload);
}
