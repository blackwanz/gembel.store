// ===== login.js =====
// Logic buat login.html. Tujuan file ini CUMA SATU: nunjukin persis apa
// yang dibalikin Supabase pas auth dipanggil, tanpa nutupin/nerjemahin
// error jadi pesan "ramah user" (beda sama assets/index.js production yang
// punya friendlyAuthError() buat nyaring pesan error).
//
// Kalau lo lagi debug "kenapa login gagal", cek satu-satu di panel log:
//   1. Apakah request-nya bahkan nyampe (cek tag INFO "mengirim request")
//   2. Apakah client ke-block di jaringan / config salah (network error /
//      "Failed to fetch" muncul SEBELUM ada balikan dari Supabase)
//   3. Kalau ada balikan, `error.code` & `error.status` itu yang paling
//      sering nunjukin akar masalahnya (contoh: invalid_credentials,
//      email_not_confirmed, over_email_send_rate_limit, dst)
//   4. Kalau `error` null tapi `data.user` juga null/aneh -> biasanya bukan
//      soal Supabase, tapi state di sisi kita (session belum ke-set, dsb)

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status-line');
const configWarnEl = document.getElementById('config-warn');

// Deteksi paling awal: dibuka via file:// (double-click di Explorer/Finder)
// vs via http(s):// (local server). Ini beda akar masalah dari "belum isi
// credentials" — kalau file://, browser sering BLOKIR script CDN eksternal
// sama sekali, jadi window.supabaseSdk gak akan pernah ada apapun yang lo
// isi di loginsupabase.js. Ini pengecekan yang ketauan duluan sebelum klik
// tombol apa pun, biar gak nebak-nebak dari stack trace error.
const OPENED_VIA_FILE_PROTOCOL = window.location.protocol === 'file:';

