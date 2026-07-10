// ============================================================
// HABBIT — controller. Wires DOM events to the api/state/ui
// layers and owns the bootstrap sequence. This is the file
// habbit.html loads as `<script type="module" src="habbit.js">`.
// ============================================================
import * as api from './habbit.api.js';
import { store, getFilteredHistory } from './habbit.state.js';
import {
  updateWhoBadge, renderRunning, tickRunning, renderHistory,
  setHistRangeChips, toggleFinanceFields, resetActivityForm,
} from './habbit.ui.js';
import { showToast, setFieldInvalid, withBusy, newId } from '../../assets/shared-utils.js';

let tickHandle = null;
let unsubscribeRealtime = null;

/* ---------------- data loading ---------------- */
async function loadAll() {
  const { user } = store.getState();
  try {
    const [running, history] = await Promise.all([
      api.fetchRunning(user.id),
      api.fetchHistory(user.id),
    ]);
    store.setState({ running, history });
  } catch (e) {
    console.error(e);
    showToast('Gagal memuat data: ' + (e.message || ''), 'err');
  }
  renderRunning(store.getState().running);
  renderHistory(getFilteredHistory());
}

/* ---------------- form handling ---------------- */
async function handleSubmit() {
  const activity = document.getElementById('in-activity').value.trim();
  const isFinance = document.getElementById('in-finance').checked;
  const amountRaw = document.getElementById('in-amount').value.trim();
  const tagRaw = document.getElementById('in-tag').value.trim();

  let ok = true;
  if (activity.length < 3) { setFieldInvalid('f-activity', true); ok = false; }

  let amount = null;
  if (isFinance) {
    amount = Number(amountRaw);
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) { setFieldInvalid('f-amount', true); ok = false; }
  }
  if (!ok) { showToast('Lengkapi dulu isian yang merah ya.', 'err'); return; }

  const btn = document.getElementById('submit-btn');
  await withBusy(btn, 'Menyimpan…', async () => {
    try {
      const userId = store.getState().user.id;
      if (isFinance) {
        // Spending money is already a completed event — no "running"
        // phase, no later Stop — so it goes straight into history.
        await api.recordExpense({ userId, activity, financeTag: tagRaw || null, nominal: amount });
      } else {
        await api.startActivity({ userId, activityId: newId(), activity });
      }
      resetActivityForm();
      showToast(isFinance ? 'Pengeluaran tercatat.' : 'Gas, semangat aktivitasnya!');
      await loadAll();
    } catch (e) {
      console.error(e);
      showToast('Gagal simpan: ' + (e.message || 'coba lagi.'), 'err');
    }
  });
}

async function handleStop(id, btn) {
  await withBusy(btn, 'Menghentikan…', async () => {
    try {
      await api.stopActivity(id);
      showToast('Aktivitas dihentikan.');
      await loadAll();
    } catch (e) {
      console.error(e);
      showToast('Gagal menghentikan: ' + (e.message || ''), 'err');
    }
  });
}

/* ---------------- event wiring ---------------- */
function wireEvents() {
  document.getElementById('submit-btn').addEventListener('click', handleSubmit);

  document.getElementById('in-activity').addEventListener('input', () => setFieldInvalid('f-activity', false));
  document.getElementById('in-amount').addEventListener('input', function () {
    this.value = this.value.replace(/[^\d]/g, ''); // digits only, defense in depth (CSS/inputmode is the UX hint)
    setFieldInvalid('f-amount', false);
  });
  document.getElementById('in-finance').addEventListener('change', (e) => toggleFinanceFields(e.target.checked));

  document.getElementById('hist-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-filter');
    if (!chip) return;
    store.setState({ histRange: chip.dataset.range });
    setHistRangeChips(chip.dataset.range);
    renderHistory(getFilteredHistory());
  });

  // Event delegation: run-item buttons are re-rendered on every loadAll(),
  // so we listen on the stable container instead of re-binding per button.
  document.getElementById('running-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stop-id]');
    if (btn) handleStop(btn.dataset.stopId, btn);
  });
}

/* ---------------- bootstrap ---------------- */
(async () => {
  const ctx = await requireAuth('../../index.html');
  if (!ctx) return;

  const displayName = ctx.profile?.full_name || ctx.user.email;
  store.setState({ user: ctx.user, profile: ctx.profile });
  updateWhoBadge(displayName);

  wireEvents();
  await loadAll();

  tickHandle = setInterval(tickRunning, 1000);
  unsubscribeRealtime = api.subscribeToChanges(ctx.user.id, () => loadAll());
})();

window.addEventListener('beforeunload', () => {
  if (tickHandle) clearInterval(tickHandle);
  if (unsubscribeRealtime) unsubscribeRealtime();
});
