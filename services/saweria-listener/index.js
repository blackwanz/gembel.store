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

// ---- Socket connection ----
// NOTE: event name and payload shape ('donation', payload.amount) are the commonly-observed
// values for Saweria's widget socket as of when this was written -- verify against your own
// account before trusting this in production (see README.md).
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

  socket.on('donation', (payload) => {
    const amount = Number(payload && payload.amount);
    if (!Number.isFinite(amount)) {
      console.warn('[saweria-listener] Ignoring donation event with unrecognized payload shape:', payload);
      return;
    }
    console.log('[saweria-listener] Donation event:', payload);
    confirmPaymentForAmount(amount).catch((err) => console.error('[saweria-listener] confirmPaymentForAmount threw:', err));
  });

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
