// ===== DEMO: prompt typing → apps generate =====
let demoRunning = false;
const DEMO_TEXT = "bikinin gue kalender produktivitas + time tracker buat kerjaan harian...";
async function runDemo() {
  if (demoRunning) return;
  demoRunning = true;
  const typed = document.getElementById('demo-typed');
  const btn = document.getElementById('demo-btn');
  const app1 = document.getElementById('demo-app-1');
  const app2 = document.getElementById('demo-app-2');
  typed.textContent = '';
  app1.classList.remove('show'); app2.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Ngetik prompt…';

  for (let i = 0; i < DEMO_TEXT.length; i++) {
    typed.textContent += DEMO_TEXT[i];
    await new Promise(r => setTimeout(r, 28));
  }
  btn.textContent = 'Meracik app… ⚙️';
  await new Promise(r => setTimeout(r, 900));
  app1.classList.add('show');
  await new Promise(r => setTimeout(r, 450));
  app2.classList.add('show');
  btn.textContent = 'Jadi! Pesen punya lo sendiri →';
  btn.disabled = false;
  btn.onclick = () => { showView('auth'); switchAuthTab('signup'); };
  demoRunning = false;
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function switchAuthTab(which) {
  const isLogin = which === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-signup').classList.toggle('active', !isLogin);
  document.getElementById('login-form').style.display = isLogin ? 'block' : 'none';
  document.getElementById('signup-form').style.display = isLogin ? 'none' : 'block';
  hideMsg();
}

function showMsg(text, type) {
  const el = document.getElementById('form-msg');
  el.textContent = text;
  el.className = 'form-msg show ' + type;
}
function hideMsg() {
  const el = document.getElementById('form-msg');
  el.className = 'form-msg';
}
function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? 'Tunggu sebentar…' : label;
}

async function routeAfterLogin() {
  const user = await getSessionUser();
  if (!user) return;
  const profile = await getProfile(user.id);
  window.location.href = (profile && profile.role === 'admin') ? 'admin.html' : 'dashboard.html';
}

