// ============================================================
// TRADE MASTER — risk-locked MT5 web terminal
//
//  THE LOCKED RULES (no UI exists to change them — on purpose):
//   1. Max daily loss  = 1% of day-start equity.
//   2. Risk per trade  = 10% of the daily limit  → 10 shots/day.
//   3. Max 10 trades per day.
//   4. Hit the daily limit → trading LOCKED until midnight reset.
//   5. Floating loss reaches the limit → FORCE CLOSE ALL, then lock.
//   6. No journal, no trade: reason (≥10 chars) + SL + TP required.
//   7. Lot is auto-computed from risk ÷ SL distance. Read-only.
//
//  Talks to a local bridge server (mt5_bridge.py) that holds the
//  real MT5 connection:
//   GET  /health              GET  /account         GET /positions
//   GET  /price?symbol=X      POST /order           POST /close_all
//
//  Journal: saved to Supabase table `trade_journal` when logged in
//  (see setup.sql), plus a localStorage copy so nothing is lost.
// ============================================================

const RULES = Object.freeze({
  DAILY_LOSS_PCT: 0.01,   // 1% of day-start equity
  PER_TRADE_FRACTION: 0.10, // 10% of daily limit per position
  MAX_TRADES_PER_DAY: 10,
  MIN_REASON_LEN: 10,
});

const CONTRACT_SIZE = { XAUUSD: 100, BTCUSD: 1, EURUSD: 100000 };
const DAY_KEY = 'tm_day_v2';
const JOURNAL_KEY = 'tm_journal_v2';
const POLL_MS = 3000;

let bridge = null;          // base URL when connected
let account = null;         // { equity, balance, currency }
let positions = [];
let livePrice = NaN;
let side = 'buy';
let day = null;             // { date, startEquity, trades, locked, lockedReason }
let pollHandle = null;
let currentUser = null;     // supabase user (optional)
let forceClosing = false;

/* ================= helpers ================= */
const $ = (id) => document.getElementById(id);

function showToast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 3200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

