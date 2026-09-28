// Small DOM helpers shared by the pages.
import { STATUS_LABELS, fmtDate } from './logic.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function statusBadge(status) {
  const tone = status.startsWith('pending') ? 'warn'
    : ['approved', 'transmitted', 'captured'].includes(status) ? 'ok'
      : status === 'rejected' ? 'bad' : 'muted';
  return `<span class="badge ${tone}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

export const dateRange = (r) => (r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`)
  + (r.part_day && r.start_time ? ` (${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)})` : '');

export const days = (n) => `${Number(n).toLocaleString('en-ZA', { maximumFractionDigits: 2 })} ${Number(n) === 1 ? 'day' : 'days'}`;

export function toast(message, kind = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

// Opens a dialog. `body` is an HTML string. Buttons: [{ label, kind, value }].
// Resolves with { value, form } where form is the dialog's FormData, or null when dismissed.
export function dialog({ title, body, buttons = [{ label: 'Close', value: null }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = wide ? 'wide' : '';
    d.innerHTML = `<form method="dialog" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="dialog-body">${body}</div>
      <footer>${buttons.map((b, i) => `<button type="submit" class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</footer>
    </form>`;
    document.body.append(d);
    const form = d.querySelector('form');
    let done = false;
    const finish = (v) => { if (done) return; done = true; d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-close]').onclick = () => finish(null);
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const b = buttons[Number(e.submitter?.dataset.i ?? 0)];
      if (b.value !== null && b.value !== undefined && b.validate !== false && !form.reportValidity()) return;
      finish(b.value === null || b.value === undefined ? null : { value: b.value, form: new FormData(form), el: form });
    });
    d.showModal();
    onOpen?.(d);
  });
}

export async function confirmBox(message, okLabel = 'Yes', kind = 'primary') {
  const r = await dialog({ title: 'Please confirm', body: `<p>${esc(message)}</p>`, buttons: [{ label: 'Cancel', value: null }, { label: okLabel, kind, value: true }] });
  return !!r;
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function csv(rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export const options = (items, selected) => items.map(([v, label]) =>
  `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`).join('');

export const empty = (msg) => `<p class="empty">${esc(msg)}</p>`;

// Adds a show / hide (eye) button to every password field inside `root`.
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" d="M3 3l18 18"/></svg>';
export function passwordToggles(root = document) {
  $$('input[type=password]', root).forEach((input) => {
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.replaceWith(wrap);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = EYE;
    btn.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(show));
      input.focus();
    };
    wrap.append(input, btn);
  });
}

// Wraps an async action: disables the button while it runs and shows errors as a toast.
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), 'bad'); return undefined; } finally { if (btn) btn.disabled = false; }
}
