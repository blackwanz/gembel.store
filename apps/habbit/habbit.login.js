// ============================================================
// HABBIT — auth functionality (classic-script build).
// Load AFTER habbit.config.js.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};
  const { supabase } = window.Habbit.config;

  async function requireAuth(redirectTo) {
    const { data, error } = await supabase.auth.getSession();
    const session = data && data.session;
    if (error || !session) {
      window.location.href = redirectTo || 'index.html';
      return null;
    }
    const user = session.user;
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles').select('*').eq('id', user.id).single();
    if (profileError) console.error('profile fetch failed:', profileError);
    return { user, profile: profile || null };
  }

  async function logout(redirectTo) {
    await supabase.auth.signOut();
    window.location.href = redirectTo || 'index.html';
  }

  window.Habbit.login = { requireAuth, logout };
})();
