/* ============================================================
   DASHBOARD LOGIC — dashboard.html
   Requires: supabase CDN + assets/supabaseClient.js + assets/auth.js
   ------------------------------------------------------------
   CATATAN PERBAIKAN: sebelumnya file ini berisi SATU HALAMAN HTML
   utuh (hasil copy-paste keliru), bukan JavaScript. Browser parse
   sebagai JS -> SyntaxError 'Unexpected token <' -> SEMUA function
   dashboard (switchTab, submitRequest, saveProfile, loadRequests,
   dst.) tidak pernah ada -> dashboard mati total. Isi file ini
   sekarang = script <script>...</script> yang tadinya nyangkut di
   dalam HTML itu, dikeluarkan apa adanya (tanpa diubah).
   ============================================================ */

let CURRENT_USER = null;
let CURRENT_PROFILE = null;

// ===== INSTALLED_APPS =====
// Hardcoded for now — the real `apps` table (apps_id, apps_desc, start_date,
// end_date) has no column to store a path/title/icon, so there's nothing to
// drive this from yet. When that changes (e.g. an app_url/title/icon column
// gets added, or this starts reading user_profiles.plan to gate access),
// this array is the one place to swap for a Supabase query — everything
// below (renderInstalledApps) already reads from this array, not from HTML,
// so the render logic won't need to change.
const INSTALLED_APPS = [
  { icon: '📅', title: 'Kalender Produktivitas', desc: 'Goals harian, tracking angka, dan progress bulanan. Selalu aktif, gratis buat semua member.', url: 'apps/calendar/calendar.html' },
  { icon: '⚡', title: 'Neon Flow — Time Tracker', desc: 'Progress tracker gaya cyberpunk — lacak sesi kerja lo per warna (fokus/istirahat/lainnya) sampai target waktu harian. Data tersimpan di akun lo.', url: 'apps/progbar/progbar.html' },
  { icon: '🧘', title: 'Meditate Space', desc: 'Sesi meditasi terpandu buat reset fokus lo di tengah hari.', url: 'apps/meditate/meditate.html' },
  { icon: '💼', title: 'Portfolio Live', desc: 'Lacak holdings crypto & stock lo dengan harga real-time. Data tersimpan di akun lo.', url: 'apps/portfolio/portfolio.html' },
  { icon: '🛡️', title: 'Trade Master', desc: 'Terminal trading risk-locked yang nyambung ke MT5.', url: 'apps/trademaster/trademaster.html' },
  { icon: '⏱️', title: 'Habit Tracker', desc: 'Catat aktivitas harian lo — mulai/stop sesi, lihat riwayatnya kapan aja.', url: 'apps/habbit/habbit.html' },
];

function renderInstalledApps() {
  const slot = document.getElementById('installed-apps-slot');
  if (!slot) return;
  slot.innerHTML = INSTALLED_APPS.map(app => `
    <div class="tool-card">
      <div class="tool-icon">${app.icon}</div>
      <div>
        <h3>${escapeHtml(app.title)}</h3>
        <p>${escapeHtml(app.desc)}</p>
      </div>
      <button class="btn btn-primary btn-block" onclick="window.location.href='${app.url}'">Buka ${escapeHtml(app.title)} →</button>
    </div>`).join('');
}

function switchTab(name) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('tab-apps').style.display = name === 'apps' ? 'block' : 'none';
  document.getElementById('tab-profil').style.display = name === 'profil' ? 'block' : 'none';
}

function statusLabel(s) {
  return { antre: 'ANTRE', diproses: 'DIPROSES', selesai: 'SELESAI' }[s] || s.toUpperCase();
}

