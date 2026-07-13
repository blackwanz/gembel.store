# Gembel PIK — Folder Structure & Organization Guide

## Recommended Folder Layout

```
gembel.store/
├── index.html                 # Login/landing page (entry point)
├── dashboard.html             # Main hub after login — links to 4 apps
├── assets/
│   ├── soft.css              # Shared design system (ALL apps inherit)
│   ├── supabaseClient.js      # Supabase auth config
│   └── [images, fonts, etc]
├── apps/
│   ├── devil/
│   │   ├── devil.html
│   │   ├── devil.css
│   │   └── devil.js
│   ├── meditate/
│   │   ├── meditate.html
│   │   ├── meditate.css
│   │   └── meditate.js
│   ├── portfolio/
│   │   ├── portfolio.html
│   │   ├── portfolio.css
│   │   └── portfolio.js
│   └── trademaster/
│       ├── trademaster.html
│       ├── trademaster.css
│       └── trademaster.js
├── server/
│   └── mt5_bridge.py          # Flask server (run on Windows with MT5)
└── setup.sql                  # Supabase schema setup
```

---

## Why Separate JS & CSS Files Per App?

### ✅ Maintainability
- Bug in **devil.js**? Go straight to `apps/devil/devil.js` — no scrolling through 2000 lines
- Each app is self-contained; changes to meditate don't touch portfolio

### ✅ Reusability
- Want to copy one app to another project? Copy entire `apps/devil/` folder — all dependencies travel with it
- No tangled imports across 10 files

### ✅ Scaling
- Adding a 5th app? Create `apps/newapp/` with `newapp.html`, `newapp.css`, `newapp.js` — done
- Don't need to edit existing files

### ✅ Performance & Caching
- Browser caches `devil.css` separately from `meditate.css`
- If only `devil.js` changes, meditate still uses cached CSS
- Smaller files = faster parse & execute

### ✅ Team Workflow
- One dev works on devil, another on meditate — no merge conflicts
- Clear ownership: "I own the portfolio module"

---

## Shared Design System: `assets/soft.css`

All 4 apps import this file first:

```html
<link rel="stylesheet" href="../../assets/soft.css">
```

Inside `soft.css`:
- **Color tokens**: `--accent`, `--mint`, `--rose`, `--gold`, `--sky`, `--surface`, `--bg`, `--ink`
- **Light/dark variants**: `:root { --bg: white; }` and `[data-theme="dark"] { --bg: #1a1a1a; }`
- **Shared components**: `.btn`, `.card`, `.toast`, `.badge`, `.input`

Each app's own CSS (`devil.css`, `meditate.css`, etc.) layers on top:
- Override colors using tokens
- Add app-specific animations (breathing orb, seek bar, mood colors)
- Keep it minimal — most styling already in `soft.css`

**Light/Dark Toggle**: Dashboard has one toggle button. Changes `[data-theme]` attribute. All 4 apps inherit instantly (no reload needed).

---

## Program Flow: Entry Point to Individual Apps

### Step 1: User Lands on Site
```
https://yourdomain.com/
     ↓
index.html (or auto-redirect)
```

**index.html** does:
- Check Supabase auth (user logged in?)
- If NO → show login form
- If YES → redirect to `dashboard.html`

### Step 2: Dashboard (Hub Page)
```
dashboard.html
├── Navbar
│   ├── User name display
│   ├── Light/Dark toggle (🌙 button)
│   └── Logout button
└── 4 App Cards
    ├── "🕯️ Devil Diary" → <a href="/apps/devil/devil.html">
    ├── "🧘 Meditate" → <a href="/apps/meditate/meditate.html">
    ├── "💼 Portfolio" → <a href="/apps/portfolio/portfolio.html">
    └── "🛡️ Trade Master" → <a href="/apps/trademaster/trademaster.html">
```

### Step 3: User Clicks a Card
```
Click "Devil Diary" 
     ↓
Load /apps/devil/devil.html
     ↓
devil.html loads:
  ├── ../../assets/soft.css
  ├── ./devil.css
  ├── ../../assets/supabaseClient.js
  └── ./devil.js
     ↓
devil.js:
  ├── Check auth (user still logged in?)
  ├── Load Supabase tables (devil diary entries)
  ├── Render UI
  └── Listen for user actions (submit note, toggle dark mode, etc)
     ↓
App runs until user closes or goes back
```

---

## HTML File Paths (Relative Links)

If `devil.html` lives in `apps/devil/`, use **relative paths**:

### ✅ CORRECT

```html
<!-- Import shared design system -->
<link rel="stylesheet" href="../../assets/soft.css">

<!-- Import app's own CSS -->
<link rel="stylesheet" href="./devil.css">

<!-- Import Supabase config -->
<script src="../../assets/supabaseClient.js"></script>

<!-- Import app's own JS -->
<script src="./devil.js" defer></script>
```

### ❌ WRONG

```html
<!-- Absolute paths break on subdomain deploys -->
<link rel="stylesheet" href="/assets/soft.css">

<!-- Wrong folder — soft.css not here -->
<link rel="stylesheet" href="./assets/soft.css">

<!-- Root relative — breaks if site is in subfolder -->
<link rel="stylesheet" href="soft.css">
```

---

## Naming Convention

| File | Naming | Example |
|------|--------|---------|
| App HTML | `{appname}.html` | `devil.html`, `meditate.html` |
| App CSS | `{appname}.css` | `devil.css`, `meditate.css` |
| App JS | `{appname}.js` | `devil.js`, `meditate.js` |
| Shared CSS | `soft.css` | `assets/soft.css` |
| Shared config | `supabaseClient.js` | `assets/supabaseClient.js` |
| Backend server | `{purpose}_bridge.py` | `mt5_bridge.py` |

---

## Adding a 5th App (Later)

1. Create folder:
   ```
   apps/newapp/
   ```

2. Create three files:
   ```
   newapp.html
   newapp.css
   newapp.js
   ```

3. In `newapp.html`:
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <link rel="stylesheet" href="../../assets/soft.css">
     <link rel="stylesheet" href="./newapp.css">
   </head>
   <body>
     <!-- Your UI here -->
     <script src="../../assets/supabaseClient.js"></script>
     <script src="./newapp.js" defer></script>
   </body>
   </html>
   ```

4. In `newapp.css`:
   ```css
   /* App-specific styles only */
   /* Reuse tokens from soft.css: var(--accent), var(--surface), etc */
   ```

5. In `newapp.js`:
   ```javascript
   // App logic here
   // Access supabase via window.supabase (from supabaseClient.js)
   ```

6. Add card to `dashboard.html`:
   ```html
   <a href="/apps/newapp/newapp.html" class="app-card">
     <h3>✨ New App</h3>
     <p>Description</p>
   </a>
   ```

**Done.** No other files touched. This is the power of modular structure.

---

## Current Project Status

The redesign `.zip` you received already follows this structure:
- ✅ 4 apps in separate folders under `apps/`
- ✅ HTML at root of each app folder
- ✅ CSS & JS separate files
- ✅ Shared `assets/soft.css` with all design tokens
- ✅ Dashboard placeholder ready for you to customize

Just extract, follow the paths, and you're ready to deploy. 🚀
