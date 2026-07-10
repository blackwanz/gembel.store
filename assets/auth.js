/* ============================================================
   AUTH GUARDS + SHARED HELPERS — Gembel AI PIK
   ============================================================
   Dipakai di index.html, dashboard.html, admin.html, dan
   apps/* (calendar, progbar). Semua fungsi diekspos sebagai
   global (bukan ES module) supaya kompatibel dengan cara
   halaman lain manggilnya lewat onclick="..." dan <script src>.

   Tabel profil sekarang bernama `user_profiles`, primary key
   `user_id` (bukan `id`) — lihat schema.sql.
   ============================================================ */

// ------------------------------------------------------------
// SESSION / PROFILE LOOKUPS
// ------------------------------------------------------------

/** User Supabase Auth yang lagi login, atau null. */
async function getSessionUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('getSessionUser:', error.message);
    return null;
  }
  return data?.user || null;
}

/** Baris user_profiles buat userId tertentu, atau null. */
async function getProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('getProfile:', error.message);
    return null;
  }
  return data;
}

/** true kalau profile ada di plan berbayar (Elite). */
function isElite(profile) {
  return !!profile && profile.plan === 'elite';
}

/** true kalau profile adalah admin. */
function isAdminProfile(profile) {
  return !!profile && profile.role === 'admin';
}

// ------------------------------------------------------------
// GUARDS — dipanggil di IIFE paling bawah tiap halaman
// ------------------------------------------------------------

/**
 * Wajib login. Kalau nggak, redirect ke redirectPath dan return null.
 * Kalau login tapi profilnya belum ke-provision (race dengan trigger
 * signup), tunggu sebentar lalu coba sekali lagi sebelum nyerah.
 */
async function requireAuth(redirectPath) {
  const user = await getSessionUser();
  if (!user) {
    window.location.href = redirectPath;
    return null;
  }
  let profile = await getProfile(user.id);
  if (!profile) {
    // trigger handle_new_user() di Postgres kadang butuh sepersekian
    // detik buat jalan setelah signUp() resolve — kasih satu kali retry.
    await new Promise(r => setTimeout(r, 700));
    profile = await getProfile(user.id);
  }
  return { user, profile };
}

/** Wajib login DAN role === 'admin'. Kalau bukan admin, tendang balik. */
async function requireAdmin(redirectPath) {
  const ctx = await requireAuth(redirectPath);
  if (!ctx) return null;
  if (!isAdminProfile(ctx.profile)) {
    window.location.href = redirectPath;
    return null;
  }
  return ctx;
}

/**
 * Sama kayak requireAuth, tapi kalau nggak ada session, cek dulu
 * apakah ini sesi "guest/demo" (disimpan di sessionStorage oleh
 * halaman app individual, misal calendar.html). Kalau iya, kasih
 * jalan dengan profile kosong + isGuest true; kalau nggak ada
 * keduanya, baru redirect.
 */
async function requireAuthOrGuest(redirectPath) {
  const user = await getSessionUser();
  if (user) {
    const profile = await getProfile(user.id);
    return { user, profile, isGuest: false };
  }
  const guestFlag = sessionStorage.getItem('gembel_guest_demo');
  if (guestFlag === '1') {
    return { user: null, profile: null, isGuest: true };
  }
  window.location.href = redirectPath;
  return null;
}

/** Bersihin state guest/demo (dipanggil dari banner "keluar demo"). */
function exitGuestDemo() {
  sessionStorage.removeItem('gembel_guest_demo');
  window.location.href = 'index.html';
}

// ------------------------------------------------------------
// LOGOUT
// ------------------------------------------------------------
async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ------------------------------------------------------------
// FORMATTING HELPERS
// ------------------------------------------------------------

/** "Budi Santoso" -> "BS". Fallback ke "?" kalau nama kosong. */
function initials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Escape dasar buat cegah XSS pas nyisipin teks user ke innerHTML. */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO timestamp -> "2 jam lalu" / "baru saja" / dst (Bahasa Indonesia). */
function fmtRelativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 10) return 'baru saja';
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} hari lalu`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} bulan lalu`;
  const diffYear = Math.floor(diffMonth / 12);
  return `${diffYear} tahun lalu`;
}

// ------------------------------------------------------------
// PASSWORD VALIDATION
// ------------------------------------------------------------

/**
 * Min 8 karakter, 1 huruf besar, 1 angka, 1 simbol.
 * Return string pesan error, atau falsy (undefined) kalau password OK.
 */
