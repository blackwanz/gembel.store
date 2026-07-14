// ============================================================
// HABBIT — rendering functionality (classic-script build).
// Load AFTER habbit.utils.js. Every value from the database goes
// through escapeHtml() before touching innerHTML — main XSS
// defense line, don't bypass it.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};
  const { escapeHtml, initials, fmtClock, fmtDurationSecs, fmtRupiah, fmtRelativeTime } = window.Habbit.utils;

  function fmtTimeOfDay(t) {
    return t ? String(t).slice(0, 5) : '…';
  }

  function updateWhoBadge(name) {
    document.getElementById('who-badge').textContent = initials(name);
    document.getElementById('who-name').textContent = name;
  }

  function renderRunning(rows) {
    const box = document.getElementById('running-list');
    if (rows.length === 0) {
      box.innerHTML = '<div class="empty">Belum ada aktivitas yang lagi jalan.</div>';
      return;
    }
    box.innerHTML = rows.map(r => {
      const elapsed = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000);
      return `
      <div class="run-item" data-id="${escapeHtml(r.id)}" data-start="${escapeHtml(r.created_at)}">
        <div class="run-dot-wrap"><span class="pulse-dot"></span></div>
        <div class="run-body">
          <div class="run-activity" title="${escapeHtml(r.activity)}">${escapeHtml(r.activity)}</div>
          <div class="run-time">mulai ${escapeHtml(fmtClock(r.created_at))}</div>
          <div class="stop-form" data-stop-form-for="${escapeHtml(r.id)}">
            <input type="text" inputmode="numeric" class="stop-qty" placeholder="10" maxlength="6">
            <input type="text" class="stop-unit" placeholder="Repetisi" maxlength="40">
            <button class="btn-stop-confirm" data-confirm-stop-id="${escapeHtml(r.id)}">✓ Selesai</button>
            <button class="btn-link-cancel" data-cancel-stop-id="${escapeHtml(r.id)}">Batal</button>
          </div>
        </div>
        <div style="text-align:right;">
          <div class="run-elapsed mono" data-elapsed>${fmtDurationSecs(elapsed)}</div>
          <button class="btn btn-stop" style="margin-top:6px;" data-stop-id="${escapeHtml(r.id)}">■ Stop</button>
        </div>
      </div>`;
    }).join('');
  }

  function showStopForm(id) {
    const form = document.querySelector(`[data-stop-form-for="${CSS.escape(id)}"]`);
    const item = form && form.closest('.run-item');
    if (form) form.classList.add('show');
    if (item) { const b = item.querySelector('[data-stop-id]'); if (b) b.classList.add('hidden-btn'); }
    const qtyInput = form && form.querySelector('.stop-qty');
    if (qtyInput) qtyInput.focus();
  }
  function hideStopForm(id) {
    const form = document.querySelector(`[data-stop-form-for="${CSS.escape(id)}"]`);
    const item = form && form.closest('.run-item');
    if (form) form.classList.remove('show');
    if (item) { const b = item.querySelector('[data-stop-id]'); if (b) b.classList.remove('hidden-btn'); }
  }
  function readStopForm(id) {
    const form = document.querySelector(`[data-stop-form-for="${CSS.escape(id)}"]`);
    if (!form) return { qty: null, unit: null };
    const qtyRaw = (form.querySelector('.stop-qty').value || '').trim();
    const unitRaw = (form.querySelector('.stop-unit').value || '').trim();
    return { qty: qtyRaw || null, unit: unitRaw || null };
  }

  function tickRunning() {
    document.querySelectorAll('.run-item').forEach(el => {
      const start = new Date(el.dataset.start).getTime();
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const out = el.querySelector('[data-elapsed]');
      if (out) out.textContent = fmtDurationSecs(elapsed);
    });
  }

  function setHistRangeChips(range) {
    document.querySelectorAll('#hist-filter .chip-filter').forEach(c =>
      c.classList.toggle('active', c.dataset.range === range));
  }

  function setPeriodPickerVisibility(periodType) {
    document.getElementById('period-day').style.display = periodType === 'day' ? '' : 'none';
    document.getElementById('period-month').style.display = periodType === 'month' ? '' : 'none';
    document.getElementById('period-year').style.display = periodType === 'year' ? '' : 'none';
  }

  function setHistTypeButtons(type) {
    document.querySelectorAll('#hist-type-switch .type-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.type === type));
  }

  function renderHistory(rows) {
    const box = document.getElementById('history-list');
    if (rows.length === 0) {
      box.innerHTML = '<div class="empty">Belum ada riwayat di rentang ini.</div>';
      return;
    }
    box.innerHTML = rows.map(r => {
      if (r.finance_flag) {
        return `
        <div class="hist-row">
          <span class="type-pill finance">${escapeHtml((r.finance_tag || 'KELUAR DUIT').toUpperCase())}</span>
          <div class="hist-main">
            <div class="hist-title">${escapeHtml(r.activity)}</div>
            <div class="hist-sub">${escapeHtml(fmtRelativeTime(r.created_at))}</div>
          </div>
          <div class="hist-value spend">${fmtRupiah(r.nominal)}</div>
        </div>`;
      }
      return `
      <div class="hist-row">
        <span class="type-pill drilling">AKTIVITAS</span>
        <div class="hist-main">
          <div class="hist-title">${escapeHtml(r.activity)}</div>
          <div class="hist-sub">${fmtTimeOfDay(r.time_start)} – ${fmtTimeOfDay(r.time_end)} · ${escapeHtml(fmtRelativeTime(r.created_at))}</div>
        </div>
        <div style="text-align:right;">
          <div class="hist-value dur">${fmtDurationSecs(r.total_second || 0)}</div>
          ${r.qty != null && r.qty !== '' ? `<span class="hist-qty">${escapeHtml(r.qty)} ${escapeHtml(r.qty_unit || '')}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function toggleFinanceFields(checked) {
    document.getElementById('finance-fields').classList.toggle('show', checked);
    const btn = document.getElementById('submit-btn');
    btn.textContent = checked ? '💸 Gas, Catat!' : '🚀 Gas, Mulai!';
    btn.classList.toggle('btn-finance', checked);
    btn.classList.toggle('btn-primary', !checked);
  }

  function resetActivityForm() {
    document.getElementById('in-activity').value = '';
    document.getElementById('in-amount').value = '';
    document.getElementById('in-tag').value = '';
    document.getElementById('in-finance').checked = false;
    toggleFinanceFields(false);
  }

  window.Habbit.ui = {
    updateWhoBadge, renderRunning, tickRunning, renderHistory,
    setHistRangeChips, toggleFinanceFields, resetActivityForm,
    showStopForm, hideStopForm, readStopForm,
    setPeriodPickerVisibility, setHistTypeButtons,
  };
})();
