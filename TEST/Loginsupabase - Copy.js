// ===== loginsupabase.js =====
// Init client Supabase KHUSUS buat file testing login.html/login.js.
// Sengaja dipisah dari assets/supabaseClient.js (yang dipakai index.html /
// dashboard.html production) supaya:
//   1. Gak ketuker / gak sengaja ubah config yang lagi jalan di production.
//   2. Gampang di-swap credentials-nya pas lagi ngetes tanpa takut ngerusak apa2.
//
// ⚠️ ISI DULU 2 NILAI DI BAWAH SEBELUM DIPAKAI ⚠️
// Ambil dari: Supabase Dashboard -> Project Settings -> API
//   - "Project URL"      -> SUPABASE_URL
//   - "anon public" key  -> SUPABASE_ANON_KEY  (JANGAN pakai service_role key!)

const SUPABASE_URL = 
const SUPABASE_ANON_KEY =


// Guard biar ketauan dari awal kalau lupa isi placeholder di atas —
// daripada dapet error samar dari network call yang gagal nyambung.
const CONFIG_LOOKS_UNSET =
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_URL.includes("ISI_URL_SUPABASE") ||
  SUPABASE_ANON_KEY.includes("ISI_ANON_KEY_SUPABASE");

if (CONFIG_LOOKS_UNSET) {
  console.error(
    "[loginsupabase.js] SUPABASE_URL / SUPABASE_ANON_KEY masih placeholder. " +
    "Edit file ini dulu, isi dengan Project URL + anon public key dari " +
    "Supabase Dashboard -> Project Settings -> API sebelum test login."
  );
}

// PENTING soal penamaan — ini akar bug "Cannot read properties of
// undefined (reading 'signUp')" yang sempat kejadian:
// Script CDN (<script src="...supabase-js@2...">) nempelin SDK-nya ke
// `window.supabase` sebagai NAMESPACE, isinya cuma { createClient, ... } —
// itu BUKAN client yang siap dipakai buat .auth.signUp/.signInWithPassword.
// Kalau kita bikin variabel top-level bernama sama persis (`const supabase
// = ...`), itu otomatis nimpa `window.supabase` juga (karena var global di
// script biasa nempel ke window) — jadi gampang ketuker mana yang namespace
// SDK, mana yang client hasil createClient(). Buat ngindarin itu total,
// namespace SDK dipanggil eksplisit lewat `window.supabaseSdk` (di-set di
// bawah), dan client hasil createClient() dikasih nama BEDA: `sb`.
window.supabaseSdk = window.supabase; // simpan referensi SDK sebelum ketiban

const sb = CONFIG_LOOKS_UNSET
  ? null
  : window.supabaseSdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Diexpose ke window juga biar gampang dicolek dari DevTools Console kalau
// mau ngetes manual, misal: await sb.auth.getSession()
window.sb = sb;

// Info ini muncul di panel log login.html juga (lewat login.js), tapi
// dobel-log ke console di sini supaya keliatan dari awal load halaman,
// sebelum user sempat klik tombol apa pun.
console.log("[loginsupabase.js] client status:", {
  sdkLoaded: typeof window.supabaseSdk !== "undefined" && !!window.supabaseSdk?.createClient,
  configured: !CONFIG_LOOKS_UNSET,
  clientCreated: !!sb,
  clientHasAuth: !!sb?.auth,
  url: CONFIG_LOOKS_UNSET ? "(belum diisi)" : SUPABASE_URL,
  anonKeyLength: CONFIG_LOOKS_UNSET ? 0 : SUPABASE_ANON_KEY.length,
});

if (typeof window.supabaseSdk === "undefined" || !window.supabaseSdk?.createClient) {
  console.error(
    "[loginsupabase.js] SDK Supabase (window.supabase dari CDN script) tidak " +
    "ketemu / tidak lengkap. Ini BEDA dari soal placeholder belum diisi. " +
    "Penyebab paling umum: halaman dibuka langsung dari file:// (double-click " +
    "di File Explorer) sehingga browser MEMBLOKIR script CDN eksternal karena " +
    "kebijakan keamanan file lokal. Solusinya: jalankan lewat local server, " +
    "BUKAN buka file-nya langsung. Cara paling gampang di Windows: install " +
    "extension 'Live Server' di VS Code, klik kanan login.html -> " +
    "'Open with Live Server'. Atau via terminal: 'python -m http.server 5500' " +
    "di folder ini, lalu buka http://localhost:5500/login.html di browser."
  );
}