const fmt$ = (n) => Number.isFinite(n)
  ? (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '$—';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ================= day state (the lock) ================= */
function loadDay() {
  try { day = JSON.parse(localStorage.getItem(DAY_KEY)); } catch { day = null; }
  if (!day || day.date !== todayStr()) {
    day = { date: todayStr(), startEquity: null, trades: 0, locked: false, lockedReason: '' };
    saveDay();
  }
}
function saveDay() { localStorage.setItem(DAY_KEY, JSON.stringify(day)); }

function dailyLimit()  { return day?.startEquity ? day.startEquity * RULES.DAILY_LOSS_PCT : NaN; }
function perTradeRisk(){ return dailyLimit() * RULES.PER_TRADE_FRACTION; }

function lockTrading(reason) {
  if (day.locked) return;
  day.locked = true;
  day.lockedReason = reason;
  saveDay();
  renderDay();
  showToast('🔒 ' + reason, 'err');
}

function msUntilReset() {
  const now = new Date();
  const reset = new Date(now); reset.setHours(24, 0, 0, 0);
  return reset - now;
}

setInterval(() => {
  // countdown + auto day-reset
  if (day && day.date !== todayStr()) { loadDay(); renderDay(); renderJournal(); }
  const ms = msUntilReset();
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
  $('lb-countdown').textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}, 1000);

/* ================= bridge API ================= */
async function api(path, opts = {}) {
  const res = await fetch(bridge + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function connect() {
  const url = $('bridge-url').value.trim().replace(/\/+$/, '');
  if (!url) return;
  $('btn-connect').disabled = true;
  $('bridge-status').textContent = 'Connecting…';
  try {
    bridge = url;
    const h = await api('/health');
    const acc = await api('/account');
    onAccount(acc);
    setConnected(true, h.mt5 ? 'MT5 live' : 'bridge ok');
    localStorage.setItem('tm_bridge_url', url);
    clearInterval(pollHandle);
    pollHandle = setInterval(poll, POLL_MS);
    poll();
    showToast('Connected to bridge ✓', 'ok');
  } catch (e) {
    bridge = null;
    setConnected(false);
    $('bridge-status').textContent = '✗ ' + e.message + ' — pastikan mt5_bridge.py jalan.';
  } finally {
    $('btn-connect').disabled = false;
  }
}

function setConnected(on, label) {
  $('conn-chip').classList.toggle('on', on);
  $('conn-label').textContent = on ? ('Connected · ' + (label || '')) : 'Disconnected';
  if (!on) {
    clearInterval(pollHandle);
    $('positions-list').innerHTML = '<div class="empty">Belum connect ke bridge.</div>';
  }
  updateExecuteState();
}

function onAccount(acc) {
  account = acc;
  // first sight of equity today = day-start equity (the anchor for 1%)
  if (day.startEquity === null && Number.isFinite(acc.equity)) {
    day.startEquity = acc.equity;
    saveDay();
  }
  renderDay();
}

async function poll() {
  if (!bridge) return;
  try {
    const [acc, pos] = await Promise.all([api('/account'), api('/positions')]);
    onAccount(acc);
    positions = pos.positions || [];
    renderPositions();
    await enforceRisk();
    refreshLivePrice();
  } catch (e) {
    setConnected(false);
    $('bridge-status').textContent = '✗ koneksi putus: ' + e.message;
  }
}

/* ================= THE ENFORCER ================= */
async function enforceRisk() {
  if (!account || !day.startEquity) return;
  const limit = dailyLimit();
  const drawdown = day.startEquity - account.equity; // realized + floating

  if (drawdown >= limit && !day.locked) {
    lockTrading(`Daily 1% limit breached (−${fmt$(drawdown)}).`);
    if (positions.length && !forceClosing) {
      forceClosing = true;
      try {
        await api('/close_all', { method: 'POST' });
        showToast('⛔ FORCE CLOSE ALL — 1% harian jebol.', 'err');
      } catch (e) {
        showToast('Force close gagal: ' + e.message, 'err');
      } finally {
        forceClosing = false;
      }
    }
  }
}

/* ================= rendering ================= */
function renderDay() {
  const limit = dailyLimit();
  $('rule-daily').textContent = Number.isFinite(limit) ? `1% equity = ${fmt$(limit)}` : '1% equity = $—';
  $('rule-per-trade').textContent = Number.isFinite(limit) ? `10% of limit = ${fmt$(perTradeRisk())}` : '10% of limit = $—';
  $('ds-start').textContent = fmt$(day.startEquity);
  $('ds-equity').textContent = fmt$(account?.equity);
  const pl = (account && day.startEquity != null) ? account.equity - day.startEquity : NaN;
  const plEl = $('ds-pl');
  plEl.textContent = fmt$(pl);
  plEl.className = 'mono ' + (pl > 0 ? 'up' : pl < 0 ? 'down' : '');
  $('ds-trades').textContent = `${day.trades} / ${RULES.MAX_TRADES_PER_DAY}`;

  const used = Number.isFinite(pl) && pl < 0 ? Math.min(100, (-pl / limit) * 100) : 0;
  $('rm-pct').textContent = used.toFixed(0) + '%';
  $('rm-fill').style.width = used + '%';

  const banner = $('lockout-banner');
  banner.classList.toggle('hidden', !day.locked);
  if (day.locked) $('lb-sub').textContent = day.lockedReason + ' Balik setelah day reset.';

  updateExecuteState();
}

function renderPositions() {
  const box = $('positions-list');
  if (!positions.length) {
    box.innerHTML = '<div class="empty">Nggak ada posisi terbuka.</div>';
    return;
  }
  box.innerHTML = positions.map(p => {
    const up = p.profit >= 0;
    return `
    <div class="pos-row">
      <span class="pos-side ${p.type === 0 ? 'buy' : 'sell'}">${p.type === 0 ? 'BUY' : 'SELL'}</span>
      <div class="pos-main">
        <div class="pos-sym">${escapeHtml(p.symbol)} · ${p.volume} lot</div>
        <div class="pos-meta">open ${p.price_open} · SL ${p.sl || '—'} · TP ${p.tp || '—'}</div>
      </div>
      <span class="pos-pl ${up ? 'up' : 'down'}">${up ? '+' : ''}${fmt$(p.profit)}</span>
    </div>`;
  }).join('');
}

/* ================= live price + lot math ================= */
let priceHandle = null;
async function refreshLivePrice() {
  if (!bridge) return;
  const symbol = $('in-symbol').value;
  try {
    const p = await api('/price?symbol=' + encodeURIComponent(symbol));
    livePrice = side === 'buy' ? p.ask : p.bid;
    $('live-price-pill').textContent = `${symbol} ${livePrice}`;
  } catch {
    livePrice = NaN;
    $('live-price-pill').textContent = symbol + ' —';
  }
  recalcLot();
}

function recalcLot() {
  const sl = parseFloat($('in-sl').value);
  const tp = parseFloat($('in-tp').value);
  const risk = perTradeRisk();
  const contract = CONTRACT_SIZE[$('in-symbol').value] || 1;

  let lot = 0, rr = '—';
  if (Number.isFinite(livePrice) && Number.isFinite(sl) && Number.isFinite(risk) && risk > 0) {
    const slDist = Math.abs(livePrice - sl);
    if (slDist > 0) {
      lot = Math.max(0.01, Math.floor((risk / (slDist * contract)) * 100) / 100);
      if (Number.isFinite(tp)) {
        const tpDist = Math.abs(tp - livePrice);
        rr = '1 : ' + (tpDist / slDist).toFixed(1);
      }
    }
  }
  $('calc-lot').textContent = lot ? lot.toFixed(2) : '0.00';
  $('calc-risk').textContent = fmt$(Number.isFinite(risk) ? risk : NaN);
  $('calc-rr').textContent = rr;
  updateExecuteState();
  return lot;
}

/* ================= validation & execute ================= */
function validSlTp(showErrors) {
  const sl = parseFloat($('in-sl').value);
  const tp = parseFloat($('in-tp').value);
  let slOk = Number.isFinite(sl), tpOk = Number.isFinite(tp);
  if (Number.isFinite(livePrice)) {
    if (side === 'buy')  { slOk = slOk && sl < livePrice; tpOk = tpOk && tp > livePrice; }
    else                 { slOk = slOk && sl > livePrice; tpOk = tpOk && tp < livePrice; }
  }
  if (showErrors) {
    $('f-sl').classList.toggle('invalid', !slOk);
    $('err-sl').classList.toggle('show', !slOk);
    $('f-tp').classList.toggle('invalid', !tpOk);
    $('err-tp').classList.toggle('show', !tpOk);
  }
  return slOk && tpOk;
}

function updateExecuteState() {
  const reason = $('in-reason').value.trim();
  const lot = parseFloat($('calc-lot').textContent);
  const ready =
    !!bridge &&
    !day.locked &&
    day.trades < RULES.MAX_TRADES_PER_DAY &&
    reason.length >= RULES.MIN_REASON_LEN &&
    lot > 0 &&
    validSlTp(false);
  const btn = $('btn-execute');
  btn.disabled = !ready;
  btn.textContent = day.locked ? '🔒 Locked until reset'
    : day.trades >= RULES.MAX_TRADES_PER_DAY ? '🔒 10 trades used'
    : !bridge ? 'Connect bridge first'
    : '🚀 Journal & Execute';
}

async function executeTrade() {
  // hard re-checks — belt and suspenders
  if (day.locked) { showToast('Trading locked sampai day reset.', 'err'); return; }
  if (day.trades >= RULES.MAX_TRADES_PER_DAY) { lockTrading('10 trades used.'); return; }

  const reason = $('in-reason').value.trim();
  const reasonOk = reason.length >= RULES.MIN_REASON_LEN;
  $('f-reason').classList.toggle('invalid', !reasonOk);
  document.querySelector('#f-reason .err-text').classList.toggle('show', !reasonOk);
  if (!validSlTp(true) || !reasonOk) { showToast('Lengkapi jurnal + SL/TP dulu.', 'err'); return; }

  const symbol = $('in-symbol').value;
  const sl = parseFloat($('in-sl').value);
  const tp = parseFloat($('in-tp').value);
  const lot = recalcLot();
  if (!(lot > 0)) { showToast('Lot belum valid — cek harga & SL.', 'err'); return; }

  const btn = $('btn-execute');
  btn.disabled = true; btn.textContent = 'Executing…';

  const entry = {
    ts: new Date().toISOString(),
    symbol, side, lot, sl, tp,
    entry_price: livePrice,
    reason,
    status: 'sent',
  };

  try {
    const r = await api('/order', {
      method: 'POST',
      body: JSON.stringify({ symbol, side, lot, sl, tp, comment: 'GembelTM' }),
    });
    entry.status = 'filled';
    entry.ticket = r.order || r.ticket || null;
    day.trades += 1;
    saveDay();
    showToast(`Order sent ✓ (${day.trades}/${RULES.MAX_TRADES_PER_DAY} today)`, 'ok');
    $('in-reason').value = ''; $('in-sl').value = ''; $('in-tp').value = '';
  } catch (e) {
    entry.status = 'rejected: ' + e.message;
    showToast('Order gagal: ' + e.message, 'err');
  }

  await saveJournal(entry);
  renderDay(); renderJournal();
  btn.disabled = false;
  updateExecuteState();
}

/* ================= journal ================= */
function localJournal() {
  try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch { return []; }
}

async function saveJournal(entry) {
  const all = localJournal();
  all.unshift(entry);
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(all.slice(0, 300)));

  if (currentUser) {
    const { error } = await supabase.from('trade_journal').insert({
      user_id: currentUser.id,
      symbol: entry.symbol,
      side: entry.side,
      lot: entry.lot,
      entry_price: Number.isFinite(entry.entry_price) ? entry.entry_price : null,
      sl: entry.sl,
      tp: entry.tp,
      reason: entry.reason,
      status: entry.status,
    });
    if (error) console.warn('journal cloud save failed:', error.message);
  }
}

function renderJournal() {
  const box = $('journal-list');
  const rows = localJournal().filter(e => e.ts.slice(0, 10) === todayStr());
  if (!rows.length) {
    box.innerHTML = '<div class="empty">Belum ada entry hari ini.</div>';
    return;
  }
  box.innerHTML = rows.map(e => `
    <div class="j-row">
      <div class="j-top">
        <span class="pos-side ${e.side}">${e.side.toUpperCase()}</span>
        <b>${escapeHtml(e.symbol)}</b>
        <span class="pill ${e.status === 'filled' ? 'mint' : e.status === 'sent' ? 'gold' : 'rose'}">${escapeHtml(e.status.split(':')[0])}</span>
        <span class="j-time">${new Date(e.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="j-detail">${e.lot} lot @ ${e.entry_price ?? '—'} · SL ${e.sl} · TP ${e.tp}</div>
      <div class="j-reason">${escapeHtml(e.reason)}</div>
    </div>`).join('');
}

/* ================= events ================= */
$('btn-connect').addEventListener('click', connect);
$('btn-execute').addEventListener('click', executeTrade);
$('btn-close-all').addEventListener('click', async () => {
  if (!bridge) { showToast('Connect dulu.', 'err'); return; }
  try { await api('/close_all', { method: 'POST' }); showToast('Close all sent.', 'ok'); }
  catch (e) { showToast('Gagal: ' + e.message, 'err'); }
});

$('side-buy').addEventListener('click', () => setSide('buy'));
$('side-sell').addEventListener('click', () => setSide('sell'));
function setSide(s) {
  side = s;
  $('side-buy').classList.toggle('active', s === 'buy');
  $('side-sell').classList.toggle('active', s === 'sell');
  refreshLivePrice();
}

$('in-symbol').addEventListener('change', refreshLivePrice);
['in-sl', 'in-tp'].forEach(id => $(id).addEventListener('input', recalcLot));
$('in-reason').addEventListener('input', () => {
  $('f-reason').classList.remove('invalid');
  document.querySelector('#f-reason .err-text').classList.remove('show');
  updateExecuteState();
});

/* ================= init ================= */
(async () => {
  loadDay();
  renderDay();
  renderJournal();

  const savedUrl = localStorage.getItem('tm_bridge_url');
  if (savedUrl) $('bridge-url').value = savedUrl;

  // optional supabase session for cloud journal
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUser = user || null;
  } catch { currentUser = null; }

  // refresh price pill every 5s even before first trade
  priceHandle = setInterval(() => { if (bridge) refreshLivePrice(); }, 5000);
})();
