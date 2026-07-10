/* ============================================================
   AUTH HELPERS — shared by every page
   Requires supabaseClient.js to be loaded first.
   ============================================================ */

async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("getSession error", error);
    return null;
  }
  return data.session ? data.session.user : null;
}

async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) {
    console.error("getProfile error", error);
    return null;
  }
  return data;
}

/** Call on any page that requires a logged-in user. Redirects to login if not authed. */
async function requireAuth(redirectTo = "index.html") {
  const user = await getSessionUser();
  if (!user) {
    window.location.href = redirectTo;
    return null;
  }
  const profile = await getProfile(user.id);
  return { user, profile };
}

/* ============================================================
   GUEST / DEMO MODE
   Lets someone try the Calendar / Neon Flow apps with zero signup.
   Guest data lives ONLY in this browser tab's sessionStorage/localStorage
   and is never sent to Supabase — no account, no session, nothing to
   clean up server-side.
   ============================================================ */
const GUEST_FLAG_KEY = "gembel_guest_mode";

function isGuestSession() {
  return sessionStorage.getItem(GUEST_FLAG_KEY) === "1";
}

/** Call from a "Coba Demo" button/link to enter guest mode. */
function startGuestDemo(destination) {
  sessionStorage.setItem(GUEST_FLAG_KEY, "1");
  window.location.href = destination;
}

/** Leaves guest mode (used by the "Daftar buat nyimpen" banner CTA). */
function exitGuestDemo() {
  sessionStorage.removeItem(GUEST_FLAG_KEY);
  sessionStorage.removeItem("gembel_guest_id");
}

/**
 * Like requireAuth(), but lets a guest session through instead of
 * redirecting. Returns { user, profile, isGuest }. A guest user has a
 * stable-per-tab fake id and a null profile. A real logged-in user
 * always takes priority over guest mode.
 */
async function requireAuthOrGuest(redirectTo = "index.html") {
  const user = await getSessionUser();
  if (user) {
    const profile = await getProfile(user.id);
    return { user, profile, isGuest: false };
  }
  if (isGuestSession()) {
    let guestId = sessionStorage.getItem("gembel_guest_id");
    if (!guestId) {
      guestId = "guest-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem("gembel_guest_id", guestId);
    }
    return { user: { id: guestId, email: null }, profile: null, isGuest: true };
  }
  window.location.href = redirectTo;
  return null;
}

/** Call on the admin page. Bounces non-admins back to their normal dashboard. */
async function requireAdmin(redirectTo = "dashboard.html") {
  const ctx = await requireAuth("index.html");
  if (!ctx) return null;
  if (!ctx.profile || ctx.profile.role !== "admin") {
    window.location.href = redirectTo;
    return null;
  }
  return ctx;
}

function initials(nameOrEmail) {
  if (!nameOrEmail) return "??";
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.substring(0, 2);
  return letters.toUpperCase();
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

function fmtRelativeTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} minggu lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ============ THEME (dark mode) ============ */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("gembel_theme", theme);
  document.querySelectorAll(".theme-toggle").forEach(b => { b.textContent = theme === "dark" ? "☀️" : "🌙"; });
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}
// apply immediately (before paint if possible)
(function () {
  const saved = localStorage.getItem("gembel_theme")
    || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", saved);
  document.addEventListener("DOMContentLoaded", () => applyTheme(saved));
})();

/* ============================================================
   PLAN & PEMBAYARAN (dipakai index + dashboard)
   ============================================================ */
function isElite(profile) {
  if (!profile || profile.plan !== "elite") return false;
  if (profile.plan_until && new Date(profile.plan_until) < new Date()) return false;
  return true;
}

function rupiah(n) { return "Rp " + Number(n).toLocaleString("id-ID"); }

