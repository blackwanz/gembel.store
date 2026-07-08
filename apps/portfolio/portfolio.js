// ============================================================
// PORTFOLIO LIVE — holdings tracker with real prices
//  - Crypto: Binance public API (no key needed)
//      GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
//  - Stocks: best-effort via Yahoo Finance public endpoint.
//    Browser CORS can block it — when a price can't be fetched
//    we show a red NO DATA badge instead of inventing numbers.
//  - Holdings persist in this browser (localStorage).
// ============================================================

const STORE_KEY = 'gembel_portfolio_v1';
const REFRESH_MS = 30_000;

let holdings = [];   // [{ id, type:'crypto'|'stock', symbol, qty }]
let prices = {};     // id -> { price, changePct, ok, loading }

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

function load() {
  try { holdings = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
  catch { holdings = []; }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(holdings)); }

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
    prices[h.id] = { ...(prices[h.id] || {}), loading: true };
    try {
      const p = h.type === 'crypto' ? await fetchCrypto(h.symbol) : await fetchStock(h.symbol);
      prices[h.id] = { ...p, ok: true, loading: false };
    } catch (e) {
      console.warn(`Price fail ${h.symbol}:`, e.message);
      prices[h.id] = { price: NaN, changePct: NaN, ok: false, loading: false };
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

  body.innerHTML = holdings.map(h => {
    const p = prices[h.id] || {};
    const isCrypto = h.type === 'crypto';
    let priceCell, chgCell, valueCell, failed = false;

    if (p.loading && p.price === undefined) {
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
      failed = true;
      priceCell = `<span class="no-data">⚠ NO DATA</span>`;
      chgCell = `<span class="chg na">NaN</span>`;
      valueCell = `<span class="chg down mono">NaN</span>`;
    }

    return `
    <tr class="${failed ? 'row-failed' : ''}">
      <td>
        <div class="asset-cell">
          <div class="asset-ic ${h.type}">${isCrypto ? '🪙' : '📊'}</div>
          <div>
            <div class="asset-sym">${escapeHtml(h.symbol.toUpperCase())}</div>
            <div class="asset-type">${isCrypto ? 'Crypto · Binance' : 'Stock'}</div>
          </div>
        </div>
      </td>
      <td class="num">${h.qty}</td>
      <td class="num">${priceCell}</td>
      <td class="num">${chgCell}</td>
      <td class="num">${valueCell}</td>
      <td style="text-align:right;"><button class="row-del" data-del="${h.id}" title="Remove">✕</button></td>
    </tr>`;
  }).join('');

  document.getElementById('stat-total').textContent = anyOk || !holdings.length ? fmtMoney(total) : 'NaN';
  document.getElementById('stat-assets').textContent = holdings.length;
}

document.getElementById('holdings-body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  holdings = holdings.filter(h => h.id !== btn.dataset.del);
  delete prices[btn.dataset.del];
  save();
  render();
});

/* ---------------- add asset ---------------- */
function setInvalid(fieldId, invalid) {
  document.getElementById(fieldId).classList.toggle('invalid', invalid);
  const err = document.querySelector('#' + fieldId + ' .err-text');
  if (err) err.classList.toggle('show', invalid);
}

document.getElementById('btn-add').addEventListener('click', async () => {
  const type = document.getElementById('in-type').value;
  const symbol = document.getElementById('in-symbol').value.trim();
  const qty = parseFloat(document.getElementById('in-qty').value);

  let ok = true;
  if (!symbol) { setInvalid('f-symbol', true); ok = false; } else setInvalid('f-symbol', false);
  if (!Number.isFinite(qty) || qty <= 0) { setInvalid('f-qty', true); ok = false; } else setInvalid('f-qty', false);
  if (!ok) return;

  const id = 'a' + Date.now() + Math.random().toString(36).slice(2, 6);
  holdings.push({ id, type, symbol, qty });
  save();

  document.getElementById('in-symbol').value = '';
  document.getElementById('in-qty').value = '';
  showToast(`${symbol.toUpperCase()} ditambahkan.`, 'ok');
  render();
  await refreshPrices();
});

document.getElementById('in-type').addEventListener('change', (e) => {
  document.getElementById('in-symbol').placeholder = e.target.value === 'crypto' ? 'BTCUSD' : 'AAPL';
});

document.getElementById('btn-refresh').addEventListener('click', refreshPrices);

/* ---------------- endurance mini calc ---------------- */
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
load();
render();
refreshPrices();
setInterval(refreshPrices, REFRESH_MS);
