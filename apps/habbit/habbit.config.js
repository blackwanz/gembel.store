// ============================================================
// HABBIT — Supabase client bootstrap (classic-script build, PROD).
// This is what makes the app "not a mockup anymore": it does NOT
// create its own client and does NOT fake anything in memory.
// assets/supabaseClient.js (loaded before this file) already built the
// real client and assigned it to window.supabase — this file just
// re-exports that exact instance onto window.Habbit.config, so
// every other habbit.*.js module keeps using the same
// `const { supabase } = window.Habbit.config;` pattern it always
// has, whether the backend behind it is real or (previously) mock.
//
// Load this file AFTER assets/supabaseClient.js and BEFORE everything
// else under window.Habbit (state/login/get/write/realtime/ui/js).
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};

  if (!window.supabase || typeof window.supabase.from !== 'function') {
    throw new Error(
      'window.supabase is not a real client yet. Check habbit.html\'s ' +
      '<script> order: supabase-js SDK -> assets/supabaseClient.js -> habbit.config.js.'
    );
  }

  window.Habbit.config = { supabase: window.supabase };
})();
