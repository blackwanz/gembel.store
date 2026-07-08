/* ============================================================
   PLACEHOLDER — assets/auth.js was referenced by nearly every
   page (index.html, dashboard.html, admin.html, apps/habbit/,
   apps/calendar/, apps/progbar/) but was never included in any
   upload, so its real content isn't available here.

   Paste your existing assets/auth.js content into this file.

   Based on what every page actually calls, it needs to export
   (as plain global functions, matching how the pages call them):

     requireAuth(redirectPath)        - bounce to redirectPath if
                                         not logged in, else return
                                         { user, profile }
     requireAdmin(redirectPath)       - like requireAuth but also
                                         checks role === 'admin'
     requireAuthOrGuest(redirectPath) - like requireAuth but allows
                                         a guest/demo session too,
                                         returns { user, profile, isGuest }
     getSessionUser()                 - current supabase auth user
                                         or null
     getProfile(userId)               - fetch the profiles row
     isElite(profile)                 - bool, elite/paid plan check
     initials(name)                   - "Budi Santoso" -> "BS"
     escapeHtml(str)                  - XSS-safe HTML escaping
     fmtRelativeTime(iso)             - "2 jam lalu" style formatting
     logout()                         - supabase.auth.signOut() + redirect
     openPaymentModal(profile, onDone)- Elite upgrade payment flow
     validatePasswordStrength(pw)     - returns an error string or
                                         falsy if the password is OK
     toggleTheme()                    - flips light/dark on <html>,
                                         used by index.html + dashboard.html
     exitGuestDemo()                  - clears guest/demo session data,
                                         used by calendar.html's banner
                                         (apps/progbar/progbar.js already
                                         defines its OWN exitGuestDemo,
                                         so progbar doesn't depend on
                                         this one)

   Until the real file is dropped in, every page that calls these
   will throw "X is not defined" in the console and the auth guard
   will not run.
   ============================================================ */
