let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let RUNNING = [];       // my own 'berjalan' rows
let HISTORY_ALL = [];   // my own completed rows (fetched once, filtered client-side)
let HIST_RANGE = '24h';
let tickHandle = null;

/* ---------------- helpers ---------------- */
function showToast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function fmtRupiah(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtDurationSecs(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* ---------------- form validation ---------------- */
function setInvalid(fieldId, invalid) {
  document.getElementById(fieldId).classList.toggle('invalid', invalid);
  const err = document.querySelector('#' + fieldId + ' .err-text');
  if (err) err.classList.toggle('show', invalid);
}

function toggleFinance(checked) {
  document.getElementById('finance-fields').classList.toggle('show', checked);
  const btn = document.getElementById('submit-btn');
  btn.textContent = checked ? '💸 Gas, Catat!' : '🚀 Gas, Mulai!';
  btn.classList.toggle('btn-finance', checked);
  btn.classList.toggle('btn-primary', !checked);
}

document.getElementById('in-activity').addEventListener('input', function () {
  setInvalid('f-activity', false);
});
document.getElementById('in-amount').addEventListener('input', function () {
  this.value = this.value.replace(/[^\d]/g, ''); // digits only, defense in depth
  setInvalid('f-amount', false);
});

async function handleSubmit() {
  const activity = document.getElementById('in-activity').value.trim();
  const isFinance = document.getElementById('in-finance').checked;
  const amountRaw = document.getElementById('in-amount').value.trim();

  let ok = true;
  if (activity.length < 3) { setInvalid('f-activity', true); ok = false; }

  if (isFinance) {
    const amount = Number(amountRaw);
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) { setInvalid('f-amount', true); ok = false; }
  }
  if (!ok) { showToast('Lengkapi dulu isian yang merah ya.', true); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Menyimpan…';

  try {
    const payload = {
      user_id: CURRENT_USER.id,
      activity: activity,
      type: isFinance ? 'expense' : 'activity',
    };
    if (isFinance) {
      payload.amount = Number(amountRaw);
      payload.status = 'selesai';
      payload.end_time = new Date().toISOString();
    } else {
      payload.status = 'berjalan';
    }

    const { error } = await supabase.from('habit').insert(payload);
    if (error) throw error;

    document.getElementById('in-activity').value = '';
    if (isFinance) {
      document.getElementById('in-amount').value = '';
      document.getElementById('in-finance').checked = false;
      toggleFinance(false);
    }
    showToast(isFinance ? 'Pengeluaran tercatat.' : 'Gas, semangat aktivitasnya!');
    await loadAll();
  } catch (e) {
    console.error(e);
    showToast('Gagal simpan: ' + (e.message || 'coba lagi.'), true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function stopActivity(id, btn) {
  btn.disabled = true;
  btn.textContent = 'Menghentikan…';
  try {
    const { error } = await supabase
      .from('habit')
      .update({ status: 'selesai', end_time: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', CURRENT_USER.id); // extra guard, RLS also enforces this
    if (error) throw error;
    showToast('Drilling dihentikan.');
    await loadAll();
  } catch (e) {
    console.error(e);
    showToast('Gagal menghentikan: ' + (e.message || ''), true);
    btn.disabled = false;
    btn.textContent = '■ Stop';
  }
}

/* ---------------- rendering ---------------- */
function renderRunning() {
  const box = document.getElementById('running-list');
  if (RUNNING.length === 0) {
    box.innerHTML = `<div class="empty">Belum ada aktivitas yang lagi jalan.</div>`;
    return;
  }
  box.innerHTML = RUNNING.map(r => {
    const elapsed = Math.floor((Date.now() - new Date(r.start_time).getTime()) / 1000);
    return `
    <div class="run-item" data-id="${escapeHtml(r.id)}" data-start="${escapeHtml(r.start_time)}">
      <div class="run-dot-wrap"><span class="pulse-dot"></span></div>
      <div class="run-body">
        <div class="run-activity" title="${escapeHtml(r.activity)}">${escapeHtml(r.activity)}</div>
        <div class="run-time">mulai ${escapeHtml(fmtClock(r.start_time))}</div>
      </div>
      <div style="text-align:right;">
        <div class="run-elapsed mono" data-elapsed>${fmtDurationSecs(elapsed)}</div>
        <button class="btn btn-stop" style="margin-top:6px;" onclick="stopActivity('${r.id}', this)">■ Stop</button>
      </div>
    </div>`;
  }).join('');
}

function tickRunning() {
  document.querySelectorAll('.run-item').forEach(el => {
    const start = new Date(el.dataset.start).getTime();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const out = el.querySelector('[data-elapsed]');
    if (out) out.textContent = fmtDurationSecs(elapsed);
  });
}

function setHistRange(range) {
  HIST_RANGE = range;
  document.querySelectorAll('#hist-filter .chip-filter').forEach(c => c.classList.toggle('active', c.dataset.range === range));
  renderHistory();
}

function filterByRange(rows, range) {
  const now = Date.now();
  const cutoffs = {
    '24h':  now - 24 * 60 * 60 * 1000,
    'month': (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); })(),
    'year':  (() => { const d = new Date(); d.setMonth(0,1); d.setHours(0,0,0,0); return d.getTime(); })(),
  };
  const cutoff = cutoffs[range] ?? 0;
  return rows.filter(r => new Date(r.start_time).getTime() >= cutoff);
}

function renderHistory() {
  const box = document.getElementById('history-list');
  const rows = filterByRange(HISTORY_ALL, HIST_RANGE);

  if (rows.length === 0) {
    box.innerHTML = `<div class="empty">Belum ada riwayat di rentang ini.</div>`;
    return;
  }
  box.innerHTML = rows.map(r => {
    if (r.type === 'expense') {
      return `
      <div class="hist-row">
        <span class="type-pill finance">KELUAR DUIT</span>
        <div class="hist-main">
          <div class="hist-title">${escapeHtml(r.activity)}</div>
          <div class="hist-sub">${escapeHtml(fmtRelativeTime(r.start_time))}</div>
        </div>
        <div class="hist-value spend">${fmtRupiah(r.amount)}</div>
      </div>`;
    }
    const durSec = r.end_time
      ? Math.floor((new Date(r.end_time) - new Date(r.start_time)) / 1000)
      : 0;
    return `
    <div class="hist-row">
      <span class="type-pill drilling">AKTIVITAS</span>
      <div class="hist-main">
        <div class="hist-title">${escapeHtml(r.activity)}</div>
        <div class="hist-sub">${escapeHtml(fmtClock(r.start_time))} – ${r.end_time ? escapeHtml(fmtClock(r.end_time)) : '…'} · ${escapeHtml(fmtRelativeTime(r.start_time))}</div>
      </div>
      <div class="hist-value dur">${fmtDurationSecs(durSec)}</div>
    </div>`;
  }).join('');
}

/* ---------------- data loading ---------------- */
async function loadAll() {
  // RLS already scopes every query to the signed-in user (auth.uid() = user_id),
  // the .eq('user_id', ...) below is just an extra explicit guard/readability.
  const [{ data: running, error: rErr }, { data: mine, error: mErr }] = await Promise.all([
    supabase.from('habit').select('*').eq('user_id', CURRENT_USER.id).eq('status', 'berjalan').order('start_time', { ascending: false }),
    supabase.from('habit').select('*').eq('user_id', CURRENT_USER.id).eq('status', 'selesai').order('start_time', { ascending: false }).limit(500),
  ]);
  if (rErr) console.error(rErr);
  if (mErr) console.error(mErr);
  RUNNING = running || [];
  HISTORY_ALL = mine || [];
  renderRunning();
  renderHistory();
}

(async () => {
  const ctx = await requireAuth('../../index.html');
  if (!ctx) return;
  CURRENT_USER = ctx.user;
  CURRENT_PROFILE = ctx.profile;

  const displayName = CURRENT_PROFILE?.full_name || CURRENT_USER.email;
  document.getElementById('who-badge').textContent = initials(displayName);
  document.getElementById('who-name').textContent = displayName;

  await loadAll();

  tickHandle = setInterval(tickRunning, 1000);

  supabase
    .channel('activity-logs-own-' + CURRENT_USER.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'habit', filter: `user_id=eq.${CURRENT_USER.id}` },
      () => loadAll()
    )
    .subscribe();
})();
