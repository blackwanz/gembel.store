// ============================================================
// HABBIT — controller functionality (classic-script build).
// Load LAST — after utils, config, state, login, get, write,
// realtime, ui. Everything it needs is already sitting on
// window.Habbit by the time this file runs.
// ============================================================
(function () {
  'use strict';
  const { requireAuth } = window.Habbit.login;
  const { fetchRunning, fetchHistory } = window.Habbit.get;
  const { startActivity, recordExpense, stopActivity } = window.Habbit.write;
  const { subscribeToChanges } = window.Habbit.realtime;
  const { store, getFilteredHistory } = window.Habbit.state;
  const {
    updateWhoBadge, renderRunning, tickRunning, renderHistory,
    setHistRangeChips, toggleFinanceFields, resetActivityForm,
    showStopForm, hideStopForm, readStopForm,
    setPeriodPickerVisibility, setHistTypeButtons,
  } = window.Habbit.ui;
  const { showToast, setFieldInvalid, withBusy } = window.Habbit.utils;

  let tickHandle = null;
  let unsubscribeRealtime = null;

  async function loadAll() {
    const { user } = store.getState();
    try {
      const [running, history] = await Promise.all([
        fetchRunning(user.id),
        fetchHistory(user.id),
      ]);
      store.setState({ running, history });
    } catch (e) {
      console.error(e);
      showToast('Gagal memuat data: ' + (e.message || ''), 'err');
    }
    renderRunning(store.getState().running);
    renderHistory(getFilteredHistory());
  }

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
          await recordExpense({ userId, activity, financeTag: tagRaw || null, nominal: amount });
        } else {
          await startActivity({ userId, activity });
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

  async function handleConfirmStop(id, qty, unit, btn) {
    await withBusy(btn, 'Menghentikan…', async () => {
      try {
        await stopActivity({ habbitHId: id, qty, unit });
        showToast('Aktivitas dihentikan.');
        await loadAll();
      } catch (e) {
        console.error(e);
        showToast('Gagal menghentikan: ' + (e.message || ''), 'err');
      }
    });
  }

  function wireEvents() {
    document.getElementById('submit-btn').addEventListener('click', handleSubmit);

    document.getElementById('in-activity').addEventListener('input', () => setFieldInvalid('f-activity', false));
    document.getElementById('in-amount').addEventListener('input', function () {
      this.value = this.value.replace(/[^\d]/g, '');
      setFieldInvalid('f-amount', false);
    });
    document.getElementById('in-finance').addEventListener('change', (e) => toggleFinanceFields(e.target.checked));

    document.getElementById('running-list').addEventListener('input', (e) => {
      if (e.target.matches('.stop-qty')) {
        e.target.value = e.target.value.replace(/[^\d]/g, '');
      }
    });

    document.getElementById('hist-filter').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-filter');
      if (!chip) return;
      const periodType = chip.dataset.range;

      const now = new Date();
      let periodValue;
      if (periodType === 'day') {
        periodValue = document.getElementById('period-day').value || now.toISOString().slice(0, 10);
        document.getElementById('period-day').value = periodValue;
      } else if (periodType === 'month') {
        periodValue = document.getElementById('period-month').value || now.toISOString().slice(0, 7);
        document.getElementById('period-month').value = periodValue;
      } else {
        periodValue = document.getElementById('period-year').value || String(now.getFullYear());
        document.getElementById('period-year').value = periodValue;
      }

      store.setState({ histPeriodType: periodType, histPeriodValue: periodValue });
      setHistRangeChips(periodType);
      setPeriodPickerVisibility(periodType);
      renderHistory(getFilteredHistory());
    });

    ['period-day', 'period-month', 'period-year'].forEach(id => {
      document.getElementById(id).addEventListener('change', (e) => {
        store.setState({ histPeriodValue: e.target.value });
        renderHistory(getFilteredHistory());
      });
    });

    document.getElementById('hist-type-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('.type-btn');
      if (!btn) return;
      store.setState({ histType: btn.dataset.type });
      setHistTypeButtons(btn.dataset.type);
      renderHistory(getFilteredHistory());
    });

    document.getElementById('running-list').addEventListener('click', (e) => {
      const stopBtn = e.target.closest('[data-stop-id]');
      if (stopBtn) { showStopForm(stopBtn.dataset.stopId); return; }

      const cancelBtn = e.target.closest('[data-cancel-stop-id]');
      if (cancelBtn) { hideStopForm(cancelBtn.dataset.cancelStopId); return; }

      const confirmBtn = e.target.closest('[data-confirm-stop-id]');
      if (confirmBtn) {
        const id = confirmBtn.dataset.confirmStopId;
        const { qty, unit } = readStopForm(id);
        handleConfirmStop(id, qty, unit, confirmBtn);
      }
    });
  }

  (async () => {
    const ctx = await requireAuth('index.html');
    if (!ctx) return;

    const displayName = (ctx.profile && ctx.profile.full_name) || ctx.user.email;
    store.setState({ user: ctx.user, profile: ctx.profile });
    updateWhoBadge(displayName);

    wireEvents();
    document.getElementById('period-day').value = store.getState().histPeriodValue;
    await loadAll();

    tickHandle = setInterval(tickRunning, 1000);
    unsubscribeRealtime = subscribeToChanges(ctx.user.id, () => loadAll());
  })();

  window.addEventListener('beforeunload', () => {
    if (tickHandle) clearInterval(tickHandle);
    if (unsubscribeRealtime) unsubscribeRealtime();
  });
})();
