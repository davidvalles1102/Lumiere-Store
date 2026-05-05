// ─────────────────────────────────────────────
// Lumière — Backend Configuration
// Replace the placeholder values below with your
// real keys from Supabase and Stripe dashboards.
// ─────────────────────────────────────────────

export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Stripe publishable key (safe to expose in frontend)
export const STRIPE_PUBLISHABLE_KEY = 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY';

// URL of your deployed create-checkout Edge Function
export const CHECKOUT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-checkout`;

// Redirect URLs after Stripe payment
// window.location.origin is "null" for file:// — fall back to relative path
const _origin = (window.location.origin && window.location.origin !== 'null')
  ? window.location.origin
  : '';
export const PAYMENT_SUCCESS_URL = `${_origin}/index.html?payment=success`;
export const PAYMENT_CANCEL_URL  = `${_origin}/index.html?payment=cancelled`;