function validatePasswordStrength(pw) {
  if (!pw || pw.length < 8) return 'Password minimal 8 karakter.';
  if (!/[A-Z]/.test(pw)) return 'Password harus ada minimal 1 huruf besar.';
  if (!/[0-9]/.test(pw)) return 'Password harus ada minimal 1 angka.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password harus ada minimal 1 simbol (contoh: ! @ # $ %).';
  return '';
}

// ------------------------------------------------------------
// THEME TOGGLE
// ------------------------------------------------------------
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('gembel_theme', next); } catch (_) { /* storage might be blocked, non-fatal */ }
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('gembel_theme'); } catch (_) { /* ignore */ }
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ------------------------------------------------------------
// PAYMENT MODAL — Elite upgrade flow
// ------------------------------------------------------------
// Menulis satu baris ke payment_request (status 'pending'). Admin
// yang konfirmasi di admin.html, yang baru nge-set user_profiles.plan.
// Ini pengganti modal lama yang dead-end — sekarang beneran nyambung
// ke sebuah tabel yang bisa diproses.

function _paymentModalMarkup(profile) {
  const price = window.GEMBEL_PRICE ?? 19999;
  const priceNormal = window.GEMBEL_PRICE_NORMAL ?? 1000000;
  const fmt = n => 'Rp' + Number(n).toLocaleString('id-ID');
  return `
    <div class="modal-backdrop" id="gembel-payment-backdrop">
      <div class="modal-card">
        <button class="modal-close" id="gembel-payment-close" aria-label="Tutup">✕</button>
        <div class="modal-kicker">UPGRADE ELITE ⭐</div>
        <h2>Buka semua fitur Elite</h2>
        <p style="color:var(--text-muted);font-size:13.5px;">
          Antrian prioritas, akses app custom tanpa batas waktu, dan unduh APK.
        </p>
        <div class="modal-price">
          <span class="now mono">${fmt(price)}</span>
          <span class="normal mono">${fmt(priceNormal)}</span>
        </div>
        <div class="field">
          <label>Catatan (opsional)</label>
          <textarea id="gembel-payment-note" placeholder="Contoh: sudah transfer via GoPay a/n ..." maxlength="300" style="min-height:60px;"></textarea>
        </div>
        <div id="gembel-payment-msg" class="form-msg"></div>
        <button class="btn btn-primary btn-block" id="gembel-payment-submit">Ajukan Upgrade →</button>
        <p style="font-size:11.5px;color:var(--text-faint);margin-top:10px;">
          Setelah diajukan, admin bakal konfirmasi manual dan plan lo keupdate otomatis.
        </p>
      </div>
    </div>`;
}

/**
 * Buka modal upgrade Elite. onDone() dipanggil setelah payment_request
 * berhasil dibuat (bukan setelah admin konfirmasi — itu proses terpisah,
 * live-update lewat realtime subscription di dashboard.js).
 */
function openPaymentModal(profile, onDone) {
  if (!profile) { console.error('openPaymentModal: profile kosong'); return; }
  if (document.getElementById('gembel-payment-backdrop')) return; // sudah kebuka

  document.body.insertAdjacentHTML('beforeend', _paymentModalMarkup(profile));
  const backdrop = document.getElementById('gembel-payment-backdrop');
  const closeBtn = document.getElementById('gembel-payment-close');
  const submitBtn = document.getElementById('gembel-payment-submit');
  const msgEl = document.getElementById('gembel-payment-msg');

  const close = () => backdrop.remove();
  closeBtn.onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Mengirim…';
    msgEl.className = 'form-msg';

    const note = document.getElementById('gembel-payment-note').value.trim();
    const { error } = await supabase.from('payment_request').insert({
      user_id: profile.user_id,
      amount: window.GEMBEL_PRICE ?? 19999,
      status: 'pending',
      flag_premium: window.GEMBEL_PLAN_TARGET ?? 'elite',
      note: note || null,
      date_request: new Date().toISOString().slice(0, 10),
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Ajukan Upgrade →';

    if (error) {
      msgEl.textContent = 'Gagal ngirim pengajuan: ' + error.message;
      msgEl.className = 'form-msg show error';
      return;
    }

    msgEl.textContent = 'Pengajuan terkirim! Admin bakal konfirmasi segera.';
    msgEl.className = 'form-msg show success';
    setTimeout(() => {
      close();
      if (typeof onDone === 'function') onDone();
    }, 1400);
  };
}