// assets/payment-qr.js
//
// Adds a static QRIS fallback to the payment modal (openPaymentModal, lives
// in auth.js) without touching auth.js itself -- that file is a minified
// production build, and the only readable copy in git history references
// an older table/column schema (payment_request/user_profiles) that no
// longer matches the live one (payment_requests/profiles), so hand-editing
// it blind was too risky. This works from the outside instead: it watches
// for #pay-waiting (the "menunggu konfirmasi" panel) to appear, waits 5s,
// then drops the QR image into it as another way to actually pay right now
// -- there's no live payment gateway wired in, confirmation is manual via
// admin.html, so this doesn't replace anything, just adds an option.

(function () {
  let pending = false;

  function tryInject() {
    const waiting = document.getElementById('pay-waiting');
    if (!waiting || waiting.style.display === 'none') { pending = false; return; }
    if (pending || document.getElementById('pay-qr-fallback')) return;
    pending = true;

    setTimeout(() => {
      pending = false;
      const w = document.getElementById('pay-waiting');
      if (!w || w.style.display === 'none' || document.getElementById('pay-qr-fallback')) return;

      const box = document.createElement('div');
      box.id = 'pay-qr-fallback';
      box.style.cssText = 'margin-top:18px;padding-top:18px;border-top:1px dashed var(--border);text-align:center;';
      box.innerHTML = `
        <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">Atau scan QRIS ini buat bayar sekarang:</p>
        <img src="assets/payment-qr.png" alt="QRIS Gembel.id" style="max-width:220px;width:100%;border-radius:12px;border:1px solid var(--border);">
        <p style="font-size:11.5px;color:var(--text-faint);margin-top:8px;">Setelah bayar, tunggu admin konfirmasi (biasanya &lt;5 menit).</p>
      `;
      w.appendChild(box);
    }, 5000);
  }

  const observer = new MutationObserver(tryInject);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
})();
