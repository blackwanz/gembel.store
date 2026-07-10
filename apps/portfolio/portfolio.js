// ============================================================
// PORTFOLIO LIVE — holdings tracker with real prices
//  - Crypto: Binance public API (no key needed)
//      GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
//  - Stocks: best-effort via Yahoo Finance public endpoint.
//    Browser CORS can block it — when a price can't be fetched
//    we show a red NO DATA badge instead of inventing numbers.
//  - Anything that isn't crypto or a recognized stock ticker (emas,
//    reksadana, etc.) has no live price source — it's tracked at
//    quantity only, no $ value, no NO DATA badge (that badge means
//    "we tried and failed", not "we don't try").
//
//  PERSISTENCE — Supabase table `portofolio_h` (an append-only
//  LEDGER, not a snapshot of current holdings — this is the "_h"
//  in the name):
//    columns: id, user_id, type, symbol, quantity, satuan, created_at
//  Every add is a new row with a positive quantity. There is no
//  update/delete of history: removing a holding inserts an
//  *offsetting negative-quantity row* for that (type, symbol) so
//  the running sum goes back to zero. "Current holdings" is always
//  computed client-side as SUM(quantity) GROUPed BY (type, symbol),
//  keeping only groups whose sum is still > 0.
//
//  Auth: assumes a Supabase session already exists elsewhere in the
//  app. Every row needs user_id, so without a session the page shows
//  a blocking "not signed in" state instead of quietly failing every
//  insert.
// ============================================================

const REFRESH_MS = 30_000;

// Types with a live price feed. Anything else is tracked by quantity only.
const PRICED_TYPES = new Set(['crypto', 'stock']);

let ledger = [];     // raw portofolio_h rows for this user (full history)
let holdings = [];   // derived: [{ type, symbol, qty, satuan }] where qty > 0
let prices = {};     // `${type}:${symbol}` -> { price, changePct, ok, loading }
let currentUser = null;
let removing = new Set(); // symbol keys mid-removal, to guard double-clicks

/* ---------------- helpers ---------------- */
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return 'NaN';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 6 : 2 });
}

function holdKey(type, symbol) { return `${type}::${symbol.toUpperCase()}`; }

// Ledger quantities are summed from many float rows (adds + offsetting
// removes), which accumulates binary-float noise like 0.6000000000000001.
// Round to a sane precision before ever displaying a qty.
function fmtQty(n) {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1e8) / 1e8;
  return String(rounded);
}

/* ---------------- auth gate ---------------- */
function requireAuthOrBlock() {
  const blocked = !currentUser;
  document.getElementById('auth-banner').classList.toggle('hidden', !blocked);
  document.getElementById('btn-add').disabled = blocked;
  if (blocked) showToast('🔒 Belum login — nggak bisa nyimpen ke portfolio.', 'err');
  return !blocked;
}

/* ---------------- ledger load + derive current holdings ---------------- */
async function loadLedger() {
  if (!currentUser) { ledger = []; holdings = []; return; }
  const { data, error } = await supabase.from('portofolio_h')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error) {
    showToast('Gagal baca portfolio: ' + error.message, 'err');
    ledger = [];
  } else {
    ledger = data || [];
  }
  deriveHoldings();
}

function deriveHoldings() {
  const sums = new Map(); // key -> { type, symbol, qty, satuan }
  for (const row of ledger) {
    const key = holdKey(row.type, row.symbol);
    const existing = sums.get(key) || { type: row.type, symbol: row.symbol, qty: 0, satuan: row.satuan };
    existing.qty += Number(row.quantity) || 0;
    existing.satuan = row.satuan || existing.satuan; // most recent non-empty satuan wins
    sums.set(key, existing);
  }
  // Round away float-summation noise once, here, so both the "is this
  // fully closed out" filter and every downstream use (rendering, the
  // removal offset amount, value = price * qty) see a clean number.
  for (const h of sums.values()) h.qty = Math.round(h.qty * 1e8) / 1e8;
  holdings = [...sums.values()].filter(h => h.qty > 1e-9);
}

/* ---------------- price fetchers ---------------- */
function binanceSymbol(sym) {
  // BTC / BTCUSD / btcusdt -> BTCUSDT
  let s = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) return s;
  if (s.endsWith('USD')) return s.slice(0, -3) + 'USDT';
  return s + 'USDT';
}

