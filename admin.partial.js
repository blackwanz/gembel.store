/* ============================================================
   INCOMPLETE — this is NOT a working file, just what survived
   from your admin.html upload (69 lines total). It's the TAIL
   END of a <script> block only. Everything below is missing
   and was never uploaded:

     - <!DOCTYPE>, <head>, <title>, CSS <link>/<style>
     - The entire <body> markup (topbar, stat cards, the users
       table itself, the app_requests table, the payment_requests
       table — renderRequests()/renderUsers()/renderPayments()
       all target DOM ids that are never shown, e.g. whatever
       table body renderUsers() maps into)
     - Variable declarations for CURRENT_USER, CURRENT_PROFILE,
       ALL_PROFILES, ALL_REQUESTS, ALL_PAYMENTS (used below,
       declared somewhere above the part that got cut off)
     - The full body of renderUsers() (only its closing `</tr>`
       template-literal tail is here) and all of renderRequests()
       and renderPayments() (called on line ~44 but never defined
       in what was uploaded)
     - <script src="..."> tags — likely assets/supabaseClient.js,
       assets/auth.js, and maybe assets/app-theme.css in <head>,
       inferred from dashboard.html/index.html using the same stack

   Send the complete admin.html and it'll get split into
   apps/admin/... (or admin.html/.css/.js at root, matching
   dashboard.html) exactly like the other pages.

   Below is the raw fragment, byte-for-byte, for your reference
   when you reconstruct/re-send the file.
   ============================================================ */

      <td><span class="role-badge ${p.role}">${p.role === 'admin' ? 'ADMIN' : 'USER'}</span> ${isElite(p) ? '<span class="plan-badge elite">ELITE</span>' : '<span class="plan-badge free">FREE</span>'}</td>
      <td style="color:var(--text-faint);font-size:12px;">${new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td>
        ${p.id === CURRENT_USER.id
          ? '<span style="color:var(--text-faint);font-size:12px;">akun lo</span>'
          : `<button class="btn btn-ghost btn-sm" onclick="toggleRole('${p.id}', '${p.role}')">${p.role === 'admin' ? 'Cabut admin' : 'Jadikan admin'}</button>`}
      </td>
    </tr>
  `).join('');
}

async function toggleRole(id, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  if (!confirm(`Ubah role user ini jadi "${newRole}"?`)) return;
  const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
  if (error) { alert('Gagal update: ' + error.message); return; }
  ALL_PROFILES[id].role = newRole;
  renderUsers();
}

function updateOverviewStats() {
  document.getElementById('stat-pending').textContent = ALL_REQUESTS.filter(r => r.status !== 'selesai').length;
  document.getElementById('stat-done').textContent = ALL_REQUESTS.filter(r => r.status === 'selesai').length;
  document.getElementById('stat-users').textContent = Object.keys(ALL_PROFILES).length;
}

async function loadAll() {
  const [{ data: profiles, error: pErr }, { data: requests, error: rErr }, { data: payments, error: payErr }] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('app_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('payment_requests').select('*').order('created_at', { ascending: false }),
  ]);

  if (pErr) console.error(pErr);
  if (rErr) console.error(rErr);
  if (payErr) console.error(payErr);

  ALL_PROFILES = {};
  (profiles || []).forEach(p => { ALL_PROFILES[p.id] = p; });
  ALL_REQUESTS = requests || [];
  ALL_PAYMENTS = payments || [];

  renderRequests();
  renderUsers();
  renderPayments();
  updateOverviewStats();
}

(async () => {
  const ctx = await requireAdmin('dashboard.html');
  if (!ctx) return;
  CURRENT_USER = ctx.user;
  CURRENT_PROFILE = ctx.profile;

  const name = CURRENT_PROFILE?.full_name || CURRENT_USER.email;
  document.getElementById('chip-avatar').textContent = initials(name);
  document.getElementById('chip-name').textContent = name;

  await loadAll();

  supabase
    .channel('admin-requests')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_requests' }, () => loadAll())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_requests' }, () => loadAll())
    .subscribe();
})();
