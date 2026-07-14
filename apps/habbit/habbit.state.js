// ============================================================
// HABBIT — state functionality (classic-script build).
// Load AFTER habbit.utils.js.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};
  const { createStore, toDateOnly } = window.Habbit.utils;

  const today = new Date();

  const store = createStore({
    user: null,
    profile: null,
    running: [],
    history: [],
    histPeriodType: 'day',                // 'day' | 'month' | 'year'
    histPeriodValue: toDateOnly(today),   // 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY'
    histType: 'B',                        // 'B' | 'A' | 'F'
  });

  function startInstant(row) {
    return new Date(`${row.start_date}T${row.time_start}`).getTime();
  }

  function getPeriodBounds(periodType, periodValue) {
    if (periodType === 'day' && periodValue) {
      const start = new Date(`${periodValue}T00:00:00`);
      const end = new Date(`${periodValue}T23:59:59.999`);
      if (!Number.isNaN(start.getTime())) return [start.getTime(), end.getTime()];
    }
    if (periodType === 'month' && periodValue) {
      const parts = periodValue.split('-').map(Number);
      const y = parts[0], m = parts[1];
      if (y && m) {
        const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
        const end = new Date(y, m, 0, 23, 59, 59, 999);
        return [start.getTime(), end.getTime()];
      }
    }
    if (periodType === 'year' && periodValue) {
      const y = Number(periodValue);
      if (Number.isFinite(y) && y > 0) {
        const start = new Date(y, 0, 1, 0, 0, 0, 0);
        const end = new Date(y, 11, 31, 23, 59, 59, 999);
        return [start.getTime(), end.getTime()];
      }
    }
    return [-Infinity, Infinity];
  }

  function getFilteredHistory() {
    const s = store.getState();
    const bounds = getPeriodBounds(s.histPeriodType, s.histPeriodValue);
    return s.history.filter(row => {
      const t = startInstant(row);
      if (t < bounds[0] || t > bounds[1]) return false;
      if (s.histType === 'F' && !row.finance_flag) return false;
      if (s.histType === 'A' && row.finance_flag) return false;
      return true;
    });
  }

  window.Habbit.state = { store, getFilteredHistory };
})();