function openPaymentModal(profile, onDone) {
  if (!profile || !profile.id) { alert("Profil belum kebaca. Refresh halaman dulu ya."); return; }
  if (document.getElementById("pay-modal")) return;
  const price = window.GEMBEL_PRICE || 19999;
  const normal = window.GEMBEL_PRICE_NORMAL || 1000000;
  const disc = Math.round((1 - price / normal) * 100);

  const wrap = document.createElement("div");
  wrap.id = "pay-modal";
  wrap.className = "pay-overlay";
  wrap.innerHTML = `
    <div class="pay-card">
      <div class="pay-banner">
        <div class="pay-banner-spark">🔥 PROMO EARLY MEMBER</div>
        <div class="pay-banner-disc">DISKON ${disc}%</div>
        <div class="pay-banner-sub">Kunci harga sekarang sebelum naik!</div>
      </div>
      <div class="pay-body">
        <h3>Upgrade ke Elite Tier ⭐</h3>
        <div class="pay-price">
          <span class="old">${rupiah(normal)}</span>
          <span class="new">${rupiah(price)}</span>
          <span class="per">/ bulan</span>
        </div>
        <ul class="pay-perks">
          <li>✅ App custom dari nol, tanpa batas waktu akses</li>
          <li>✅ Prioritas antrian &amp; revisi langsung</li>
          <li>✅ Unduh APK + akses browser</li>
        </ul>
        <p class="pay-note">Free tier tetap bisa pesan app — tapi akses tiap app cuma <b>3 jam</b> setelah jadi.</p>
        <button class="btn btn-primary btn-block" id="pay-go">Bayar ${rupiah(price)} →</button>
        <button class="btn btn-ghost btn-block" id="pay-skip" style="margin-top:8px;">Nanti dulu, pakai Free</button>
      </div>
      <div class="pay-waiting" id="pay-waiting" style="display:none;">
        <div class="pay-spinner"></div>
        <h3>Menunggu konfirmasi pembayaran…</h3>
        <p>Biasanya kurang dari <b>5 menit</b>. Halaman ini bakal update otomatis begitu dikonfirmasi.</p>
        <div class="pay-countdown mono" id="pay-countdown">05:00</div>
        <button class="btn btn-ghost btn-block" id="pay-later" style="display:none;">Lanjut pakai Free dulu — Elite aktif otomatis begitu dikonfirmasi</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const finish = () => { wrap.remove(); if (onDone) onDone(); };
  document.getElementById("pay-skip").onclick = finish;

  document.getElementById("pay-go").onclick = async () => {
    const btn = document.getElementById("pay-go");
    btn.disabled = true; btn.textContent = "Memproses…";
    const { error } = await supabase.from("payment_requests").insert({ user_id: profile.id, amount: price });
    if (error) { alert("Gagal bikin tagihan: " + error.message); btn.disabled = false; btn.textContent = "Bayar " + rupiah(price) + " →"; return; }
    if (window.GEMBEL_PAYMENT_URL) window.open(window.GEMBEL_PAYMENT_URL, "_blank", "noopener");

    document.querySelector("#pay-modal .pay-body").style.display = "none";
    document.querySelector("#pay-modal .pay-banner").style.display = "none";
    document.getElementById("pay-waiting").style.display = "block";

    // countdown 5 menit
    let left = 300;
    const cd = document.getElementById("pay-countdown");
    const tick = setInterval(() => {
      left--;
      cd.textContent = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
      if (left <= 0) {
        clearInterval(tick);
        cd.textContent = "Masih diproses…";
        document.getElementById("pay-later").style.display = "block";
      }
    }, 1000);
    document.getElementById("pay-later").onclick = () => { clearInterval(tick); finish(); };

    // realtime: begitu admin konfirmasi → sukses
    supabase
      .channel("pay-" + profile.id)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_requests", filter: `user_id=eq.${profile.id}` },
        (payload) => {
          if (payload.new && payload.new.status === "confirmed") {
            clearInterval(tick);
            document.getElementById("pay-waiting").innerHTML =
              `<div style="font-size:44px;">🎉</div><h3>Pembayaran dikonfirmasi!</h3><p>Akun lo sekarang <b>Elite</b>. Selamat menikmati.</p>`;
            setTimeout(finish, 1800);
          }
          if (payload.new && payload.new.status === "rejected") {
            clearInterval(tick);
            document.getElementById("pay-waiting").innerHTML =
              `<h3>Pembayaran ditolak</h3><p>Hubungi admin kalau lo ngerasa ini keliru.</p><button class="btn btn-ghost btn-block" onclick="document.getElementById('pay-modal').remove()">Tutup</button>`;
          }
        })
      .subscribe();
  };
}

/* ============ VALIDASI PASSWORD KUAT ============ */
function validatePasswordStrength(p) {
  if (!p || p.length < 8) return "Password minimal 8 karakter.";
  if (!/[A-Z]/.test(p)) return "Password harus punya minimal 1 huruf BESAR.";
  if (!/[0-9]/.test(p)) return "Password harus punya minimal 1 angka.";
  if (!/[^A-Za-z0-9]/.test(p)) return "Password harus punya minimal 1 simbol (contoh: ! @ # $).";
  return null; // lolos
}
