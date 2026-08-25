// assets/popup.js
//
// Shared in-app popup component: gembelAlert()/gembelConfirm()/gembelPrompt()
// replace the native alert()/confirm()/prompt() dialogs across every page --
// those can't be styled, look inconsistent per-browser, and block the whole
// tab. Self-contained (injects its own CSS/markup) so it works the same way
// regardless of which page's own stylesheet is loaded alongside it.
//
// All three return Promises, so call sites need `await` where they used to
// call the native, synchronous versions directly.

(function () {
  if (window.gembelAlert) return; // already loaded on this page

  const STYLE = `
    .gembel-popup-overlay {
      display: none; position: fixed; inset: 0; z-index: 2000;
      background: rgba(10, 14, 25, 0.6); backdrop-filter: blur(3px);
      align-items: center; justify-content: center; padding: 20px;
    }
    .gembel-popup-overlay.show { display: flex; }
    .gembel-popup-card {
      width: 100%; max-width: 380px; background: #ffffff; color: #1f2430;
      border-radius: 16px; padding: 22px; box-shadow: 0 20px 50px rgba(0,0,0,0.35);
      font-family: 'Inter', 'Segoe UI', sans-serif;
      animation: gembelPopupPop 0.22s cubic-bezier(0.22,1,0.36,1);
    }
    @media (prefers-color-scheme: dark) {
      .gembel-popup-card { background: #1c2130; color: #eef0f6; }
    }
    @keyframes gembelPopupPop { from { transform: translateY(14px) scale(0.97); opacity: 0; } }
    .gembel-popup-message { font-size: 14px; line-height: 1.55; white-space: pre-wrap; margin-bottom: 16px; }
    .gembel-popup-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #d7dbe4; font-size: 14px; margin-bottom: 16px; box-sizing: border-box; font-family: inherit; }
    @media (prefers-color-scheme: dark) {
      .gembel-popup-input { background: #262c40; border-color: #3a4258; color: #eef0f6; }
    }
    .gembel-popup-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .gembel-popup-btn { padding: 9px 16px; border-radius: 8px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .gembel-popup-btn.primary { background: #4f7cff; color: #fff; }
    .gembel-popup-btn.primary:hover { background: #3f68e0; }
    .gembel-popup-btn.ghost { background: #eef0f6; color: #1f2430; }
    .gembel-popup-btn.ghost:hover { background: #e0e4ee; }
    @media (prefers-color-scheme: dark) {
      .gembel-popup-btn.ghost { background: #2a3145; color: #eef0f6; }
      .gembel-popup-btn.ghost:hover { background: #343c54; }
    }
  `;

  function ensureOverlay() {
    let overlay = document.getElementById('gembel-popup-overlay');
    if (overlay) return overlay;

    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    overlay = document.createElement('div');
    overlay.id = 'gembel-popup-overlay';
    overlay.className = 'gembel-popup-overlay';
    overlay.innerHTML = `
      <div class="gembel-popup-card">
        <div class="gembel-popup-message" id="gembel-popup-message"></div>
        <input type="text" class="gembel-popup-input" id="gembel-popup-input" style="display:none;">
        <div class="gembel-popup-actions" id="gembel-popup-actions"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });
    return overlay;
  }

  function closePopup() {
    const overlay = document.getElementById('gembel-popup-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  function makeBtn(label, kind) {
    const btn = document.createElement('button');
    btn.className = 'gembel-popup-btn ' + kind;
    btn.textContent = label;
    return btn;
  }

  window.gembelAlert = function (message) {
    return new Promise(resolve => {
      const overlay = ensureOverlay();
      document.getElementById('gembel-popup-message').textContent = message;
      document.getElementById('gembel-popup-input').style.display = 'none';
      const actions = document.getElementById('gembel-popup-actions');
      actions.innerHTML = '';
      const okBtn = makeBtn('OK', 'primary');
      okBtn.onclick = () => { closePopup(); resolve(); };
      actions.appendChild(okBtn);
      overlay.classList.add('show');
      const onKey = e => { if (e.key === 'Enter' || e.key === 'Escape') { document.removeEventListener('keydown', onKey); okBtn.click(); } };
      document.addEventListener('keydown', onKey);
      setTimeout(() => okBtn.focus(), 20);
    });
  };

  window.gembelConfirm = function (message) {
    return new Promise(resolve => {
      const overlay = ensureOverlay();
      document.getElementById('gembel-popup-message').textContent = message;
      document.getElementById('gembel-popup-input').style.display = 'none';
      const actions = document.getElementById('gembel-popup-actions');
      actions.innerHTML = '';
      const cancelBtn = makeBtn('Batal', 'ghost');
      const okBtn = makeBtn('Ya', 'primary');
      let settled = false;
      const finish = val => { if (settled) return; settled = true; document.removeEventListener('keydown', onKey); closePopup(); resolve(val); };
      cancelBtn.onclick = () => finish(false);
      okBtn.onclick = () => finish(true);
      const onKey = e => { if (e.key === 'Escape') finish(false); if (e.key === 'Enter') finish(true); };
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      overlay.classList.add('show');
      document.addEventListener('keydown', onKey);
      setTimeout(() => okBtn.focus(), 20);
    });
  };

  window.gembelPrompt = function (message, defaultValue) {
    return new Promise(resolve => {
      const overlay = ensureOverlay();
      document.getElementById('gembel-popup-message').textContent = message;
      const input = document.getElementById('gembel-popup-input');
      input.style.display = 'block';
      input.value = defaultValue || '';
      const actions = document.getElementById('gembel-popup-actions');
      actions.innerHTML = '';
      const cancelBtn = makeBtn('Batal', 'ghost');
      const okBtn = makeBtn('OK', 'primary');
      let settled = false;
      const finish = val => { if (settled) return; settled = true; input.removeEventListener('keydown', onKey); closePopup(); resolve(val); };
      cancelBtn.onclick = () => finish(null);
      okBtn.onclick = () => finish(input.value);
      const onKey = e => { if (e.key === 'Enter') finish(input.value); if (e.key === 'Escape') finish(null); };
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      overlay.classList.add('show');
      input.addEventListener('keydown', onKey);
      setTimeout(() => input.focus(), 20);
    });
  };
})();
