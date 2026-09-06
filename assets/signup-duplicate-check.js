// assets/signup-duplicate-check.js
//
// Fixes a silent signup UX gap without touching auth.js itself (same "observe/wrap from the
// outside" approach as payment-qr.js -- auth.js is a minified production build, too risky to
// hand-edit blind).
//
// Supabase's signUp() does NOT return an error when the email already belongs to an existing,
// already-confirmed account -- it just returns success with that account's real user object
// (session: null), so auth.js proceeded straight to "check your email for a code" as if this
// were a brand-new signup. There was no "this email is already registered, log in instead"
// message anywhere. (A *genuinely* unconfirmed existing account is a different, legitimate
// case -- Supabase resends the confirmation code for that one on purpose, and this deliberately
// leaves that path alone.)
//
// Detected here by the returned user's created_at being from well before this call (a real new
// signup's created_at is ~now); if it looks pre-existing, tell the user and send them to the
// login tab instead of letting auth.js continue to the OTP screen.

(function () {
  if (!window.supabase || !supabase.auth || typeof supabase.auth.signUp !== 'function') return;

  const originalSignUp = supabase.auth.signUp.bind(supabase.auth);
  const PRE_EXISTING_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes -- generous margin, a fresh signup's created_at is milliseconds old

  supabase.auth.signUp = async function (...args) {
    const result = await originalSignUp(...args);
    const user = result && result.data && result.data.user;

    if (!result.error && user && user.created_at) {
      const ageMs = Date.now() - new Date(user.created_at).getTime();
      if (ageMs > PRE_EXISTING_THRESHOLD_MS) {
        const msg = 'Email ini udah kedaftar sebelumnya. Coba login ya — atau pakai "Lupa password?" kalau lupa passwordnya.';
        if (window.gembelAlert) await window.gembelAlert(msg); else alert(msg);
        if (typeof switchAuthTab === 'function') switchAuthTab('login');
        // Auth.js's own flow only proceeds to the OTP screen when there's no error -- shaping
        // the response as an error here (instead of just returning the real success result) is
        // what actually stops that, on top of the message above.
        return { data: { user: null, session: null }, error: { message: 'Email already registered', name: 'AuthApiError', status: 400 } };
      }
    }
    return result;
  };
})();
