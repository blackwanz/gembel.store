# saweria-listener

Persistent Node.js process that auto-confirms `payment_requests` rows the moment a matching
donation comes into your Saweria account, instead of waiting for an admin to manually click
"Konfirmasi" in `admin.html`.

**This relies on an unofficial, reverse-engineered Saweria endpoint.** Saweria has no public API
or webhook for donation events — the only realtime signal is the websocket their own OBS
alert-box widget connects to. It can change or stop working without any notice from Saweria.
Nothing else in the payment flow depends on this process staying alive: if it's down, requests
just sit as `pending` and the existing manual-admin-confirm path (`assets/payment-qr.js`,
`admin.html`) still works exactly as before.

## How it fits together

1. A user opens the payment modal → `assets/payment-saweria.js` (loaded in `dashboard.html` /
   `index.html`) patches the Supabase insert to append a random 0-999 "unique code" onto the
   tier price (e.g. 19999 → 20348) and shows that exact number to the user, since Saweria's
   donation event only reports an amount — no user id.
2. The user pays that exact amount to your Saweria account (QRIS or any method Saweria accepts).
3. This process, listening to Saweria's widget socket, sees the donation, finds the one
   `pending` row with that exact `amount`, and updates it to `confirmed` — the same DB write
   `admin.html`'s manual button already does.
4. `assets/payment-saweria.js` is subscribed via Supabase Realtime to that row and reacts the
   moment it flips.

See `db/migrations/0018_payment_unique_code.sql` for the schema (`base_amount`, `unique_code`,
`expires_at`, `paid_at` columns + a partial unique index that keeps two pending requests from
ever landing on the same amount at once).

## The endpoint (confirmed 2026-09-06, but can still drift)

Captured directly from a real widget's DevTools Network tab against a live account:

- **Connection**: plain WebSocket (NOT Socket.IO — no Engine.IO framing), `GET` upgrading to
  `101 Switching Protocols`, at `wss://events.saweria.co/stream?streamKey=<your stream key>`.
- **Message shape** (JSON text frames), two variants seen:
  ```json
  { "type": "donation", "data": [{ "id": "...", "donator": "test", "amount": 19999, "currency": "IDR" }] }
  ```
  ```json
  { "type": "sync", "channel": "donation", "queue": [{ "id": "...", "donator": "test", "amount": 19999, ... }] }
  ```
  `sync` replays recent donations on (re)connect — `index.js` handles both the same way, since
  re-processing an already-confirmed donation via `sync` is a harmless no-op (it only ever
  updates rows still `status='pending'`).

This is still an undocumented, unofficial endpoint that Saweria could change without notice. If
confirmations silently stop happening, re-verify it the same way:

1. Open your Saweria widget URL (Dashboard → Widget/Overlay) directly in a normal browser tab.
2. DevTools → Network → filter `WS`.
3. Refresh the page, click the one WS connection that appears, check the **Headers** tab's
   **Request URL** against `SAWERIA_SOCKET_URL` in `.env`.
4. Send a small test donation, watch the **Messages** tab for the incoming frame, and check its
   shape still matches `extractDonations()` in `index.js`.

## Setup

```bash
cd services/saweria-listener
npm install
cp .env.example .env
nano .env   # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SAWERIA_STREAM_KEY
node index.js   # test run in the foreground first
```

`SUPABASE_SERVICE_ROLE_KEY` comes from Supabase dashboard → Project Settings → API →
`service_role` key. It bypasses Row Level Security (needed here, since this process updates rows
that belong to other users) — treat it like a root password: never commit `.env`, never expose
it to the browser/client.

## Running it persistently on the VPS (systemd)

```ini
# /etc/systemd/system/saweria-listener.service
[Unit]
Description=Saweria donation listener for gembel.store payments
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/gembel.store/services/saweria-listener
ExecStart=/usr/bin/node index.js
EnvironmentFile=/var/www/gembel.store/services/saweria-listener/.env
Restart=always
RestartSec=5
User=irwanto

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now saweria-listener
sudo systemctl status saweria-listener
journalctl -u saweria-listener -f   # live logs, e.g. to watch a real donation get matched
```

Note this runs from `/var/www/gembel.store`, which the deploy workflow replaces via a symlink
swap on every push (see `db/README.md`) — `.env` living inside that tree means **it must be
re-created (or symlinked from outside the releases folder) after the first deploy that includes
this service**, since a fresh release directory won't carry over the previous one's `.env`.
Simplest fix: keep the real `.env` at a stable path outside `/var/www/releases` (e.g.
`/etc/gembel-saweria-listener.env`) and point `EnvironmentFile` at that instead.

## Operational notes

- **Collisions**: the partial unique index on `payment_requests(amount) where status='pending'`
  means if two users are ever assigned the same amount at once, the second insert fails outright
  — which surfaces through the *existing* "Gagal bikin tagihan" alert path and falls back to the
  static QRIS + manual-admin-confirm flow (`assets/payment-qr.js`). With a 0-999 code range this
  should be rare at this app's scale; narrow further only if it isn't.
- **Expiry**: pending rows older than 15 minutes are flipped to `expired` on a 1-minute sweep, so
  their amount frees up. Not configurable from the UI yet — change `EXPIRES_MS` in
  `assets/payment-saweria.js` and keep it consistent with intent, though the DB doesn't otherwise
  care what the window is.
- **This process never rejects a payment** — only Saweria-side donations confirm rows, and only
  the admin UI rejects them. If it crashes, restart it; it doesn't hold any in-memory state that
  needs to survive a restart (the DB is the only source of truth).
