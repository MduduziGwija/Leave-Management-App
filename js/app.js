// App shell: picks the backend, handles sign-in, builds the menu for the user's role, and routes pages.
import { CONFIG } from './config.js';
import { demoApi } from './api/demo.js';
import { supabaseApi } from './api/supabase.js';
import { isHR, ROLE_LABELS, PENDING, canDecide } from './logic.js';
import { esc, $, toast, busy } from './ui.js';
import * as dashboard from './pages/dashboard.js';
import * as leave from './pages/leave.js';
import * as approvals from './pages/approvals.js';
import * as hr from './pages/hr.js';
import * as templates from './pages/templates.js';
import * as settings from './pages/settings.js';

const useSupabase = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
const api = useSupabase ? supabaseApi : demoApi;

// Shared state handed to every page.
export const ctx = { api, me: null, settings: null, types: [], profiles: [], byId: {}, holidays: [], requests: [] };

export async function refresh() {
  const [s, types, profiles, holidays, requests] = await Promise.all([
    api.settings(), api.leaveTypes(), api.profiles(), api.holidays(), api.requests(),
  ]);
  Object.assign(ctx, { settings: s, types, profiles, holidays, requests, byId: Object.fromEntries(profiles.map((p) => [p.id, p])) });
  ctx.me = ctx.byId[ctx.me.id] || ctx.me;
}

const ROUTES = {
  dashboard: { title: 'Dashboard', page: dashboard.render, show: () => true },
  calendar: { title: 'Team calendar', page: dashboard.renderCalendar, show: () => true },
  apply: { title: 'Apply for leave', page: leave.renderApply, show: () => true },
  mine: { title: 'My leave', page: leave.renderMine, show: () => true },
  approvals: { title: 'Approvals', page: approvals.render, show: (m) => isHR(m) || m.role === 'approver' || ctx.profiles.some((p) => p.supervisor_id === m.id || p.manager_id === m.id) },
  employees: { title: 'Employees', page: hr.renderEmployees, show: isHR },
  register: { title: 'Leave register', page: hr.renderRegister, show: isHR },
  transmittals: { title: 'Transmittal slips', page: hr.renderTransmittals, show: (m) => isHR(m) && ctx.settings.mode === 'government' },
  templates: { title: 'Form templates', page: templates.render, show: isHR },
  settings: { title: 'Settings', page: settings.render, show: isHR },
};

export function go(route) { location.hash = `#/${route}`; }

// Re-fetches data and re-renders the current page (after a change).
export const reload = () => route();

async function route() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  if (name === 'set-password') return renderSetPassword();
  if (!ctx.me) return renderLogin();
  const r = ROUTES[name] && ROUTES[name].show(ctx.me) ? ROUTES[name] : ROUTES.dashboard;
  const key = ROUTES[name] && ROUTES[name].show(ctx.me) ? name : 'dashboard';
  renderShell(key);
  const main = $('#main');
  main.innerHTML = '<p class="loading">Loading…</p>';
  try {
    await refresh();
    renderShell(key); // badges may have changed
    document.title = `${r.title} · Leave`;
    await r.page($('#main'), ctx);
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  }
}

function renderShell(active) {
  const m = ctx.me;
  const pending = ctx.requests.filter((r) => PENDING.includes(r.status) && canDecide(r, m)).length;
  const nav = Object.entries(ROUTES).filter(([, r]) => r.show(m)).map(([k, r]) =>
    `<a href="#/${k}" class="${k === active ? 'active' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(r.title)}${k === 'approvals' && pending ? ` <span class="count">${pending}</span>` : ''}</a>`).join('');
  const mode = ctx.settings?.mode === 'enterprise' ? 'Enterprise' : 'Government';
  document.body.innerHTML = `
    <header class="topbar">
      <button class="icon-btn menu-btn" aria-label="Menu" aria-expanded="false">☰</button>
      <div class="brand">${esc(ctx.settings?.org_name || 'Leave')}<span class="mode-pill">${mode} mode</span></div>
      <div class="who">
        <span>${esc(m.full_name)} · ${esc(ROLE_LABELS[m.role] || m.role)}</span>
        ${api.kind === 'demo' ? '<button class="btn small" id="switch">Switch user</button>' : ''}
        <button class="btn small" id="signout">Sign out</button>
      </div>
    </header>
    <div class="layout">
      <nav class="sidebar">${nav}</nav>
      <main id="main" tabindex="-1"></main>
    </div>
    ${api.kind === 'demo' ? '<div class="demo-banner">Demo mode: data is only saved in this browser. Connect Supabase for real use (see README).</div>' : ''}`;
  const menuBtn = $('.menu-btn');
  menuBtn.onclick = () => { const open = document.body.classList.toggle('nav-open'); menuBtn.setAttribute('aria-expanded', open); };
  $('.sidebar').onclick = (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); };
  $('#signout').onclick = async () => { await api.signOut(); ctx.me = null; go('dashboard'); route(); };
  const sw = $('#switch');
  if (sw) sw.onclick = async () => { await api.signOut(); ctx.me = null; route(); };
}

