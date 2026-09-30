// assets/payment-qr.js
//
// Adds a static QRIS fallback to the payment modal (openPaymentModal, lives
// in auth.js) without touching auth.js itself -- that file is a minified
// production build, and the only readable copy in git history references
// an older table/column schema (payment_request/user_profiles) that no
// longer matches the live one (payment_requests/profiles), so hand-editing
// it blind was too risky. This works from the outside instead, two ways:
//
// 1. Once a payment request was created successfully and the modal is
//    showing #pay-waiting ("menunggu konfirmasi"), add a "atau bayar manual
//    pakai QRIS" link. It stays hidden-behind-a-click on purpose -- the
//    panel already shows the auto-detected exact amount from
//    payment-saweria.js, and popping the QRIS image up on a timer read as
//    if two competing payment methods were both live at once. Clicking it
//    opens the QRIS as its OWN separate popup (stacked on top of the main
//    payment modal, own overlay/close button) rather than appended inline
//    into the same card -- the combined card was getting too tall with
//    both flows' content stacked in one scroll.
// 2. If creating the payment request itself fails (auth.js reports this via
//    a plain alert(), e.g. "Gagal bikin tagihan: ..." -- happened for real
//    when public.payment_requests didn't exist yet, see db/migrations/
//    0016_payment_requests.sql), the modal never reaches #pay-waiting at
//    all -- the user was left with just a dismissed alert and a dead end.
//    That alert is intercepted here and, for payment failures specifically,
//    swapped for the same popup instead, so "the automated flow broke"
//    still ends in "here's how to pay anyway" rather than a wall.
//
// There's no live payment gateway wired in either way -- confirmation is
// always manual via admin.html -- so neither path replaces anything, just
// adds an option for whenever the automated one isn't working.

