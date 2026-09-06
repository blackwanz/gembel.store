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
//    showing #pay-waiting ("menunggu konfirmasi"), wait 5s then drop the QR
//    into it as another way to actually pay right now.
// 2. If creating the payment request itself fails (auth.js reports this via
//    a plain alert(), e.g. "Gagal bikin tagihan: ..." -- happened for real
//    when public.payment_requests didn't exist yet, see db/migrations/
//    0016_payment_requests.sql), the modal never reaches #pay-waiting at
//    all -- the user was left with just a dismissed alert and a dead end.
//    That alert is intercepted here and, for payment failures specifically,
//    swapped for the same QR fallback injected straight into the still-open
//    form instead, so "the automated flow broke" still ends in "here's how
//    to pay anyway" rather than a wall.
//
// There's no live payment gateway wired in either way -- confirmation is
// always manual via admin.html -- so neither path replaces anything, just
// adds an option for whenever the automated one isn't working.

(function () {
  function buildQrBox(note) {
    const box = document.createElement('div');
    box.id = 'pay-qr-fallback';
    box.style.cssText = 'margin-top:18px;padding-top:18px;border-top:1px dashed var(--border);text-align:center;';
    box.innerHTML = `
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">${note}</p>
      <img src="assets/payment-qr.png" alt="QRIS Gembel.id" style="max-width:220px;width:100%;border-radius:12px;border:1px solid var(--border);">
      <p style="font-size:11.5px;color:var(--text-faint);margin-top:8px;">Setelah bayar, tunggu admin konfirmasi (biasanya &lt;5 menit).</p>
    `;
    return box;
  }

  // ---- Path 1: waiting-for-confirmation panel, same as before ----
  let pending = false;
  function tryInjectIntoWaiting() {
    const waiting = document.getElementById('pay-waiting');
    if (!waiting || waiting.style.display === 'none') { pending = false; return; }
    if (pending || document.getElementById('pay-qr-fallback')) return;
    pending = true;

    setTimeout(() => {
      pending = false;
      const w = document.getElementById('pay-waiting');
      if (!w || w.style.display === 'none' || document.getElementById('pay-qr-fallback')) return;
      w.appendChild(buildQrBox('Atau scan QRIS ini buat bayar sekarang:'));
    }, 5000);
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
    const body = modal && modal.querySelector('.pay-body');
    const isPaymentCreateFailure = typeof message === 'string' && /tagihan/i.test(message)
      && modal && getComputedStyle(modal).display !== 'none' && body;
    if (!isPaymentCreateFailure) { realAlert(message); return; }

    console.warn('[payment-qr] payment request creation failed, showing QR fallback instead of blocking alert:', message);
    const existing = body.querySelector('#pay-qr-fallback');
    if (existing) existing.remove();
    body.appendChild(buildQrBox('Pembuatan tagihan otomatis lagi bermasalah — bisa bayar manual dulu pake QRIS ini, admin bakal konfirmasi manual:'));
  };
})();
