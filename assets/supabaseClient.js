/* ============================================================
   SUPABASE CONNECTION + KONFIGURASI PEMBAYARAN
   ============================================================ */

(function () {
  const SUPABASE_URL = "https://cejmhfyyiftjsgtyzmvt.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_-VtjJUw4-6bpmTH4bKXdgQ_dVaPTMQ5";

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.supabase = client;
})();

/* ---- PEMBAYARAN ----
   Nanti kalau Xendit lo udah siap, tinggal isi link invoice/payment lo di sini.
   Kosong = tombol bayar langsung masuk mode "menunggu konfirmasi admin". */
window.GEMBEL_PAYMENT_URL = "";
window.GEMBEL_PRICE = 19999;           // harga sekarang (IDR / bulan)
window.GEMBEL_PRICE_NORMAL = 1000000;  // harga "normal" buat banner diskon