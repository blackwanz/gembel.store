// assets/apps.config.js
//
// Registry of first-party apps shown as tiles on dashboard.html. Adding a
// new app = write its db/migrations/000N_<app>.sql (see db/README.md),
// build its page reusing the shared boilerplate (supabaseClient.js +
// auth.js + requireAuth()), then add one entry here. Removing one = flip
// enabled:false or delete the entry -- the page file itself can stay on
// disk untouched either way.
//
// This does NOT cover the separate "generate me a custom app" ticket
// system (app_requests table, rendered by loadRequests()/renderTicket() in
// dashboard.html) -- that's a different, unrelated flow.
window.GEMBEL_APPS = [
  {
    id: 'calendar',
    name: 'Kalender Produktivitas',
    desc: 'App bawaan lo — goals harian, tracking angka, dan progress bulanan. Selalu aktif, gratis buat semua member.',
    icon: '📅',
    url: 'calendar.html',
    enabled: true,
  },
  {
    id: 'habbit',
    name: 'Aktivitas & Pengeluaran',
    desc: 'Lacak aktivitas harian dan duit masuk/keluar, plus target bulanan, budget planner, dan laporan savings rate.',
    icon: '💸',
    url: 'habbit.html',
    enabled: true,
  },
  {
    id: 'progbar',
    name: 'Neon Flow — Time Tracker',
    desc: 'Progress tracker gaya cyberpunk — lacak sesi kerja lo per warna (fokus/istirahat/lainnya) sampai target waktu harian. Data tersimpan di akun lo.',
    icon: '⚡',
    url: 'progbar.html',
    enabled: true,
  },
  {
    id: 'focus',
    name: 'Focus Dashboard',
    desc: 'Kanban tugas, timeline harian, goals jangka panjang, dan focus timer — semuanya dalam satu workspace.',
    icon: '🎯',
    url: 'focus.html',
    enabled: true,
  },
  {
    id: 'ketik-buku',
    name: 'Ketik Buku',
    desc: 'Latihan mengetik pake buku/PDF/teks yang lo import sendiri — perpustakaan pribadi, kosakata tersimpan, statistik WPM & akurasi.',
    icon: '📖',
    url: 'ketik-buku.html',
    enabled: true,
  },
  {
    id: 'save-files',
    name: 'Save File',
    desc: 'Upload file apa aja (maks 50MB) — semua member yang login bisa lihat & download, lo cuma bisa hapus punya lo sendiri.',
    icon: '📤',
    url: 'save%20file/index.html',
    enabled: true,
  },
  {
    id: 'masak',
    name: 'Stok Dapur',
    desc: 'Lacak stok bahan dapur & tanggal basinya biar gak ada yang kebuang. Bisa dipakai bareng orang lain per dapur (kos, rumah) lewat kode undangan.',
    icon: '🥬',
    url: 'masak.html',
    enabled: true,
  },
  {
    id: 'archery',
    name: 'Stargazer Archery',
    desc: 'Log latihan panahan — catat sesi, setup panah/busur per anak panah (sayap, rotasi), titik incar, dan statistik akurasi. Data tersimpan di akun lo.',
    icon: '🏹',
    url: 'archery.html',
    enabled: true,
  },
  {
    id: 'drawer',
    name: 'Recall Drawer',
    desc: 'Card-catalog buat apa aja yang worth di-inget — quick capture, tag, cari lewat command palette (Ctrl+K). Data tersimpan di akun lo.',
    icon: '🗂️',
    url: 'drawer.html',
    enabled: true,
  },
  // These three are real projects still being built -- the tile is here so they're visible on the
  // roadmap, but clicking through lands on coming-soon.html (a shared "under construction" scene)
  // instead of a real app. See coming-soon.html's own comment for how the ?app=/?domain=/?icon=
  // query params drive it.
  {
    id: 'mokondo',
    name: 'Mokondo.com',
    desc: 'Masih dikerjain — belum live. Tile ini nunjukin progress-nya di dashboard.',
    icon: '🛠️',
    url: 'coming-soon.html?app=Mokondo&domain=mokondo.com&icon=%F0%9F%9B%A0%EF%B8%8F',
    enabled: true,
  },
  {
    id: 'yourlegacy',
    name: 'YourLegacy.com',
    desc: 'Masih dikerjain — belum live. Tile ini nunjukin progress-nya di dashboard.',
    icon: '🏛️',
    url: 'coming-soon.html?app=YourLegacy&domain=yourlegacy.com&icon=%F0%9F%8F%9B%EF%B8%8F',
    enabled: true,
  },
  {
    id: 'bitworks',
    name: 'Bitworks.com',
    desc: 'Masih dikerjain — belum live. Tile ini nunjukin progress-nya di dashboard.',
    icon: '⚙️',
    url: 'coming-soon.html?app=Bitworks&domain=bitworks.com&icon=%E2%9A%99%EF%B8%8F',
    enabled: true,
  },
];
