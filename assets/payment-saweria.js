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
  const SUDAH_BAYAR_GATE_MS = 60 * 1000;
  const PROCESSING_AFTER_MS = 30 * 1000;
  const STUCK_AFTER_MS = 60 * 1000;
  const SAWERIA_USERNAME = 'irwanKNTL';

  let lastInserted = null; // { amount, base_amount, unique_code, expires_at, months } for the UI panel below

  // ---- Part 0: month picker ----
  // auth.js's modal is fixed at one month. This injects a picker into its .pay-body so a member
  // can pay any number of months (up to 10 years) in one go; the chosen count is applied to the
  // insert in Part 1 (amount = price x months, plus a `months` column). The DB caps `months` at
  // what the amount actually covers (db/migrations/0047_payment_months_and_prize_income.sql), so
  // this is UX, not a trust boundary.
  const PRICE_PER_MONTH = Number(window.SITE_CONFIG && window.SITE_CONFIG.elitePricePerMonth) || 19999;
  const MONTH_CHOICES = [1, 3, 6, 12, 24];
  const MAX_MONTHS = 120;
  let selectedMonths = 1;

  function monthsLabel(m) {
    if (m % 12 === 0) return (m / 12) + ' tahun';
    return m + ' bulan';
  }

  function applyMonthsToModal(modal) {
    const total = PRICE_PER_MONTH * selectedMonths;
    const newPrice = modal.querySelector('.pay-price .new');
    const per = modal.querySelector('.pay-price .per');
    const goBtn = modal.querySelector('#pay-go');
    const oldPrice = modal.querySelector('.pay-price .old');
    if (oldPrice) {
      // auth.js's struck-through "normal price" is per month; scale it with the pick so the promo
      // comparison stays apples to apples.
      if (!oldPrice.dataset.perMonth) oldPrice.dataset.perMonth = String(Number(oldPrice.textContent.replace(/[^0-9]/g, '')) || 0);
      const perMonthOld = Number(oldPrice.dataset.perMonth);
      if (perMonthOld) oldPrice.textContent = formatRupiah(perMonthOld * selectedMonths);
    }
    if (newPrice) newPrice.textContent = formatRupiah(total);
    if (per) per.textContent = '/ ' + monthsLabel(selectedMonths);
    if (goBtn) goBtn.textContent = 'Bayar ' + formatRupiah(total) + ' →';
    modal.querySelectorAll('[data-pay-months]').forEach((b) => {
      const on = Number(b.dataset.payMonths) === selectedMonths;
      b.style.background = on ? 'var(--accent, #6366f1)' : 'transparent';
      b.style.color = on ? '#fff' : 'inherit';
      b.style.borderColor = on ? 'transparent' : 'var(--border)';
    });
    const custom = modal.querySelector('#pay-months-custom');
    if (custom && document.activeElement !== custom) custom.value = selectedMonths;
    const note = modal.querySelector('#pay-months-note');
    if (note) note.textContent = selectedMonths > 1
      ? `${formatRupiah(PRICE_PER_MONTH)} × ${selectedMonths} bulan · Elite ${selectedMonths * 30} hari · +${(selectedMonths).toLocaleString('id-ID')} juta poin`
      : 'Bisa bayar sekaligus buat beberapa bulan / tahun ke depan.';
  }

  function injectMonthPicker() {
    const modal = document.getElementById('pay-modal');
    if (!modal || modal.querySelector('#pay-months')) return;
    const price = modal.querySelector('.pay-price');
    if (!price) return;
    selectedMonths = 1;
    const wrap = document.createElement('div');
    wrap.id = 'pay-months';
    wrap.style.cssText = 'margin:12px 0 14px;';
    const chipCss = 'padding:6px 10px;border:1px solid var(--border);border-radius:999px;background:transparent;color:inherit;font-size:12.5px;font-weight:700;cursor:pointer;';
    wrap.innerHTML = `
      <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Mau bayar berapa lama?</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        ${MONTH_CHOICES.map((m) => `<button type="button" data-pay-months="${m}" style="${chipCss}">${monthsLabel(m)}</button>`).join('')}
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;">
          <input type="number" id="pay-months-custom" min="1" max="${MAX_MONTHS}" value="1" style="width:64px;padding:5px 6px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;"> bulan
        </label>
      </div>
      <div id="pay-months-note" style="font-size:11px;color:var(--text-faint);margin-top:6px;"></div>
    `;
    price.insertAdjacentElement('afterend', wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pay-months]');
      if (!b) return;
      selectedMonths = Number(b.dataset.payMonths);
      applyMonthsToModal(modal);
    });
    wrap.querySelector('#pay-months-custom').addEventListener('input', (e) => {
      const n = Math.floor(Number(e.target.value));
      if (!n || n < 1) return;
      selectedMonths = Math.min(MAX_MONTHS, n);
      applyMonthsToModal(modal);
    });
    applyMonthsToModal(modal);
  }

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
        // auth.js always sends its own one-month price; the picker (Part 0) decides the real total.
        const months = Math.max(1, Math.min(MAX_MONTHS, selectedMonths || 1));
        const base = PRICE_PER_MONTH * months;
        const code = CODE_MIN + Math.floor(Math.random() * (CODE_MAX - CODE_MIN + 1));
        row.base_amount = base;
        row.amount = base + code;
        row.unique_code = code;
        row.months = months;
        row.expires_at = new Date(Date.now() + EXPIRES_MS).toISOString();
        lastInserted = { amount: row.amount, base_amount: base, unique_code: code, expires_at: row.expires_at, months };
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

  // Lights up the 1-2-3 strip in the Saweria box: steps before `n` are done, `n` is current.
  function setStep(box, n) {
    box.querySelectorAll('.pay-sw-step').forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle('done', s < n);
      el.classList.toggle('on', s === n);
    });
  }

  function buildAmountBox(info) {
    const box = document.createElement('div');
    box.id = 'pay-saweria-amount';
    box.className = 'pay-sw';
    box.innerHTML = `
      <div class="pay-sw-inner">
        <button type="button" id="pay-saweria-cancel-btn" class="pay-sw-cancel" title="Batalkan" aria-label="Batalkan">✕</button>
        <div class="pay-sw-head">
          <span class="pay-sw-logo" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg></span>
          <span class="pay-sw-title">Payment otomatis via <span class="brand">SAWERIA</span><br><span style="white-space:nowrap;">a.n. <strong>${SAWERIA_USERNAME.toUpperCase()}</strong></span></span>
          <span class="pay-sw-auto">AUTO</span>
        </div>
        <div class="pay-sw-steps" aria-hidden="true">
          <div class="pay-sw-step on" data-step="1"><span class="ic">📋</span>Salin<br>nominal</div>
          <span class="pay-sw-link"></span>
          <div class="pay-sw-step" data-step="2"><span class="ic">💸</span>Bayar di<br>Saweria</div>
          <span class="pay-sw-link"></span>
          <div class="pay-sw-step" data-step="3"><span class="ic">👑</span>Elite aktif<br>otomatis</div>
        </div>
        <div class="pay-sw-amount-label">Transfer persis</div>
        <div class="pay-sw-amount-row">
          <span class="pay-sw-amount">${formatRupiah(info.amount)}</span>
          <button type="button" id="pay-saweria-copy-btn" class="pay-sw-copy" title="Salin nominal">Salin</button>
        </div>
        <p class="pay-sw-note">Jangan dibulatkan -- kode unik <strong>${info.unique_code}</strong> ditambahin ke harga asli ${formatRupiah(info.base_amount)} biar sistem tau ini tagihan lo${info.months > 1 ? ` (Elite ${monthsLabel(info.months)})` : ''}.</p>
        <div class="pay-sw-timer" id="pay-saweria-timer"><span>⏱ <span id="pay-saweria-countdown">15:00</span></span><span class="pay-sw-bar"><i id="pay-saweria-bar"></i></span></div>
        <a href="https://saweria.co/${SAWERIA_USERNAME}" target="_blank" rel="noopener" id="pay-saweria-bayar-btn" class="pay-sw-go">Bayar di Saweria →</a>
        <button type="button" id="pay-saweria-sudah-btn" class="btn btn-ghost btn-block" style="margin-top:8px;display:none;" disabled></button>
        <p id="pay-saweria-status" class="pay-sw-status" style="display:none;">⏳ Nunggu donasi masuk ke Saweria...</p>
      </div>
    `;
    const copyBtn = box.querySelector('#pay-saweria-copy-btn');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(info.amount));
        copyBtn.textContent = '✓ Tersalin';
        copyBtn.classList.add('ok');
        setStep(box, 2);
        setTimeout(() => { copyBtn.textContent = 'Salin'; copyBtn.classList.remove('ok'); }, 1500);
      } catch (_) { /* clipboard permission denied -- not critical, user can still read the number */ }
    });
    return box;
  }

  // Wires the "Bayar" -> "Saya sudah Bayar" -> reveal handoff. The waiting/confirmation UI (both
  // the native #pay-waiting spinner+text and our own status line) stays hidden until the user
  // has actually clicked through to Saweria and back -- showing "menunggu konfirmasi" before
  // they've even paid was confusing next to a big unclicked "Bayar" button. The 60s gate on
  // "Saya sudah Bayar" is just enough time to fill in Saweria's own form and come back; it isn't
  // a real payment check, just stops an instant reflex click before they've actually done it.
  function wireBayarHandoff(box, onProceed) {
    const bayarBtn = box.querySelector('#pay-saweria-bayar-btn');
    const sudahBtn = box.querySelector('#pay-saweria-sudah-btn');
    let armed = false;

    bayarBtn.addEventListener('click', () => {
      if (armed) return;
      armed = true;
      setStep(box, 2);
      sudahBtn.style.display = 'block';
      sudahBtn.disabled = true;
      let remaining = SUDAH_BAYAR_GATE_MS / 1000;
      sudahBtn.textContent = `Tunggu ${remaining}s...`;
      const tick = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(tick);
          sudahBtn.disabled = false;
          sudahBtn.textContent = '✅ Saya sudah Bayar';
        } else {
          sudahBtn.textContent = `Tunggu ${remaining}s...`;
        }
      }, 1000);
    });

    sudahBtn.addEventListener('click', () => {
      if (sudahBtn.disabled) return;
      sudahBtn.remove();
      setStep(box, 3);
      onProceed();
    });
  }

  function startCountdown(box, expiresAtIso) {
    const el = box.querySelector('#pay-saweria-countdown');
    const statusEl = box.querySelector('#pay-saweria-status');
    const bar = box.querySelector('#pay-saweria-bar');
    const timerRow = box.querySelector('#pay-saweria-timer');
    if (!el) return () => {};
    const expiresAt = new Date(expiresAtIso).getTime();
    const tick = () => {
      const remaining = expiresAt - Date.now();
      if (bar) bar.style.width = Math.max(0, Math.min(100, (remaining / EXPIRES_MS) * 100)) + '%';
      if (timerRow) timerRow.classList.toggle('low', remaining < 2 * 60 * 1000);
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
    return () => clearInterval(timer);
  }

  // window.PAYMENT_CONTEXT is set inline by index.html ('register') and dashboard.html ('home')
  // right before this script loads -- it's what decides whether we let the user into the app
  // early (register) or make them sit and wait (home, where they're already in).
  //
  // Subscribes to the row right away (a confirmation can land before the user ever clicks
  // through "Saya sudah Bayar" -- e.g. Saweria matches the donation fast), but the 30s
  // "processing" / 60s "stuck" timers below only make sense to count once the user says they've
  // actually gone and paid, so those are armed later via the returned `reveal()`.
  // ---- Part 3: thank-you popup once the payment is confirmed ----
  // Replaces the old "status text, then reload after 1.5s" -- a paid member now gets a proper
  // moment (animated check, confetti, receipt) and moves on when they click, not on a timer.
  function burstConfetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#f5a623', '#ff6a88', '#7a5cff', '#4f7cff', '#4cd98a', '#ffcf5c'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.className = 'pay-confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      c.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      c.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      c.style.animationDelay = (Math.random() * 0.5) + 's';
      if (i % 3 === 0) { c.style.width = '7px'; c.style.height = '7px'; c.style.borderRadius = '50%'; }
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 5000);
    }
  }

  function showThankYou(info, onDone) {
    const existing = document.getElementById('pay-thanks');
    if (existing) existing.remove();
    const until = new Date(Date.now() + info.months * 30 * 86400000)
      .toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const overlay = document.createElement('div');
    overlay.id = 'pay-thanks';
    overlay.className = 'pay-overlay pay-thanks';
    overlay.innerHTML = `
      <div class="pay-card" role="dialog" aria-modal="true" aria-labelledby="pay-thanks-title">
        <div class="pay-thanks-hero">
          <svg class="pay-thanks-check" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36"/><path d="M24 41l11 11 22-24"/></svg>
          <span class="pay-thanks-crown" aria-hidden="true">👑</span>
          <h3 id="pay-thanks-title">Makasih, bro! 🙏</h3>
          <p>Pembayaran lo udah masuk. Selamat, lo resmi <b>Elite</b>!</p>
        </div>
        <div class="pay-thanks-body">
          <div class="pay-thanks-receipt">
            <span>Dibayar</span><b>${formatRupiah(info.amount)}</b>
            <span>Paket</span><b>Elite ${monthsLabel(info.months)}</b>
            <span>Aktif sampai</span><b>± ${until}</b>
          </div>
          <ul class="pay-thanks-perks">
            <li style="animation-delay:1.1s">✨ Semua fitur Elite udah kebuka</li>
            <li style="animation-delay:1.25s">🎁 Bonus poin langsung masuk ke akun</li>
            <li style="animation-delay:1.4s">💬 Ada kendala? Chat Gembel Master aja</li>
          </ul>
          <button type="button" class="btn btn-primary btn-block" id="pay-thanks-go">Gas, masuk →</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    burstConfetti();
    const payModal = document.getElementById('pay-modal');
    if (payModal) payModal.style.display = 'none';
    const goBtn = overlay.querySelector('#pay-thanks-go');
    goBtn.addEventListener('click', () => { goBtn.disabled = true; onDone(); });
  }

  function watchRowStatus(box, info) {
    const amount = info.amount;
    const statusEl = box.querySelector('#pay-saweria-status');
    if (!statusEl) return { reveal() {}, cleanup() {} };

    const context = window.PAYMENT_CONTEXT === 'register' ? 'register' : 'home';
    function proceedToApp() {
      if (context === 'register' && typeof window.routeAfterLogin === 'function') window.routeAfterLogin();
      else location.reload();
    }

    let settled = false;
    let processingTimer = null;
    let stuckTimer = null;

    function reveal() {
      statusEl.style.display = 'block';
      if (settled) return; // already confirmed/rejected/expired before the user clicked through
      processingTimer = setTimeout(() => {
        statusEl.textContent = '🔄 Pembayaran sedang diproses...';
        if (context === 'register') {
          settled = true;
          window.supabase.removeChannel(channel);
          proceedToApp();
        }
      }, PROCESSING_AFTER_MS);

      // Only relevant for someone already in the dashboard waiting on the modal -- a minute
      // total with no confirmation and we assume the automated match failed, point them at admin.
      if (context === 'home') {
        stuckTimer = setTimeout(() => {
          const waUrl = buildAdminWaUrl('Halo Gembel Master, saya udah transfer tapi belum ke-konfirmasi otomatis. Mohon dicek ya 🙏');
          statusEl.innerHTML = '❌ Belum ke-konfirmasi otomatis.' +
            (waUrl ? ` <a href="${waUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Notify Gembel Master (WhatsApp)</a>` : '');
        }, STUCK_AFTER_MS);
      }
    }

    function handleStatus(status) {
      if (settled || (status !== 'confirmed' && status !== 'rejected' && status !== 'expired')) return;
      settled = true;
      if (processingTimer) clearTimeout(processingTimer);
      if (stuckTimer) clearTimeout(stuckTimer);
      if (pollTimer) clearInterval(pollTimer);
      window.supabase.removeChannel(channel);
      statusEl.style.display = 'block';
      if (status === 'confirmed') {
        statusEl.textContent = '✅ Pembayaran sukses! Ngupgrade akun lo...';
        statusEl.style.color = 'var(--success-text, #22c55e)';
        setStep(box, 4);
        showThankYou(info, proceedToApp);
      } else {
        statusEl.textContent = status === 'expired' ? '⌛ Kadaluarsa, buka ulang buat kode baru.' : '❌ Ditolak admin.';
      }
    }

    const channel = window.supabase
      .channel('pay-saweria-' + amount)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_requests', filter: `amount=eq.${amount}` },
        (payload) => handleStatus(payload.new && payload.new.status)
      )
      .subscribe();

    // Realtime depends on the table being in the supabase_realtime publication and on the
    // websocket staying connected -- both have failed silently before (a confirmed payment sat
    // showing "diproses" forever because payment_requests was never added to the publication,
    // see db/migrations/0019_payment_requests_realtime.sql). A plain poll every few seconds as a
    // backstop means a future gap like that can't strand a real payment again.
    const pollTimer = setInterval(async () => {
      if (settled) { clearInterval(pollTimer); return; }
      const { data } = await window.supabase
        .from('payment_requests')
        .select('status')
        .eq('amount', amount)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) handleStatus(data.status);
    }, 5000);

    // Used by the "✕ Batalkan" button -- stops every timer/subscription this function started
    // without touching the payment_requests row itself (it's just left 'pending' and expires on
    // its own via expires_at, same as closing the tab would've left it).
    function cleanup() {
      settled = true; // blocks a stray in-flight postgres_changes/poll response from reviving the UI
      if (processingTimer) clearTimeout(processingTimer);
      if (stuckTimer) clearTimeout(stuckTimer);
      clearInterval(pollTimer);
      window.supabase.removeChannel(channel);
    }

    return { reveal, cleanup };
  }

  let pending = false;
  function tryInjectAmount() {
    const waiting = document.getElementById('pay-waiting');
    if (!waiting || waiting.style.display === 'none') { pending = false; return; }
    if (pending || document.getElementById('pay-saweria-amount') || !lastInserted) return;
    pending = true;

    const info = lastInserted;
    lastInserted = null; // one-shot: don't re-attach to a later, unrelated waiting panel

    // Snapshot auth.js's own native children (spinner, "Menunggu konfirmasi..." heading/text,
    // its own 05:00 countdown) before we add anything, and hide them -- they don't make sense
    // to show until the user has actually clicked through "Bayar" and confirmed they paid.
    // #pay-later is auth.js's own "keep using Free" fallback button, left alone entirely.
    const nativeChildren = Array.from(waiting.children).filter((el) => el.id !== 'pay-later');
    const nativeDisplay = nativeChildren.map((el) => el.style.display);
    nativeChildren.forEach((el) => { el.style.display = 'none'; });

    const box = buildAmountBox(info);
    waiting.insertBefore(box, waiting.firstChild);
    const stopCountdown = startCountdown(box, info.expires_at);
    const { reveal, cleanup } = watchRowStatus(box, info);

    wireBayarHandoff(box, () => {
      nativeChildren.forEach((el, i) => { el.style.display = nativeDisplay[i]; });
      reveal();
    });

    // "✕ Batalkan" -- stops every timer/subscription this panel started and closes the whole
    // payment modal, same end state as auth.js's own "Nanti dulu, pakai Free" button (#pay-skip)
    // produces before a payment request even exists: #pay-modal fully removed from the DOM.
    box.querySelector('#pay-saweria-cancel-btn').addEventListener('click', () => {
      stopCountdown();
      cleanup();
      const modal = document.getElementById('pay-modal');
      if (modal) modal.remove();
    });

    pending = false;
  }

  const observer = new MutationObserver(() => { injectMonthPicker(); tryInjectAmount(); });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
})();