// Terjemahkan error Supabase jadi pesan yang manusiawi
function friendlyAuthError(error) {
  const code = error?.code || '';
  const msg = (error?.message || '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
    return 'Email atau password salah. Kalau lupa, klik "Lupa password?".';
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed'))
    return 'Email lo belum dikonfirmasi. Cek inbox (dan folder spam) buat link konfirmasinya.';
  if (code === 'user_already_exists' || msg.includes('already registered'))
    return 'Email ini udah terdaftar. Coba Masuk, atau pake "Lupa password?" kalau lupa.';
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit'))
    return 'Kebanyakan percobaan. Tunggu 1-2 menit terus coba lagi.';
  if (code === 'weak_password' || msg.includes('password'))
    return 'Password terlalu lemah. Minimal 6 karakter.';
  return error?.message || 'Ada yang error. Coba lagi ya.';
}

async function handleLogin() {
  hideMsg();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { showMsg('Isi email dan password dulu ya.', 'error'); return; }
  setLoading('login-submit', true, 'Masuk →');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setLoading('login-submit', false, 'Masuk →');
  if (error) {
    showMsg(friendlyAuthError(error), 'error');
    return;
  }
  await routeAfterLogin();
}

let PENDING_EMAIL = null;

function showOtpForm(email) {
  PENDING_EMAIL = email;
  showView('auth');
  document.querySelector('.auth-tabs').style.display = 'none';
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('otp-form').style.display = 'block';
  document.getElementById('otp-email-label').textContent = email;
  document.getElementById('otp-code').focus();
}

async function handleVerifyOtp() {
  hideMsg();
  const code = document.getElementById('otp-code').value.trim();
  if (code.length !== 6) { showMsg('Kode verifikasi 6 digit ya.', 'error'); return; }
  setLoading('otp-submit', true, 'Verifikasi →');
  const { error } = await supabase.auth.verifyOtp({ email: PENDING_EMAIL, token: code, type: 'signup' });
  setLoading('otp-submit', false, 'Verifikasi →');
  if (error) {
    // token dari email lama bisa bertipe 'magiclink'; coba fallback
    const retry = await supabase.auth.verifyOtp({ email: PENDING_EMAIL, token: code, type: 'magiclink' });
    if (retry.error) { showMsg('Kode salah atau kedaluwarsa. Coba kirim ulang.', 'error'); return; }
  }
  showMsg('Email terverifikasi! ✓', 'success');
  await offerEliteThenRoute();
}

async function handleResendOtp() {
  hideMsg();
  const { error } = await supabase.auth.resend({ type: 'signup', email: PENDING_EMAIL });
  if (error) { showMsg(friendlyAuthError(error), 'error'); return; }
  showMsg('Kode baru dikirim. Cek email lo.', 'success');
}

async function offerEliteThenRoute() {
  const user = await getSessionUser();
  if (!user) { switchAuthTab('login'); return; }
  const profile = await getProfile(user.id);
  if (profile && !isElite(profile)) {
    openPaymentModal(profile, () => routeAfterLogin());
  } else {
    await routeAfterLogin();
  }
}

async function handleSignup() {
  hideMsg();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !email || !password) { showMsg('Lengkapi semua field dulu ya.', 'error'); return; }
  const pwErr = validatePasswordStrength(password);
  if (pwErr) { showMsg(pwErr, 'error'); return; }
  setLoading('signup-submit', true, 'Daftar gratis →');
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  setLoading('signup-submit', false, 'Daftar gratis →');
  if (error) { showMsg(friendlyAuthError(error), 'error'); return; }

  // Supabase nggak selalu kasih error kalau email udah terdaftar
  // (buat privasi) — tandanya: user ada tapi identities-nya kosong.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    showMsg('Email ini udah terdaftar. Coba Masuk, atau pake "Lupa password?" kalau lupa.', 'error');
    switchAuthTab('login');
    return;
  }

  if (data.session && data.user && data.user.email_confirmed_at) {
    // email sudah otomatis terverifikasi -> tawarkan Elite
    await offerEliteThenRoute();
  } else if (data.session) {
    // ada session tapi email belum diverifikasi -> tetap paksa OTP
    showOtpForm(email);
  } else {
    // konfirmasi email nyala -> minta kode OTP
    showOtpForm(email);
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { showMsg('Ketik email lo dulu di field di atas, terus klik "Lupa password?" lagi.', 'error'); return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) { showMsg(error.message, 'error'); return; }
  showMsg('Link reset password udah dikirim ke email lo.', 'success');
}

// ===== RESET PASSWORD FLOW =====
function isRecoveryFlow() {
  return (window.location.hash + window.location.search).includes('type=recovery');
}

function showResetForm() {
  showView('auth');
  document.querySelector('.auth-tabs').style.display = 'none';
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'block';
}

async function handleResetPassword() {
  hideMsg();
  const p1 = document.getElementById('reset-password').value;
  const p2 = document.getElementById('reset-password2').value;
  const pwErr2 = validatePasswordStrength(p1);
  if (pwErr2) { showMsg(pwErr2, 'error'); return; }
  if (p1 !== p2) { showMsg('Kedua password nggak sama. Coba ketik ulang.', 'error'); return; }
  setLoading('reset-submit', true, 'Simpan password baru →');
  const { error } = await supabase.auth.updateUser({ password: p1 });
  setLoading('reset-submit', false, 'Simpan password baru →');
  if (error) { showMsg(friendlyAuthError(error), 'error'); return; }
  showMsg('Password baru tersimpan! Lo bakal diarahkan ke dashboard…', 'success');
  setTimeout(() => routeAfterLogin(), 1200);
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') showResetForm();
});

// If already logged in, skip straight to the right dashboard.
(async () => {
  if (isRecoveryFlow()) { showResetForm(); return; } // jangan auto-redirect saat lagi reset password
  const user = await getSessionUser();
  if (user) await routeAfterLogin();
})();
