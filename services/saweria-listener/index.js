// saweria-listener
//
// Saweria has no official API/webhook for "a donation of exactly X just came in" -- the only
// realtime signal is the websocket their own OBS alert-box widget connects to, reverse-engineered
// by the community (see README.md's "Verifying the endpoint" section; this can change or break
// without notice). This process:
//
//   1. Connects to that socket with the account's streamKey.
//   2. On each donation event, looks for a payment_requests row with status='pending' and
//      amount === the donation amount (assets/payment-saweria.js is what makes that amount
//      unique per request -- see db/migrations/0018_payment_unique_code.sql).
//   3. If found, does exactly what admin.html's manual "Konfirmasi" button does:
//      update({ status: 'confirmed', paid_at: now() }). Nothing else -- whatever downstream
//      effect confirming a payment has today, this triggers the same way a human click would.
//   4. Separately, on a timer, flips any pending row whose expires_at has passed to 'expired' so
//      its amount can be reused by a later request instead of colliding forever.
//
// Uses the service_role key (bypasses RLS) since it must update rows that don't belong to it.
// If the socket connection or the match fails for any reason, the row just stays 'pending' and
// falls back to the existing manual-admin-confirm path (assets/payment-qr.js) -- this process
// never being the ONLY way to confirm a payment is the point.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { io } = require('socket.io-client');
const WebSocket = require('ws'); // supabase-js's Realtime client throws at construction on
                                  // Node < 22 without this, even though we never use Realtime here

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SAWERIA_STREAM_KEY,
  SAWERIA_SOCKET_URL = 'wss://events.saweria.co',
  SWEEP_INTERVAL_MS = '60000',
} = process.env;

for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SAWERIA_STREAM_KEY })) {
  if (!value) {
    console.error(`[saweria-listener] Missing required env var ${name} -- copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket },
});

async function confirmPaymentForAmount(amount) {
  const { data, error } = await supabase
    .from('payment_requests')
    .update({ status: 'confirmed', paid_at: new Date().toISOString() })
    .eq('status', 'pending')
    .eq('amount', amount)
    .gt('expires_at', new Date().toISOString())
    .select('id, user_id');

  if (error) {
    console.error('[saweria-listener] Failed to update payment_requests for amount', amount, error.message);
    return;
  }
  if (!data || data.length === 0) {
    console.log(`[saweria-listener] Donation of ${amount} received but no matching pending request (unmatched or already expired) -- left for manual admin confirmation.`);
    return;
  }
  console.log(`[saweria-listener] Confirmed payment_request ${data[0].id} (user ${data[0].user_id}) for amount ${amount}.`);
}

async function sweepExpired() {
  const { data, error } = await supabase
    .from('payment_requests')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[saweria-listener] Sweep failed:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.log(`[saweria-listener] Expired ${data.length} stale pending request(s).`);
  }
}

// ---- Payload shape ----
// Confirmed by capturing the real widget socket's DevTools frames (2026-09-06) -- the amount is
// NOT a top-level `payload.amount` like early guesses assumed. Two message shapes were observed:
//
//   { type: 'donation', data: [{ id, donator, amount, currency, ... }] }   -- a fresh donation
//   { type: 'sync', channel: 'donation', queue: [{ id, donator, amount, ... }] }  -- replayed on
//                                                                              (re)connect
//
// Both are handled the same way below since confirmPaymentForAmount() only ever touches rows
// still 'pending', so replaying an already-confirmed donation via 'sync' is a harmless no-op.
const seenDonationIds = new Set(); // avoid logging/processing the exact same donation id twice per run
function extractDonations(msg) {
  if (!msg || typeof msg !== 'object') return [];
  if (msg.type === 'donation' && Array.isArray(msg.data)) return msg.data;
  if (msg.type === 'sync' && Array.isArray(msg.queue)) return msg.queue;
  return [];
}

function handleMessage(eventName, msg) {
  const donations = extractDonations(msg);
  if (donations.length === 0) return; // not a donation/sync message (or unrecognized shape) -- ignore
  for (const d of donations) {
    const amount = Number(d && d.amount);
    if (!Number.isFinite(amount)) {
      console.warn('[saweria-listener] Donation entry with no usable amount:', d);
      continue;
    }
    if (d.id && seenDonationIds.has(d.id)) continue;
    if (d.id) seenDonationIds.add(d.id);
    console.log(`[saweria-listener] Donation seen (event="${eventName}", donator="${d.donator}", amount=${amount}).`);
    confirmPaymentForAmount(amount).catch((err) => console.error('[saweria-listener] confirmPaymentForAmount threw:', err));
  }
}

// ---- Socket connection ----
// SAWERIA_SOCKET_URL/query shape below is still the commonly-guessed part that hasn't been
// captured yet -- if `connect_error` keeps firing, that's the piece to re-check in DevTools
// (Network -> WS -> click the connection -> Headers -> Request URL) rather than the message
// parsing above, which is now based on real captured frames.
function connect() {
  const socket = io(SAWERIA_SOCKET_URL, {
    query: { streamKey: SAWERIA_STREAM_KEY },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
  });

  socket.on('connect', () => {
    console.log('[saweria-listener] Connected to Saweria socket.');
  });

  // onAny instead of a specific event name: the captured frames show the payload distinguishes
  // itself via its own `type` field rather than a distinct socket.io event name we could confirm,
  // so this catches whatever event it actually arrives as and lets handleMessage() decide.
  socket.onAny((eventName, msg) => handleMessage(eventName, msg));

  socket.on('disconnect', (reason) => {
    console.warn('[saweria-listener] Disconnected:', reason, '-- socket.io will auto-reconnect.');
  });

  socket.on('connect_error', (err) => {
    console.error('[saweria-listener] Connection error:', err.message);
  });

  return socket;
}

connect();
setInterval(() => sweepExpired().catch((err) => console.error('[saweria-listener] sweepExpired threw:', err)), Number(SWEEP_INTERVAL_MS));
console.log('[saweria-listener] Started. Sweeping expired requests every', SWEEP_INTERVAL_MS, 'ms.');
