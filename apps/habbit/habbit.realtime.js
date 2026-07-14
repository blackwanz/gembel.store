// ============================================================
// HABBIT — realtime functionality (classic-script build).
// Load AFTER habbit.config.js.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};
  const { supabase } = window.Habbit.config;

  function subscribeToChanges(userId, onChange) {
    if (!userId) throw new Error('subscribeToChanges: missing userId.');
    if (typeof onChange !== 'function') throw new Error('subscribeToChanges: onChange must be a function.');
    const channel = supabase
      .channel('habbit-own-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habbit_h', filter: `user_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habbit_d', filter: `user_id=eq.${userId}` }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  window.Habbit.realtime = { subscribeToChanges };
})();
