# 🔧 Paket Debug Login & Dashboard — gembel.store

## Akar masalahnya ketemu (dari repo asli lo)

| # | Bug | Akibat | Status |
|---|---|---|---|
| 1 | **`assets/dashboard.js` isinya HALAMAN HTML utuh, bukan JavaScript** (kecopy keliru) | Browser parse sebagai JS → `SyntaxError: Unexpected token '<'` → `switchTab`, `submitRequest`, `saveProfile`, `loadRequests` **tidak pernah ada** → dashboard mati total, tombol diam semua. Inilah jawaban "gue gak tau JS-nya kepanggil dari mana" — file-nya kepanggil, tapi langsung mati di baris 1. | ✅ Dibenerin: JS asli diekstrak dari dalam HTML itu |
| 2 | **`assets/dashboard.css` tidak pernah ada** padahal `dashboard.html` me-request-nya | 404 diam-diam tiap load (style dashboard sebenarnya semua ada di `app-theme.css`) | ✅ Referensinya dihapus dari dashboard.html |
| 3 | **`TEST/Login.html` manggil `loginsupabase.js` & `login.js`** (huruf kecil) padahal file aslinya `Loginsupabase.js` & `Login.js` | Di Windows jalan (case-insensitive), begitu naik ke hosting Linux → 404 | ✅ Referensi disamakan persis |
| 4 | File `Loginsupabase - Copy.js` berisi `const SUPABASE_URL =` kosong (syntax error) | Cuma file copy — tidak dipakai. Versi aslinya (`TEST/Loginsupabase.js`) sudah terisi benar | ℹ️ Boleh dihapus biar gak nyesatin |

Catatan: `index.html` + `assets/auth.js` + `index.js` **wiring-nya sudah benar semua** — kalau login masih bermasalah, itu urusan balasan Supabase (kredensial, konfirmasi email, rate limit, dst.) dan halaman debug di bawah ini yang bakal nunjukin persisnya.

## File di paket ini

| File | Apa | Taruh di mana |
|---|---|---|
| **debug-login.html** | ⭐ Replika alur auth lo (login/signup/OTP/reset, ID elemen sama persis) + log lengkap: request & response mentah, error.code, console, syntax error file lain, decode JWT, storage, pelacak script | root project (sejajar index.html) |
| **debug-dashboard.html** | Debug pasca-login: gate session (persis `requireAuth`), ambil `user_profiles` & `app_request` (sudah di-set sesuai schema.sql lo), diagnosa RLS, query bebas | root project |
| **dashboard.js** | Pengganti `assets/dashboard.js` (JS asli, diekstrak dari HTML yang nyangkut) | `assets/dashboard.js` |
| **dashboard.html** | dashboard.html lo minus referensi CSS yang gak ada | root project |
| **TEST-Login.html** | TEST/Login.html dengan nama script case-exact | rename jadi `TEST/Login.html` |

(Kalau gue commit langsung ke folder lo, semua sudah di tempatnya — repo lo git, jadi `git diff` buat review, `git checkout -- <file>` buat batalin.)

## Cara pakai debug page (5 menit)

1. Jalankan local server di folder project (jangan double-click file):
   `python -m http.server 5500` → buka `http://localhost:5500/debug-login.html`
   (atau VS Code → Live Server)
2. Isi **Project URL** + **anon key** di kartu kiri atas → **Simpan & buat client**. (Nempel di localStorage browser — gak perlu edit file, gak bisa syntax error.)
3. Klik aksi apa pun → baca panel kanan:
   **Log** (semua kejadian, `error.code` di-highlight) · **Network** (request/response mentah + decode JWT) · **Script & Function** (load `assets/auth.js` dkk. → lihat function apa yang muncul; cek file mana ada di mana; peta function tombol) · **Storage** (token session + expired-check) · **Peta & Bantuan** (tabel arti error, peta file repo lo, contoh SQL cek policy).
4. Mau ngetes kode produksi lo beneran? Tab Script → load `assets/supabaseClient.js` lalu `assets/auth.js` lalu `index.js` → ganti dropdown **handler** (kanan atas) ke **Produksi** → tombol form sekarang manggil `handleLogin()` PUNYA LO, semua request tetap kecatat.
5. Login beres tapi data aneh? → `debug-dashboard.html` (session gate + RLS + query).

## Kirim log kalau mau dibantu

Tab Log → **⧉ salin semua** → paste ke chat. Password & token otomatis disamarkan (toggle "tampilkan rahasia" kalau perlu buka).
