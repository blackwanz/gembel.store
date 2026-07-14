// ============================================================
// HABBIT — read functionality (classic-script build).
// Load AFTER habbit.config.js.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};
  const { supabase } = window.Habbit.config;
  const HIST_LIMIT = 500;

  async function fetchRunning(userId) {
    if (!userId) throw new Error('fetchRunning: missing userId.');
    const { data, error } = await supabase
      .from('habbit_h').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function fetchHistory(userId, limit) {
    if (!userId) throw new Error('fetchHistory: missing userId.');
    const { data, error } = await supabase
      .from('habbit_d').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit || HIST_LIMIT);
    if (error) throw error;
    return data || [];
  }

  window.Habbit.get = { fetchRunning, fetchHistory };
})();
