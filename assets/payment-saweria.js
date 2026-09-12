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
  const PROCESSING_AFTER_MS = 30 * 1000;
  const STUCK_AFTER_MS = 60 * 1000;
  const SAWERIA_USERNAME = 'irwanKNTL';

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

  // Shared with payment-qr.js's own copy of this logic -- kept duplicated rather than factored
  // out since each file is meant to stand alone (see the file-header comments in both).
  function buildAdminWaUrl(text) {
    const raw = (window.SITE_CONFIG && window.SITE_CONFIG.whatsappAdminNumber) || '';
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : '';
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
      <a href="https://saweria.co/${SAWERIA_USERNAME}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;font-size:11.5px;text-decoration:underline;color:inherit;">↗️ Buka Saweria langsung</a>
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

  // window.PAYMENT_CONTEXT is set inline by index.html ('register') and dashboard.html ('home')
  // right before this script loads -- it's what decides whether we let the user into the app
  // early (register) or make them sit and wait (home, where they're already in).
  function watchRowStatus(box, amount) {
    const statusEl = box.querySelector('#pay-saweria-status');
    if (!statusEl) return;

    const context = window.PAYMENT_CONTEXT === 'register' ? 'register' : 'home';
    function proceedToApp() {
      if (context === 'register' && typeof window.routeAfterLogin === 'function') window.routeAfterLogin();
      else location.reload();
    }

    let channel = null;

    // 30s with no confirmation: tell the user it's still working. For a fresh registration
    // there's nothing for them to do in this modal anyway, so let them into the app now --
    // the row keeps confirming in the background via services/saweria-listener and their
    // tier will just be there next time it's checked. Someone already inside (dashboard)
    // stays put and keeps watching.
    const processingTimer = setTimeout(() => {
      statusEl.textContent = '🔄 Pembayaran sedang diproses...';
      if (context === 'register') {
        if (channel) window.supabase.removeChannel(channel);
        proceedToApp();
      }
    }, PROCESSING_AFTER_MS);

    // Only relevant for someone already in the dashboard waiting on the modal -- a minute total
    // with no confirmation and we assume the automated match failed, point them at the admin.
    const stuckTimer = context === 'home' ? setTimeout(() => {
      const waUrl = buildAdminWaUrl('Halo Gembel Master, saya udah transfer tapi belum ke-konfirmasi otomatis. Mohon dicek ya 🙏');
      statusEl.innerHTML = '❌ Belum ke-konfirmasi otomatis.' +
        (waUrl ? ` <a href="${waUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Notify Gembel Master (WhatsApp)</a>` : '');
    }, STUCK_AFTER_MS) : null;

    channel = window.supabase
      .channel('pay-saweria-' + amount)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_requests', filter: `amount=eq.${amount}` },
        (payload) => {
          const status = payload.new && payload.new.status;
          if (status === 'confirmed') {
            clearTimeout(processingTimer);
            if (stuckTimer) clearTimeout(stuckTimer);
            statusEl.textContent = '✅ Pembayaran sukses! Ngupgrade akun lo...';
            statusEl.style.color = 'var(--success, #22c55e)';
            setTimeout(proceedToApp, 1500);
            window.supabase.removeChannel(channel);
          } else if (status === 'rejected' || status === 'expired') {
            clearTimeout(processingTimer);
            if (stuckTimer) clearTimeout(stuckTimer);
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