function renderTicket(req) {
  const num = '#' + req.id.slice(0, 6).toUpperCase();
  const title = req.title && req.title.trim() ? req.title : 'App baru lo';
  const elite = isElite(CURRENT_PROFILE);
  const expired = !elite && req.expires_at && new Date(req.expires_at) < new Date();
  const canOpen = req.status === 'selesai' && req.app_url && !expired;
  const canDownload = req.status === 'selesai' && req.apk_url && !expired;

  let expiryHtml = '';
  if (!elite && req.status === 'selesai' && req.expires_at) {
    if (expired) {
      expiryHtml = `<span class="ticket-expiry expired">⏰ Akses 3 jam habis — <a href="#" onclick="openPaymentModal(CURRENT_PROFILE, loadRequests); return false;" style="color:inherit;text-decoration:underline;">upgrade Elite</a> buat buka lagi</span>`;
    } else {
      expiryHtml = `<span class="ticket-expiry" data-expires="${req.expires_at}">⏰ sisa akses: menghitung…</span>`;
    }
  }

  return `
    <div class="ticket st-${req.status}" data-id="${req.id}">
      <div class="ticket-head">
        <span class="ticket-num mono" title="ID App: ${req.id}">${num}</span>
        <span class="badge st-${req.status}">${statusLabel(req.status)}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="prompt">${escapeHtml(req.prompt)}</p>
      ${req.admin_note ? `<p class="prompt" style="color:var(--primary-text);">Catatan: ${escapeHtml(req.admin_note)}</p>` : ''}
      ${expiryHtml}
      <div class="ticket-foot">
        <span class="ticket-time">${fmtRelativeTime(req.created_at)}</span>
        <div class="ticket-actions">
          ${canDownload ? `<a class="btn btn-ghost btn-sm" href="${req.apk_url}" target="_blank" rel="noopener">Unduh APK</a>` : ''}
          ${canOpen ? `<a class="btn btn-primary btn-sm" href="${req.app_url}" target="_blank" rel="noopener">Buka</a>` : ''}
          ${!canOpen && !canDownload && !expired ? `<button class="btn btn-ghost btn-sm" disabled>${req.status === 'antre' ? 'Dalam antrian' : req.status === 'diproses' ? 'Lagi dikerjain' : 'Belum ada link'}</button>` : ''}
        </div>
      </div>
    </div>`;
}

