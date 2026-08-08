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
];
