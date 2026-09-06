// assets/payment-saweria.js
//
// Makes the payment flow auto-confirm via Saweria instead of always needing a manual admin
// click. Two things, both done from the outside (same reason payment-qr.js does: auth.js is
// string-array-obfuscated, not just minified, so its openPaymentModal internals can't be
// hand-edited safely):
//
// 1. Patches supabase.from('payment_requests').insert(...) to append a random 0-999 "unique
//    code" onto whatever amount auth.js was about to insert (base_amount stays the real tier
//    price). This is what lets services/saweria-listener match an incoming Saweria donation
//    (which only reports an amount, no user id) back to the one request that has it -- see
//    db/migrations/0018_payment_unique_code.sql for the full rationale. The mutation happens
//    synchronously in place, so the builder auth.js gets back is still the real
//    PostgrestFilterBuilder (chainable/awaitable exactly as before) -- not a wrapping Promise.
// 2. Once the modal reaches its #pay-waiting panel, injects the exact amount to transfer (the
//    QRIS image is a static amount-less picture, so without this the user has no way to know
//    they need to type 20.348 instead of 19.999) plus a live countdown, and subscribes to
//    Realtime on that one row so the modal reacts the moment the listener (or an admin)
//    confirms/rejects it -- there's no other client-side code watching payment_requests today.

(function () {
  if (!window.supabase || typeof window.supabase.from !== 'function') return;

  const CODE_MIN = 0;
  const CODE_MAX = 999;
  const EXPIRES_MS = 15 * 60 * 1000;

  let lastInserted = null; // { amount, base_amount, unique_code, expires_at } for the UI panel below

  // ---- Part 1: append the unique code before the insert goes out ----
  const originalFrom = window.supabase.from.bind(window.supabase);
  window.supabase.from = function (table) {
    const builder = originalFrom(table);
    if (table !== 'payment_requests' || typeof builder.insert !== 'function') return builder;

    const originalInsert = builder.insert.bind(builder);
    builder.insert = function (rows, options) {
      const isArray = Array.isArray(rows);
      const list = isArray ? rows.map((r) => ({ ...r })) : [{ ...rows }];

      list.forEach((row) => {
        if (row == null || row.amount == null || row.unique_code != null) return; // already has one, or nothing to base a code on
        const base = Number(row.amount);
        const code = CODE_MIN + Math.floor(Math.random() * (CODE_MAX - CODE_MIN + 1));
        row.base_amount = base;
        row.amount = base + code;
        row.unique_code = code;
        row.expires_at = new Date(Date.now() + EXPIRES_MS).toISOString();
        lastInserted = { amount: row.amount, base_amount: base, unique_code: code, expires_at: row.expires_at };
      });

      return originalInsert(isArray ? list : list[0], options);
    };
    return builder;
  };

  // ---- Part 2: show the exact amount + live status in the #pay-waiting panel ----
  function formatRupiah(n) {
    return 'Rp ' + Number(n).toLocaleString('id-ID');
  }

  function buildAmountBox(info) {
    const box = document.createElement('div');
    box.id = 'pay-saweria-amount';
    box.style.cssText = 'margin:14px 0;padding:14px;border-radius:12px;background:var(--surface-2,rgba(127,127,127,.08));text-align:center;';
    box.innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 6px;">Transfer TEPAT segini biar konfirmasi otomatis (jangan dibulatkan):</p>
      <div style="font-size:22px;font-weight:800;letter-spacing:.3px;" id="pay-saweria-amount-value">${formatRupiah(info.amount)}</div>
      <button type="button" id="pay-saweria-copy-btn" style="margin-top:8px;font-size:11.5px;background:none;border:1px solid var(--border);border-radius:8px;padding:4px 10px;cursor:pointer;color:inherit;">📋 Salin nominal</button>
      <p style="font-size:11px;color:var(--text-faint);margin:8px 0 0;">Kode unik <strong>${info.unique_code}</strong> ditambahin ke harga asli ${formatRupiah(info.base_amount)} biar sistem tau ini tagihan lo. Berlaku <span id="pay-saweria-countdown">15:00</span> lagi.</p>
      <p id="pay-saweria-status" style="font-size:12px;margin:10px 0 0;color:var(--text-muted);">⏳ Nunggu donasi masuk ke Saweria...</p>
    `;
    const copyBtn = box.querySelector('#pay-saweria-copy-btn');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(info.amount));
        copyBtn.textContent = '✅ Disalin';
        setTimeout(() => { copyBtn.textContent = '📋 Salin nominal'; }, 1500);
      } catch (_) { /* clipboard permission denied -- not critical, user can still read the number */ }
    });
    return box;
  }

  function startCountdown(box, expiresAtIso) {
    const el = box.querySelector('#pay-saweria-countdown');
    const statusEl = box.querySelector('#pay-saweria-status');
    if (!el) return;
    const expiresAt = new Date(expiresAtIso).getTime();
    const tick = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        el.textContent = '0:00';
        if (statusEl) statusEl.textContent = '⌛ Kode kadaluarsa -- tutup dan buka lagi buat kode baru.';
        clearInterval(timer);
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      el.textContent = mins + ':' + String(secs).padStart(2, '0');
    };
    tick();
    const timer = setInterval(tick, 1000);
  }

  function watchRowStatus(box, amount) {
    const statusEl = box.querySelector('#pay-saweria-status');
    if (!statusEl) return;
    const channel = window.supabase
      .channel('pay-saweria-' + amount)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_requests', filter: `amount=eq.${amount}` },
        (payload) => {
          const status = payload.new && payload.new.status;
          if (status === 'confirmed') {
            statusEl.textContent = '✅ Pembayaran ketemu! Ngupgrade akun lo...';
            statusEl.style.color = 'var(--success, #22c55e)';
            setTimeout(() => location.reload(), 1500);
            window.supabase.removeChannel(channel);
          } else if (status === 'rejected' || status === 'expired') {
            statusEl.textContent = status === 'expired' ? '⌛ Kadaluarsa, buka ulang buat kode baru.' : '❌ Ditolak admin.';
            window.supabase.removeChannel(channel);
          }
        }
      )
      .subscribe();
  }

  let pending = false;
  function tryInjectAmount() {
    const waiting = document.getElementById('pay-waiting');
    if (!waiting || waiting.style.display === 'none') { pending = false; return; }
    if (pending || document.getElementById('pay-saweria-amount') || !lastInserted) return;
    pending = true;

    const info = lastInserted;
    lastInserted = null; // one-shot: don't re-attach to a later, unrelated waiting panel
    const box = buildAmountBox(info);
    waiting.insertBefore(box, waiting.firstChild);
    startCountdown(box, info.expires_at);
    watchRowStatus(box, info.amount);
    pending = false;
  }

  const observer = new MutationObserver(tryInjectAmount);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
})();
