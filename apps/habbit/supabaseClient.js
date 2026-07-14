// ============================================================
// assets/supabaseClient.js — creates the ONE real Supabase client for
// this project and exposes it as a global `window.supabase`.
// Shared across every app that lives under this domain (habbit,
// calendar, etc.) — each app's own *.config.js just re-exports
// this instance instead of building its own.
//
// Load order in every app's HTML:
//   1. supabase-js SDK (CDN)
//   2. assets/supabaseClient.js   <-- this file
//   3. the app's own *.config.js
//   4. everything else
//
// SECURITY
//   SUPABASE_ANON_KEY below is the PUBLIC "anon" key — safe to
//   ship in client code, it grants no access by itself. Every
//   table it touches MUST have Row Level Security (RLS) enabled
//   with policies keyed to auth.uid() (see setup.sql) — that is
//   what actually keeps user data private, not this key being
//   secret. NEVER put the "service_role" key in any file that
//   reaches the browser — that key bypasses RLS entirely.
// ============================================================
(function () {
  'use strict';

  const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR-PUBLIC-ANON-KEY';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error(
      'Supabase SDK not loaded — check that the supabase-js <script> tag ' +
      'from cdn.jsdelivr.net comes BEFORE assets/supabaseClient.js in your HTML.'
    );
  }

  // Reassigns window.supabase from "the SDK namespace" to "the
  // actual configured client". Every file loaded after this one
  // that reads window.supabase gets the real client.
  window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