async function renderLogin() {
  document.title = 'Sign in · Leave';
  if (api.kind === 'demo') {
    const users = await api.demoUsers();
    const group = (role) => users.filter((u) => u.role === role);
    const block = (role, blurb) => group(role).length ? `<h3>${esc(ROLE_LABELS[role])}</h3><p class="muted">${esc(blurb)}</p>
      <div class="user-grid">${group(role).map((u) => `<button class="user-card" data-id="${esc(u.id)}"><strong>${esc(u.full_name)}</strong><span>${esc(u.job_title)}</span></button>`).join('')}</div>` : '';
    document.body.innerHTML = `<main class="login wide">
      <h1>Leave management: demo</h1>
      <p>Pick someone to sign in as. Each person sees what their role allows. Data is stored only in this browser.</p>
      ${block('admin', 'Everything, including settings and the government / enterprise switch.')}
      ${block('hr', 'Employee records, balances, all leave, forms, transmittal slips.')}
      ${block('approver', 'Recommend or approve leave for their team.')}
      ${block('staff', 'Own leave, balances and history; who is out when.')}
      <p><button class="btn" id="reset">Reset demo data</button></p>
    </main>`;
    document.body.onclick = async (e) => {
      const b = e.target.closest('.user-card');
      if (b) { document.body.onclick = null; await api.demoLogin(b.dataset.id); await start(); }
      if (e.target.id === 'reset') { await api.demoReset(); toast('Demo data reset'); renderLogin(); }
    };
    return;
  }
  document.body.onclick = null;
  document.body.innerHTML = `<main class="login">
    <h1>Sign in</h1>
    <form id="signin" class="stack">
      <label>Email <input name="email" type="email" autocomplete="email" required></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary">Sign in</button>
    </form>
    <p><a href="#" id="forgot">Forgot password?</a></p>
    <details><summary>New here? Create an account</summary>
      <form id="signup" class="stack">
        <label>Full name <input name="full_name" required autocomplete="name"></label>
        <label>Work email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password (at least 8 characters) <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn">Create account</button>
        <p class="muted">HR will then add your department, supervisor and leave details.</p>
      </form>
    </details>
  </main>`;
  $('#signin').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); busy(e.submitter, async () => { await api.signIn(f.get('email'), f.get('password')); await start(); }); };
  $('#signup').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    busy(e.submitter, async () => {
      const r = await api.signUp(f.get('email'), f.get('password'), f.get('full_name'));
      if (r.needsConfirmation) toast('Check your email to confirm your account, then sign in.'); else await start();
    });
  };
  $('#forgot').onclick = (e) => {
    e.preventDefault();
    const email = $('#signin [name=email]').value;
    if (!email) return toast('Type your email address first', 'bad');
    busy(null, async () => { await api.resetPassword(email); toast('If that address has an account, a reset link is on its way.'); });
  };
}

function renderSetPassword() {
  document.body.innerHTML = `<main class="login"><h1>Choose a new password</h1>
    <form id="pw" class="stack"><label>New password <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
    <button class="btn primary">Save password</button></form></main>`;
  $('#pw').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api.updatePassword(new FormData(e.target).get('password')); toast('Password saved'); go('dashboard'); await start(); }); };
}

async function start() {
  try {
    ctx.me = await api.session();
  } catch (e) {
    toast(e.message, 'bad');
    await api.signOut();
    ctx.me = null;
  }
  await route();
}

async function boot() {
  try {
    await api.init({ url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_ANON_KEY });
  } catch (e) {
    document.body.innerHTML = `<main class="login"><h1>Cannot start</h1><p>${esc(e.message)}</p></main>`;
    return;
  }
  window.addEventListener('hashchange', route);
  await start();
}

boot();