(function () {
  // wa.me wants digits only (no +/spaces/dashes) -- the source value in site-config.js can be
  // in whatever format's convenient to edit, this just normalizes it at build time.
  function buildWhatsAppUrl() {
    const raw = (window.SITE_CONFIG && window.SITE_CONFIG.whatsappAdminNumber) || '';
    const digits = raw.replace(/[^0-9]/g, '');
    const text = encodeURIComponent('Halo Gembel Master, saya baru aja transfer buat upgrade Elite Tier. Mohon dikonfirmasi ya 🙏');
    return digits ? `https://wa.me/${digits}?text=${text}` : '';
  }

  // Own overlay/card, separate from #pay-modal entirely -- stacked on top of it (higher
  // z-index) so the main modal stays exactly as tall as the auto-Saweria flow needs, and this
  // pops open only when the user actually asks for the manual option.
  function openQrPopup(note) {
    const existing = document.getElementById('pay-qr-popup');
    if (existing) existing.remove();

    const waUrl = buildWhatsAppUrl();
    const overlay = document.createElement('div');
    overlay.id = 'pay-qr-popup';
    overlay.className = 'pay-overlay';
    overlay.style.zIndex = '1001';
    overlay.innerHTML = `
      <div class="pay-card" style="max-width:340px;">
        <div class="pay-body" style="text-align:center;position:relative;">
          <button type="button" id="pay-qr-close-btn" aria-label="Tutup" style="position:absolute;top:8px;right:10px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted);">✕</button>
          <h3 style="margin-bottom:10px;">Bayar Manual (QRIS)</h3>
          <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">${note}</p>
          <img src="assets/payment-qr.png" alt="QRIS Gembel.id" style="max-width:220px;width:100%;border-radius:12px;border:1px solid var(--border);">
          <p style="font-size:11.5px;color:var(--text-faint);margin:8px 0 14px;">Setelah bayar, admin bakal konfirmasi manual (bisa sampai 1x24 jam).</p>
          <button type="button" class="btn btn-primary btn-block" id="pay-qr-done-btn" style="margin-bottom:8px;">✅ Selesai Transfer</button>
          ${waUrl ? `<a class="btn btn-ghost btn-block" href="${waUrl}" target="_blank" rel="noopener">📱 Notif Gembel Master (WhatsApp)</a>` : ''}
        </div>
      </div>
    `;

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#pay-qr-close-btn').addEventListener('click', close);

    const doneBtn = overlay.querySelector('#pay-qr-done-btn');
    doneBtn.addEventListener('click', () => {
      doneBtn.disabled = true;
      close();
      openPendingThanks(waUrl);
    });

    document.body.appendChild(overlay);
  }

  // Thank-you popup after "Selesai Transfer" -- same look as payment-saweria.js's confirmed
  // popup (shared .pay-thanks CSS in app-theme.css), but a ticking clock instead of a check and
  // no confetti, since nothing is confirmed yet: an admin still has to approve it in admin.html.
  function openPendingThanks(waUrl) {
    const existing = document.getElementById('pay-thanks');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pay-thanks';
    overlay.className = 'pay-overlay pay-thanks';
    overlay.innerHTML = `
      <div class="pay-card" role="dialog" aria-modal="true" aria-labelledby="pay-thanks-title">
        <div class="pay-thanks-hero pending">
          <svg class="pay-thanks-clock" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36"/><line class="hr" x1="40" y1="40" x2="40" y2="26"/><line class="min" x1="40" y1="40" x2="40" y2="17"/></svg>
          <h3 id="pay-thanks-title">Makasih udah transfer! 🙏</h3>
          <p>Pembayaran lo lagi dicek sama admin.</p>
        </div>
        <div class="pay-thanks-body">
          <div class="pay-thanks-receipt">
            <span>Metode</span><b>QRIS (manual)</b>
            <span>Status</span><b><span class="pay-thanks-status">MENUNGGU ADMIN</span></b>
            <span>Estimasi</span><b>maks. 1×24 jam</b>
          </div>
          <ul class="pay-thanks-steps">
            <li class="done" style="animation-delay:.2s"><span class="dot">✓</span><span><b>Transfer QRIS</b> — beres</span></li>
            <li class="on" style="animation-delay:.35s"><span class="dot">2</span><span><b>Admin cek mutasi</b> — lagi diproses</span></li>
            <li style="animation-delay:.5s"><span class="dot">3</span><span><b>Elite aktif</b> — otomatis kebuka abis dikonfirmasi</span></li>
          </ul>
          ${waUrl ? `<a class="btn btn-ghost btn-block" href="${waUrl}" target="_blank" rel="noopener" style="margin-bottom:8px;">📱 Biar cepet, chat admin (WA)</a>` : ''}
          <button type="button" class="btn btn-primary btn-block" id="pay-thanks-ok">Oke, ditunggu ya</button>
        </div>
      </div>`;

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#pay-thanks-ok').addEventListener('click', close);
    document.body.appendChild(overlay);
  }

  // ---- Path 1: waiting-for-confirmation panel ----
  // No auto-timer here on purpose -- QRIS only shows up if the user actively asks for the
  // manual option, since it's a static amount-less image and mixing it in automatically was
  // confusing next to the auto-detected exact-amount flow in payment-saweria.js.
  let pending = false;
  function tryInjectIntoWaiting() {
    const waiting = document.getElementById('pay-waiting');
    if (!waiting || waiting.style.display === 'none') { pending = false; return; }
    if (pending || document.getElementById('pay-qr-manual-btn')) return;
    pending = true;

    // Own labelled section, same look as payment-saweria.js's "Payment otomatis via SAWERIA"
    // box, so members can tell the two ways to pay apart.
    const section = document.createElement('div');
    section.className = 'pay-qr-alt';
    section.innerHTML = `
      <div class="pay-qr-alt-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>
        <span>Payment manual via <span style="color:var(--text-main);font-weight:800;letter-spacing:.3px;">QRIS</span></span>
      </div>
      <p style="font-size:11px;color:var(--text-faint);margin:0 0 10px;">Scan QRIS, terus admin konfirmasi manual (bisa agak lama).</p>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pay-qr-manual-btn';
    btn.className = 'btn btn-ghost btn-block';
    btn.textContent = 'Buka QRIS';
    btn.addEventListener('click', () => openQrPopup('Bayar manual pake QRIS ini ya:'));
    section.appendChild(btn);
    waiting.appendChild(section);
  }

  const observer = new MutationObserver(tryInjectIntoWaiting);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

  // ---- Path 2: the payment-request creation call itself failed ----
  // auth.js reports this with a plain alert() carrying "tagihan" (the
  // Indonesian word this app uses for a payment request/invoice) in the
  // message -- matched loosely on that word rather than the full sentence
  // so this keeps working even if the exact wording around it changes.
  const realAlert = window.alert.bind(window);
  window.alert = function (message) {
    const modal = document.getElementById('pay-modal');
    const isPaymentCreateFailure = typeof message === 'string' && /tagihan/i.test(message)
      && modal && getComputedStyle(modal).display !== 'none';
    if (!isPaymentCreateFailure) { realAlert(message); return; }

    console.warn('[payment-qr] payment request creation failed, showing QR popup instead of blocking alert:', message);
    openQrPopup('Pembuatan tagihan otomatis lagi bermasalah — bisa bayar manual dulu pake QRIS ini, admin bakal konfirmasi manual:');
  };
})();
