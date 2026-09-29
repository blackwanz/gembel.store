// assets/site-config.js
//
// Small set of editable constants other scripts reference (currently just
// assets/payment-qr.js) -- centralized here instead of hardcoded inline so
// changing one (a new admin WhatsApp number, etc.) never means hunting
// through a feature-specific file to find where it's buried.

window.SITE_CONFIG = {
  // Admin WhatsApp number for the "I've transferred, please confirm" button on the payment
  // modal. Digits only is safest (country code + number, no +/spaces/dashes) but
  // assets/payment-qr.js strips non-digits before building the wa.me link anyway, so any
  // format works here.
  whatsappAdminNumber: '+62895331699681',

  // Elite price per month, used by the month picker in assets/payment-saweria.js (member can pay
  // for several months at once). Must match public.elite_price_per_month() in
  // db/migrations/0047_payment_months_and_prize_income.sql -- the DB uses it to cap how many
  // months a confirmed payment is actually worth.
  elitePricePerMonth: 29999,
};