function nowStamp() {
  const d = new Date();
  return d.toLocaleTimeString('id-ID', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// Nulis satu entry ke panel log (paling baru di atas) + dobelin ke
// console browser (console.log buat ok/info, console.error buat error) —
// dua-duanya lengkap, gak dipotong, gak diringkas.
function logEntry(tag, title, payload) {
  const ts = nowStamp();
  const tagClass = tag === 'ERROR' ? 'tag-err' : tag === 'OK' ? 'tag-ok' : 'tag-info';

  let payloadStr;
  try {
    // JSON.stringify dengan replacer yang nangkep Error object juga
    // (secara default JSON.stringify(new Error(...)) balikin "{}" kosong,
    // jadi kita tarik manual message/name/stack/code kalau ada).
    payloadStr = JSON.stringify(payload, (key, value) => {
      if (value instanceof Error) {
        const plain = { name: value.name, message: value.message };
        for (const k of Object.keys(value)) plain[k] = value[k];
        return plain;
      }
      return value;
    }, 2);
  } catch (e) {
    payloadStr = String(payload) + '\n(gagal di-stringify: ' + e.message + ')';
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'entry';
  wrapper.innerHTML =
    `<span class="tag ${tagClass}">${tag}</span>` +
    `<b>${title}</b> <span class="ts">${ts}</span>` +
    `<pre>${payloadStr.replace(/</g, '&lt;')}</pre>`;
  logEl.insertBefore(wrapper, logEl.firstChild);

  if (tag === 'ERROR') console.error(`[login.js] ${title}`, payload);
  else console.log(`[login.js] ${title}`, payload);
}

function clearLog() {
  logEl.innerHTML = '';
}

function setButtonsDisabled(disabled) {
  ['btn-login', 'btn-signup', 'btn-session', 'btn-logout'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

// ---------- status client, dicek begitu halaman kebuka ----------
function refreshClientStatus() {
  const sdkLoaded = typeof window.supabaseSdk !== 'undefined' && !!window.supabaseSdk?.createClient;
  const configured = typeof sb !== 'undefined' && sb !== null && !!sb.auth;

  if (OPENED_VIA_FILE_PROTOCOL && !sdkLoaded) {
    // Ini kasus paling sering: dibuka via file:// dan SDK CDN keblokir.
    configWarnEl.classList.add('show');
    configWarnEl.innerHTML =
      '⚠️ <b>Halaman ini dibuka langsung dari file (file://)</b> — browser ' +
      'kemungkinan besar MEMBLOKIR script CDN Supabase karena itu, jadi ' +
      '<code>supabase.auth</code> gak akan pernah ada apapun yang lo isi di ' +
      'loginsupabase.js. <b>Solusi:</b> jalankan lewat local server dulu, ' +
      'bukan double-click file-nya. Termudah: install extension "Live Server" ' +
      'di VS Code → klik kanan login.html → "Open with Live Server". ' +
      'Atau via terminal: <code>python -m http.server 5500</code> di folder ini, ' +
      'lalu buka <code>http://localhost:5500/login.html</code>.';
    statusEl.innerHTML = `<b>Protocol:</b> file:// ✗ (harus http/https)<br><b>SDK CDN loaded:</b> tidak`;
    logEntry('ERROR', 'status client saat load halaman', {
      openedViaFileProtocol: true,
      sdkLoaded: false,
      configured,
      diagnosis: 'Dibuka via file:// — SDK CDN kemungkinan diblokir browser. Jalankan via local server.',
    });
    return;
  }

  configWarnEl.classList.toggle('show', !configured);
  if (!configured) {
    configWarnEl.innerHTML =
      '⚠️ <b>loginsupabase.js belum dikonfigurasi.</b> Buka file itu, isi ' +
      'SUPABASE_URL dan SUPABASE_ANON_KEY punya lo, baru refresh halaman ini.';
  }
  statusEl.innerHTML = configured
    ? `<b>Protocol:</b> ${window.location.protocol}<br><b>Client:</b> configured ✓<br><b>URL:</b> ${SUPABASE_URL}<br><b>Anon key:</b> ${SUPABASE_ANON_KEY.slice(0, 12)}… (${SUPABASE_ANON_KEY.length} char)`
    : `<b>Protocol:</b> ${window.location.protocol}<br><b>SDK CDN loaded:</b> ${sdkLoaded ? 'ya' : 'TIDAK'}<br><b>Client:</b> BELUM DIKONFIGURASI ✗<br>Isi loginsupabase.js dulu.`;
  logEntry(configured ? 'OK' : 'ERROR', 'status client saat load halaman', {
    openedViaFileProtocol: OPENED_VIA_FILE_PROTOCOL,
    sdkLoaded,
    configured,
    clientHasAuth: !!sb?.auth,
    url: configured ? SUPABASE_URL : null,
    anonKeyLength: configured ? SUPABASE_ANON_KEY.length : 0,
  });
}

// ---------- LOGIN ----------
async function handleLogin() {
  if (!sb || !sb.auth) { logEntry('ERROR', 'handleLogin dibatalkan', diagnoseMissingClient()); return; }
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  logEntry('INFO', 'mengirim request signInWithPassword', { email, passwordLength: password.length });

  setButtonsDisabled(true);
  const startedAt = performance.now();
  try {
    const result = await sb.auth.signInWithPassword({ email, password });
    const ms = Math.round(performance.now() - startedAt);
    logEntry(result.error ? 'ERROR' : 'OK', `balikan signInWithPassword (${ms}ms)`, result);

    if (result.error) {
      // info tambahan yang sering kelewat kalau cuma baca .message
      logEntry('INFO', 'detail error.code / error.status', {
        code: result.error.code ?? '(tidak ada field code)',
        status: result.error.status ?? '(tidak ada field status)',
        name: result.error.name,
      });
    }
  } catch (networkErr) {
    // ini beda dari result.error di atas — kalau masuk sini artinya
    // request-nya SENDIRI gagal (network/CORS/URL salah), bukan Supabase
    // yang nolak kredensialnya. Tanda umum: "Failed to fetch".
    const ms = Math.round(performance.now() - startedAt);
    logEntry('ERROR', `EXCEPTION saat signInWithPassword (${ms}ms) — kemungkinan network/CORS/URL salah, BUKAN error dari Supabase auth`, {
      message: networkErr.message,
      name: networkErr.name,
      stack: networkErr.stack,
    });
  }
  setButtonsDisabled(false);
}

// ---------- SIGNUP (buat bikin akun test cepat kalau belum punya) ----------
async function handleSignup() {
  if (!sb || !sb.auth) { logEntry('ERROR', 'handleSignup dibatalkan', diagnoseMissingClient()); return; }
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  logEntry('INFO', 'mengirim request signUp', { email, passwordLength: password.length });

  setButtonsDisabled(true);
  const startedAt = performance.now();
  try {
    const result = await sb.auth.signUp({ email, password });
    const ms = Math.round(performance.now() - startedAt);
    logEntry(result.error ? 'ERROR' : 'OK', `balikan signUp (${ms}ms)`, result);

    if (!result.error && result.data?.user) {
      const identities = result.data.user.identities;
      logEntry('INFO', 'cek indikasi "email sudah terdaftar sebelumnya"', {
        identitiesLength: Array.isArray(identities) ? identities.length : '(bukan array / undefined)',
        note: Array.isArray(identities) && identities.length === 0
          ? 'identities kosong = email ini KEMUNGKINAN sudah terdaftar (Supabase gak selalu kasih error eksplisit demi privasi)'
          : 'identities ada isinya = kemungkinan akun baru',
      });
    }
  } catch (networkErr) {
    const ms = Math.round(performance.now() - startedAt);
    logEntry('ERROR', `EXCEPTION saat signUp (${ms}ms) — kemungkinan network/CORS/URL salah`, {
      message: networkErr.message,
      name: networkErr.name,
      stack: networkErr.stack,
    });
  }
  setButtonsDisabled(false);
}

// ---------- GET SESSION (cek state saat ini, tanpa login ulang) ----------
async function checkSession() {
  if (!sb || !sb.auth) { logEntry('ERROR', 'checkSession dibatalkan', diagnoseMissingClient()); return; }
  logEntry('INFO', 'mengirim request getSession', {});
  setButtonsDisabled(true);
  try {
    const result = await sb.auth.getSession();
    logEntry(result.error ? 'ERROR' : 'OK', 'balikan getSession', result);

    // getUser() dipisah dari getSession() secara sengaja: getSession() baca
    // dari local storage (bisa basi/dimanipulasi client), getUser() hit
    // server Supabase buat validasi token-nya masih sah. Kalau dua-duanya
    // beda hasil, itu petunjuk penting.
    const userResult = await sb.auth.getUser();
    logEntry(userResult.error ? 'ERROR' : 'OK', 'balikan getUser (tervalidasi server)', userResult);
  } catch (networkErr) {
    logEntry('ERROR', 'EXCEPTION saat getSession/getUser', {
      message: networkErr.message,
      name: networkErr.name,
      stack: networkErr.stack,
    });
  }
  setButtonsDisabled(false);
}

// ---------- LOGOUT ----------
async function handleLogout() {
  if (!sb || !sb.auth) { logEntry('ERROR', 'handleLogout dibatalkan', diagnoseMissingClient()); return; }
  logEntry('INFO', 'mengirim request signOut', {});
  setButtonsDisabled(true);
  try {
    const result = await sb.auth.signOut();
    logEntry(result.error ? 'ERROR' : 'OK', 'balikan signOut', result);
  } catch (networkErr) {
    logEntry('ERROR', 'EXCEPTION saat signOut', {
      message: networkErr.message,
      name: networkErr.name,
      stack: networkErr.stack,
    });
  }
  setButtonsDisabled(false);
}

// Kasih tau kenapa client gak kebentuk, bedain "belum diisi config" vs
// "SDK CDN gak ke-load" (biasanya karena file://) — dua-duanya kelihatan
// sama dari luar (tombol gak jalan) tapi solusinya beda total.
function diagnoseMissingClient() {
  if (OPENED_VIA_FILE_PROTOCOL) {
    return 'Halaman dibuka via file:// — script CDN Supabase kemungkinan diblokir browser. ' +
      'Jalankan lewat local server (contoh: Live Server di VS Code, atau `python -m http.server`), ' +
      'jangan double-click file-nya langsung.';
  }
  if (typeof window.supabaseSdk === 'undefined' || !window.supabaseSdk?.createClient) {
    return 'SDK Supabase dari CDN gak ke-load (window.supabase kosong/undefined). ' +
      'Cek tab Network di DevTools — apakah request ke cdn.jsdelivr.net/npm/@supabase/supabase-js gagal?';
  }
  return 'Client belum configured — isi SUPABASE_URL & SUPABASE_ANON_KEY di loginsupabase.js dulu, lalu refresh halaman.';
}

// Nangkep auth state change event (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
// PASSWORD_RECOVERY, dst) — kadang masalahnya bukan di call awal, tapi di
// event yang nembak belakangan / gak nembak sama sekali.
if (typeof sb !== 'undefined' && sb && sb.auth) {
  sb.auth.onAuthStateChange((event, session) => {
    logEntry('INFO', `onAuthStateChange event: ${event}`, { event, session });
  });
}

refreshClientStatus();