async function fetchCrypto(sym) {
  const pair = binanceSymbol(sym);
  const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`);
  if (!res.ok) throw new Error('binance ' + res.status);
  const j = await res.json();
  const price = parseFloat(j.lastPrice);
  if (!Number.isFinite(price)) throw new Error('bad price');
  return { price, changePct: parseFloat(j.priceChangePercent) };
}

async function fetchStock(sym) {
  // Yahoo public chart endpoint — may be blocked by CORS in some browsers.
  const s = encodeURIComponent(sym.toUpperCase().trim());
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=2d`);
  if (!res.ok) throw new Error('yahoo ' + res.status);
  const j = await res.json();
  const meta = j?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!Number.isFinite(price)) throw new Error('bad price');
  const prev = meta?.chartPreviousClose ?? meta?.previousClose;
  const changePct = Number.isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : NaN;
  return { price, changePct };
}

async function refreshPrices() {
  if (!holdings.length) { render(); return; }
  document.getElementById('btn-refresh').disabled = true;

  await Promise.all(holdings.map(async (h) => {
    const key = holdKey(h.type, h.symbol);
    const type = h.type.toLowerCase();
    if (!PRICED_TYPES.has(type)) {
      prices[key] = { price: NaN, changePct: NaN, ok: false, loading: false, unpriced: true };
      return;
    }
    prices[key] = { ...(prices[key] || {}), loading: true };
    try {
      const p = type === 'crypto' ? await fetchCrypto(h.symbol) : await fetchStock(h.symbol);
      prices[key] = { ...p, ok: true, loading: false, unpriced: false };
    } catch (e) {
      console.warn(`Price fail ${h.symbol}:`, e.message);
      prices[key] = { price: NaN, changePct: NaN, ok: false, loading: false, unpriced: false };
    }
  }));

  document.getElementById('btn-refresh').disabled = false;
  document.getElementById('stat-updated').textContent =
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  render();
}

/* ---------------- rendering ---------------- */
function render() {
  const body = document.getElementById('holdings-body');
  const empty = document.getElementById('holdings-empty');
  empty.classList.toggle('show', holdings.length === 0);

  let total = 0;
  let anyOk = false;
  let anyFailed = false;

  body.innerHTML = holdings.map(h => {
    const key = holdKey(h.type, h.symbol);
    const p = prices[key] || {};
    const typeLabel = h.type.charAt(0).toUpperCase() + h.type.slice(1);
    let priceCell, chgCell, valueCell, rowFailed = false;

    if (p.unpriced) {
      // no live feed for this asset type — quantity-only tracking, not an error
      priceCell = `<span class="chg na">no feed</span>`;
      chgCell = `<span class="chg na">—</span>`;
      valueCell = `<span class="chg na">—</span>`;
    } else if (p.loading && p.price === undefined) {
      priceCell = `<span class="price-loading">fetching…</span>`;
      chgCell = `<span class="chg na">—</span>`;
      valueCell = `<span class="price-loading">…</span>`;
    } else if (p.ok) {
      anyOk = true;
      const value = p.price * h.qty;
      total += value;
      const up = p.changePct >= 0;
      priceCell = fmtMoney(p.price);
      chgCell = Number.isFinite(p.changePct)
        ? `<span class="chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(p.changePct).toFixed(2)}%</span>`
        : `<span class="chg na">—</span>`;
      valueCell = `<b>${fmtMoney(value)}</b>`;
    } else {
      rowFailed = true;
      anyFailed = true;
      priceCell = `<span class="no-data">⚠ NO DATA</span>`;
      chgCell = `<span class="chg na">NaN</span>`;
      valueCell = `<span class="chg down mono">NaN</span>`;
    }

    return `
    <tr class="${rowFailed ? 'row-failed' : ''}">
      <td>
        <div class="asset-cell">
          <div class="asset-ic ${h.type.toLowerCase() === 'crypto' ? 'crypto' : 'stock'}">${h.type.toLowerCase() === 'crypto' ? '🪙' : '📊'}</div>
          <div>
            <div class="asset-sym">${escapeHtml(h.symbol.toUpperCase())}</div>
            <div class="asset-type">${escapeHtml(typeLabel)}</div>
          </div>
        </div>
      </td>
      <td class="num">${fmtQty(h.qty)}${h.satuan ? ' ' + escapeHtml(h.satuan) : ''}</td>
      <td class="num">${priceCell}</td>
      <td class="num">${chgCell}</td>
      <td class="num">${valueCell}</td>
      <td style="text-align:right;"><button class="row-del" data-del-type="${escapeHtml(h.type)}" data-del-symbol="${escapeHtml(h.symbol)}" title="Remove">✕</button></td>
    </tr>`;
  }).join('');

  // Total is only meaningful if every holding either priced OK or has no
  // feed to begin with (never claim a total while a priced asset is failing).
  document.getElementById('stat-total').textContent =
    anyFailed ? 'NaN' : fmtMoney(total);
  document.getElementById('stat-assets').textContent = holdings.length;
}