// hitung mundur sisa akses free tier tiap detik
setInterval(() => {
  let anyExpired = false;
  document.querySelectorAll('.ticket-expiry[data-expires]').forEach(el => {
    const left = Math.floor((new Date(el.dataset.expires) - Date.now()) / 1000);
    if (left <= 0) { anyExpired = true; return; }
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    el.textContent = `⏰ sisa akses: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  });
  if (anyExpired) loadRequests();
}, 1000);

function updateStats(requests) {
  document.getElementById('stat-total').textContent = requests.length;
  document.getElementById('stat-proses').textContent = requests.filter(r => r.status === 'diproses').length;
  document.getElementById('stat-selesai').textContent = requests.filter(r => r.status === 'selesai').length;
}

async function loadRequests() {
  const { data, error } = await supabase
    .from('app_request')
    .select('*')
    .eq('user_id', CURRENT_USER.id)
    .order('created_at', { ascending: false });

  const loadingEl = document.getElementById('requests-loading');
  if (loadingEl) loadingEl.remove();

  document.querySelectorAll('.ticket').forEach(el => el.remove());

  if (error) {
    console.error(error);
    return;
  }
  updateStats(data);
  const grid = document.getElementById('apps-grid');
  data.forEach(req => grid.insertAdjacentHTML('beforeend', renderTicket(req)));
}

async function submitRequest() {
  const titleEl = document.getElementById('new-title');
  const promptEl = document.getElementById('new-prompt');
  const text = promptEl.value.trim();
  if (!text) { promptEl.focus(); return; }

  const btn = document.getElementById('submit-request-btn');
  btn.disabled = true;
  btn.textContent = 'Ngirim…';

  const { error } = await supabase.from('app_request').insert({
    user_id: CURRENT_USER.id,
    title: titleEl.value.trim() || null,
    prompt: text,
    status: 'antre',
  });

  btn.disabled = false;
  btn.textContent = 'Kirim prompt →';

  if (error) {
    alert('Gagal kirim: ' + error.message);
    return;
  }
  titleEl.value = '';
  promptEl.value = '';
  await loadRequests();
}

function fillProfile() {
  const name = CURRENT_PROFILE?.full_name || CURRENT_USER.email;
  document.getElementById('chip-avatar').textContent = initials(name);
  document.getElementById('chip-name').textContent = name;
  const elite = isElite(CURRENT_PROFILE);
  document.getElementById('chip-role').innerHTML = CURRENT_PROFILE?.role === 'admin'
    ? '👑 ADMIN'
    : (elite ? '<span class="plan-badge elite">ELITE ⭐</span>' : '<span class="plan-badge free">FREE</span>');
  const upBtn = document.getElementById('upgrade-btn');
  if (upBtn) upBtn.style.display = (elite || CURRENT_PROFILE?.role === 'admin') ? 'none' : 'inline-flex';
  document.getElementById('chip-avatar').classList.toggle('admin', CURRENT_PROFILE?.role === 'admin');

  document.getElementById('profil-email').textContent = CURRENT_USER.email;

  // isi form update profil
  document.getElementById('edit-name').value = CURRENT_PROFILE?.full_name || '';
  document.getElementById('edit-phone').value = CURRENT_PROFILE?.phone || '';
  const w = CURRENT_PROFILE?.wallet_type || 'nothing';
  document.getElementById('edit-wallet').value = w;
  document.getElementById('wallet-number-field').style.display = w === 'nothing' ? 'none' : 'block';
  document.getElementById('edit-wallet-number').value = CURRENT_PROFILE?.wallet_number || '';
  document.getElementById('edit-bio').value = CURRENT_PROFILE?.bio || '';
  document.getElementById('profil-role').textContent = CURRENT_PROFILE?.role === 'admin' ? 'Admin' : 'Member';
  document.getElementById('profil-plan').textContent = elite
    ? 'Elite ⭐' + (CURRENT_PROFILE?.plan_until ? ' (aktif s/d ' + new Date(CURRENT_PROFILE.plan_until).toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'}) + ')' : '')
    : 'Free';
  document.getElementById('profil-since').textContent = CURRENT_PROFILE?.created_at
    ? new Date(CURRENT_PROFILE.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
}

async function saveProfile() {
  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const wallet = document.getElementById('edit-wallet').value;
  const { error } = await supabase.from('user_profiles').update({
    full_name: document.getElementById('edit-name').value.trim() || null,
    phone: document.getElementById('edit-phone').value.trim() || null,
    wallet_type: wallet,
    wallet_number: wallet === 'nothing' ? null : (document.getElementById('edit-wallet-number').value.trim() || null),
    bio: document.getElementById('edit-bio').value.trim() || null,
  }).eq('user_id', CURRENT_USER.id);
  btn.disabled = false; btn.textContent = 'Simpan profil';
  if (error) { alert('Gagal simpan: ' + error.message); return; }
  CURRENT_PROFILE = await getProfile(CURRENT_USER.id);
  fillProfile();
  btn.textContent = 'Tersimpan ✓';
  setTimeout(() => { btn.textContent = 'Simpan profil'; }, 1800);
}

(async () => {
  const ctx = await requireAuth('index.html');
  if (!ctx) return;
  CURRENT_USER = ctx.user;
  CURRENT_PROFILE = ctx.profile;
  fillProfile();
  renderInstalledApps();
  await loadRequests();

  // live-update ticket status the moment an admin changes it
  supabase
    .channel('own-requests-' + CURRENT_USER.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_request', filter: `user_id=eq.${CURRENT_USER.id}` },
      () => loadRequests()
    )
    .subscribe();

  // kalau admin konfirmasi pembayaran pas lo lagi buka dashboard -> plan keupdate live
  supabase
    .channel('own-profile-' + CURRENT_USER.id)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `user_id=eq.${CURRENT_USER.id}` },
      async () => { CURRENT_PROFILE = await getProfile(CURRENT_USER.id); fillProfile(); loadRequests(); }
    )
    .subscribe();
})();
