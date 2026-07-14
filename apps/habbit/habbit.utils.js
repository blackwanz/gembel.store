// ============================================================
// HABBIT — shared helper functionality (classic-script build).
// Same content as the ES-module version, just exposed on
// window.Habbit.utils instead of using export/import — so this
// can be opened straight from disk (file://) with no server and
// no build step. Load this file FIRST in the HTML.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function toTimeOfDay(date) {
    const p = n => String(n).padStart(2, '0');
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }
  function toDateOnly(date) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    const out = parts.map(w => (w[0] ? w[0].toUpperCase() : '')).join('');
    return out || '?';
  }
  function fmtClock(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '…';
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDurationSecs(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }
  function fmtRupiah(nominal) {
    const num = Number(nominal) || 0;
    return 'Rp' + num.toLocaleString('id-ID');
  }
  function fmtRelativeTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} jam lalu`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} hari lalu`;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function createStore(initialState) {
    let state = Object.assign({}, initialState);
    const listeners = new Set();
    return {
      getState: () => state,
      setState(patch) {
        state = Object.assign({}, state, patch);
        listeners.forEach(fn => fn(state));
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }

  let toastTimer = null;
  function showToast(message, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('err', type === 'err');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setFieldInvalid(fieldId, invalid) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.classList.toggle('invalid', invalid);
    const err = el.querySelector('.err-text');
    if (err) err.classList.toggle('show', invalid);
  }

  async function withBusy(btn, busyLabel, fn) {
    if (!btn) return fn();
    const originalLabel = btn.textContent;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    btn.textContent = busyLabel;
    try {
      return await fn();
    } finally {
      btn.disabled = wasDisabled;
      btn.textContent = originalLabel;
    }
  }

  window.Habbit.utils = {
    escapeHtml, newId, toTimeOfDay, toDateOnly, initials,
    fmtClock, fmtDurationSecs, fmtRupiah, fmtRelativeTime,
    createStore, showToast, setFieldInvalid, withBusy,
  };
})();