document.getElementById('holdings-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del-symbol]');
  if (!btn) return;
  if (!requireAuthOrBlock()) return;

  const type = btn.dataset.delType;
  const symbol = btn.dataset.delSymbol;
  const key = holdKey(type, symbol);
  if (removing.has(key)) return;

  const current = holdings.find(h => holdKey(h.type, h.symbol) === key);
  if (!current) return;

  removing.add(key);
  btn.disabled = true;
  try {
    const { error } = await supabase.from('portofolio_h').insert({
      user_id: currentUser.id,
      type: current.type,
      symbol: current.symbol,
      quantity: -current.qty, // offsetting row — zeroes the running sum, keeps history intact
      satuan: current.satuan || null,
    });
    if (error) { showToast('Gagal hapus: ' + error.message, 'err'); return; }
    await loadLedger();
    delete prices[key];
    showToast(`${symbol.toUpperCase()} dihapus.`, 'ok');
    render();
  } finally {
    removing.delete(key);
  }
});

/* ---------------- add asset ---------------- */
function setInvalid(fieldId, invalid) {
  document.getElementById(fieldId).classList.toggle('invalid', invalid);
  const err = document.querySelector('#' + fieldId + ' .err-text');
  if (err) err.classList.toggle('show', invalid);
}

document.getElementById('btn-add').addEventListener('click', async () => {
  if (!requireAuthOrBlock()) return;

  const type = document.getElementById('in-type').value.trim().toLowerCase();
  const symbol = document.getElementById('in-symbol').value.trim();
  const qty = parseFloat(document.getElementById('in-qty').value);
  const satuan = document.getElementById('in-satuan').value.trim();

  let ok = true;
  if (!type) { setInvalid('f-type', true); ok = false; } else setInvalid('f-type', false);
  if (!symbol) { setInvalid('f-symbol', true); ok = false; } else setInvalid('f-symbol', false);
  if (!Number.isFinite(qty) || qty <= 0) { setInvalid('f-qty', true); ok = false; } else setInvalid('f-qty', false);
  if (!ok) return;

  const btn = document.getElementById('btn-add');
  btn.disabled = true;
  try {
    const { error } = await supabase.from('portofolio_h').insert({
      user_id: currentUser.id,
      type,
      symbol,
      quantity: qty,
      satuan: satuan || null,
    });
    if (error) { showToast('Gagal nambah: ' + error.message, 'err'); return; }

    document.getElementById('in-symbol').value = '';
    document.getElementById('in-qty').value = '';
    document.getElementById('in-satuan').value = '';
    showToast(`${symbol.toUpperCase()} ditambahkan.`, 'ok');

    await loadLedger();
    render();
    await refreshPrices();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('in-type').addEventListener('change', (e) => {
  const t = e.target.value.toLowerCase();
  document.getElementById('in-symbol').placeholder = t === 'crypto' ? 'BTCUSD' : t === 'stock' ? 'AAPL' : 'contoh: ANTAM, XAU';
  document.getElementById('in-satuan').placeholder = t === 'crypto' ? 'coin' : t === 'stock' ? 'lembar' : 'gram';
});

document.getElementById('btn-refresh').addEventListener('click', refreshPrices);

/* ---------------- endurance mini calc (unchanged — not stored, pure calc) ---------------- */
function runEnduranceCalc() {
  const contract = parseFloat(document.getElementById('calc-pair').value);
  const equity = parseFloat(document.getElementById('calc-equity').value) || 0;
  const lot = parseFloat(document.getElementById('calc-lot').value) || 0;
  const out = document.getElementById('calc-result');
  out.textContent = (equity > 0 && lot > 0)
    ? `± $${(equity / (lot * contract)).toFixed(2)}`
    : '± $0.00';
}
['calc-pair', 'calc-equity', 'calc-lot'].forEach(id =>
  document.getElementById(id).addEventListener('input', runEnduranceCalc));

/* ---------------- init ---------------- */
(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUser = user || null;
  } catch { currentUser = null; }

  requireAuthOrBlock();
  await loadLedger();
  render();
  await refreshPrices();
  setInterval(refreshPrices, REFRESH_MS);
})();