// ============================================================
// HABBIT — central app state.
// Nothing in here touches the DOM or Supabase; it's just the
// single source of truth the controller (habbit.js) reads from
// and the renderer (habbit.ui.js) reacts to.
// ============================================================
import { createStore } from '../../assets/shared-utils.js';

export const store = createStore({
  user: null,
  profile: null,
  running: [],       // habbit_h rows — my own currently-running activities
  history: [],       // habbit_d rows — my own completed history (fetched once, filtered client-side)
  histRange: '24h',  // '24h' | 'month' | 'year'
});

/**
 * Reconstructs the moment this entry actually STARTED, from
 * start_date ("YYYY-MM-DD") + time_start ("HH:MM:SS"). Both were
 * captured from the same browser's local clock, so parsing the
 * combined string (no "Z"/offset suffix) yields the correct local
 * instant. Deliberately NOT `created_at` — for a stopped activity
 * that's the moment it was archived into habbit_d, which for a
 * long-running activity could be a different day than when it
 * actually started.
 */
function startInstant(r) {
  return new Date(`${r.start_date}T${r.time_start}`).getTime();
}

/** habbit_d rows within the currently-selected history range. */
export function getFilteredHistory() {
  const { history, histRange } = store.getState();
  const now = Date.now();
  const cutoffs = {
    '24h': now - 24 * 60 * 60 * 1000,
    month: (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); })(),
    year: (() => { const d = new Date(); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d.getTime(); })(),
  };
  const cutoff = cutoffs[histRange] ?? 0;
  return history.filter(r => startInstant(r) >= cutoff);
}
