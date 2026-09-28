// Supabase backend: real logins and a shared database. Permissions are enforced by
// supabase/schema.sql (row level security + workflow functions), not by this file.
let sb = null;

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const safeName = (n) => n.replace(/[^\w.\-]+/g, '_').slice(-80);
const appUrl = () => location.origin + location.pathname;

export const supabaseApi = {
  kind: 'supabase',
  async init({ url, key }) {
    if (!window.supabase) throw new Error('Supabase library failed to load');
    sb = window.supabase.createClient(url, key);
    sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') location.hash = '#/set-password'; });
  },
  async session() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const p = ok(await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!p) throw new Error('Your account has no employee profile. Check that supabase/schema.sql was run before you signed up.');
    if (!p.active) throw new Error('Your account is inactive. Please contact HR.');
    return p;
  },
  async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
  async signUp(email, password, full_name) {
    const d = ok(await sb.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: appUrl() } }));
    return { needsConfirmation: !d.session };
  },
  async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })); },
  async updatePassword(password) { ok(await sb.auth.updateUser({ password })); },
  async signOut() { await sb.auth.signOut(); },

  async settings() { return ok(await sb.from('settings').select('*').eq('id', 1).single()); },
  async saveSettings(patch) { ok(await sb.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)); },

  async profiles() { return ok(await sb.from('profiles').select('*').order('full_name')); },
  async saveProfile(id, patch) { ok(await sb.from('profiles').update(patch).eq('id', id)); },
  async privateOf(id) { return ok(await sb.from('employee_private').select('*').eq('id', id).maybeSingle()) || {}; },
  async savePrivate(id, patch) { ok(await sb.from('employee_private').update(patch).eq('id', id)); },

  async leaveTypes() { return ok(await sb.from('leave_types').select('*').order('sort')); },
  async saveLeaveType(t) { ok(await sb.from('leave_types').upsert(t)); },

  async holidays() { return ok(await sb.from('public_holidays').select('*').order('date')); },
  async addHoliday(date, name) { ok(await sb.from('public_holidays').upsert({ date, name })); },
  async removeHoliday(date) { ok(await sb.from('public_holidays').delete().eq('date', date)); },

  async balanceOverrides(employeeId) {
    let q = sb.from('leave_balances').select('*');
    if (employeeId) q = q.eq('employee_id', employeeId);
    return ok(await q);
  },
  async saveBalanceOverride(row) { ok(await sb.from('leave_balances').upsert(row)); },

  async requests() {
    // Paged, so HR sees everything even past Supabase's 1000-row limit.
    const all = [];
    for (let from = 0; ; from += 1000) {
      const page = ok(await sb.from('leave_requests').select('*').order('created_at', { ascending: false }).range(from, from + 999));
      all.push(...page);
      if (page.length < 1000) return all;
    }
  },
  async events(requestId) { return ok(await sb.from('leave_events').select('*').eq('request_id', requestId).order('at')); },

  async applyLeave(a) {
    return ok(await sb.rpc('apply_leave', {
      p_type: a.leave_type, p_start: a.start_date, p_end: a.end_date, p_part_day: !!a.part_day,
      p_start_time: a.part_day ? a.start_time : null, p_end_time: a.part_day ? a.end_time : null,
      p_reason: a.reason || '', p_leave_address: a.leave_address || '', p_special_type: a.special_type || '',
      p_union_affiliation: a.union_affiliation || '', p_attachment_path: a.attachment_path || null, p_attachment_name: a.attachment_name || null,
    }));
  },
  async decide(id, decision, comment = '') { return ok(await sb.rpc('decide_leave', { p_id: id, p_decision: decision, p_comment: comment })); },
  async cancel(id, comment = '') { ok(await sb.rpc('cancel_leave', { p_id: id, p_comment: comment })); },
  async whoIsOut(from, to) { return ok(await sb.rpc('who_is_out', { p_from: from, p_to: to })); },

  async createTransmittal(ids, sentTo = '', note = '') { return ok(await sb.rpc('create_transmittal', { p_ids: ids, p_sent_to: sentTo, p_note: note })); },
  async markCaptured(ids, checked = false) { ok(await sb.rpc('mark_captured', { p_ids: ids, p_checked: checked })); },
  async batches() { return ok(await sb.from('transmittal_batches').select('*').order('created_at', { ascending: false })); },

  async templates() { return ok(await sb.from('templates').select('*').order('created_at', { ascending: false })); },
  async uploadTemplate(kind, name, file) {
    const path = `${kind}/${Date.now()}-${safeName(file.name)}`;
    ok(await sb.storage.from('templates').upload(path, file, { contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    ok(await sb.from('templates').update({ active: false }).eq('kind', kind));
    const { data: { session } } = await sb.auth.getSession();
    return ok(await sb.from('templates').insert({ kind, name, storage_path: path, active: true, uploaded_by: session.user.id }).select('id').single()).id;
  },
  async templateBytes(t) { return (ok(await sb.storage.from('templates').download(t.storage_path))).arrayBuffer(); },
  async deleteTemplate(id) {
    const t = ok(await sb.from('templates').select('*').eq('id', id).single());
    ok(await sb.storage.from('templates').remove([t.storage_path]));
    ok(await sb.from('templates').delete().eq('id', id));
  },
  async setTemplateActive(id, active) {
    const t = ok(await sb.from('templates').select('kind').eq('id', id).single());
    ok(await sb.from('templates').update({ active: false }).eq('kind', t.kind));
    ok(await sb.from('templates').update({ active }).eq('id', id));
  },

  async uploadAttachment(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Attachments must be smaller than 10 MB');
    const { data: { session } } = await sb.auth.getSession();
    const path = `${session.user.id}/${Date.now()}-${safeName(file.name)}`;
    ok(await sb.storage.from('attachments').upload(path, file));
    return { path, name: file.name };
  },
  async attachmentUrl(path) { return ok(await sb.storage.from('attachments').createSignedUrl(path, 300)).signedUrl; },

  // Branding pictures (admin only). The "branding" bucket is public so pictures load quickly.
  async uploadBranding(blob) {
    const path = `${Date.now()}.jpg`;
    ok(await sb.storage.from('branding').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }));
    return sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
  },
};
