// ============================================================
// HABBIT — rendering. Reads plain data in, writes DOM out.
// No Supabase calls live here — see habbit.api.js for those.
// ============================================================
import { escapeHtml, initials, fmtClock, fmtDurationSecs, fmtRupiah, fmtRelativeTime } from '../../assets/shared-utils.js';

/** "14:30:00" (Postgres `time`) -> "14:30". Not a real Date, so no `new Date()` parsing. */
function fmtTimeOfDay(t) {
  return t ? String(t).slice(0, 5) : '…';
}

export function updateWhoBadge(name) {
  document.getElementById('who-badge').textContent = initials(name);
  document.getElementById('who-name').textContent = name;
}

export function renderRunning(rows) {
  const box = document.getElementById('running-list');
  if (rows.length === 0) {
    box.innerHTML = `<div class="empty">Belum ada aktivitas yang lagi jalan.</div>`;
    return;
  }
  // habbit_h rows are always plain timed activities — expenses are
  // recorded straight into habbit_d (see recordExpense in
  // habbit.api.js) and never show up here, so no finance styling
  // is needed on this card.
  box.innerHTML = rows.map(r => {
    const elapsed = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000);
    return `
    <div class="run-item" data-id="${escapeHtml(r.id)}" data-start="${escapeHtml(r.created_at)}">
      <div class="run-dot-wrap"><span class="pulse-dot"></span></div>
      <div class="run-body">
        <div class="run-activity" title="${escapeHtml(r.activity)}">${escapeHtml(r.activity)}</div>
        <div class="run-time">mulai ${escapeHtml(fmtClock(r.created_at))}</div>
      </div>
      <div style="text-align:right;">
        <div class="run-elapsed mono" data-elapsed>${fmtDurationSecs(elapsed)}</div>
        <button class="btn btn-stop" style="margin-top:6px;" data-stop-id="${escapeHtml(r.id)}">■ Stop</button>
      </div>
    </div>`;
  }).join('');
}

/** Called every second by the controller's tick interval. */
export function tickRunning() {
  document.querySelectorAll('.run-item').forEach(el => {
    const start = new Date(el.dataset.start).getTime();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const out = el.querySelector('[data-elapsed]');
    if (out) out.textContent = fmtDurationSecs(elapsed);
  });
}

export function setHistRangeChips(range) {
  document.querySelectorAll('#hist-filter .chip-filter').forEach(c =>
    c.classList.toggle('active', c.dataset.range === range));
}

export function renderHistory(rows) {
  const box = document.getElementById('history-list');
  if (rows.length === 0) {
    box.innerHTML = `<div class="empty">Belum ada riwayat di rentang ini.</div>`;
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
      <div class="hist-value dur">${fmtDurationSecs(r.total_second || 0)}</div>
    </div>`;
  }).join('');
}

export function toggleFinanceFields(checked) {
  document.getElementById('finance-fields').classList.toggle('show', checked);
  const btn = document.getElementById('submit-btn');
  btn.textContent = checked ? '💸 Gas, Catat!' : '🚀 Gas, Mulai!';
  btn.classList.toggle('btn-finance', checked);
  btn.classList.toggle('btn-primary', !checked);
}

export function resetActivityForm() {
  document.getElementById('in-activity').value = '';
  document.getElementById('in-amount').value = '';
  document.getElementById('in-tag').value = '';
  document.getElementById('in-finance').checked = false;
  toggleFinanceFields(false);
}
