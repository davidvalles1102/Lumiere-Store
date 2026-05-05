// ─────────────────────────────────────────────
// Lumière — Stripe Checkout
// ─────────────────────────────────────────────

import { CHECKOUT_FUNCTION_URL, PAYMENT_SUCCESS_URL, PAYMENT_CANCEL_URL } from './config.js';
import { supabase } from './supabase.js';

// Redirects the browser to a Stripe-hosted checkout page.
// `cartItems` — array of cart items (from state or Supabase)
export async function redirectToCheckout(cartItems) {
  if (!cartItems || cartItems.length === 0) {
    throw new Error('Cart is empty.');
  }

  // Normalise items — works with both local state and Supabase cart shape
  const items = cartItems.map(item => {
    const product = item.products ?? item;   // Supabase join vs. local state
    return {
      product_id: product.id,
      name: product.name,
      price: Number(product.price),
      qty: item.qty,
      size: item.size ?? item.selectedSize ?? null,
      image: Array.isArray(product.images) ? product.images[0] : product.img ?? null,
    };
  });

  // Get auth token if logged in (optional — works for guests too)
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };

  const res = await fetch(CHECKOUT_FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      items,
      success_url: PAYMENT_SUCCESS_URL,
      cancel_url: PAYMENT_CANCEL_URL,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Checkout failed (${res.status})`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('No checkout URL returned.');

  // Redirect to Stripe-hosted payment page
  window.location.href = url;
}

// Reads ?payment=success|cancelled from the URL after redirect back
export function getPaymentResult() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('payment');
  const sessionId = params.get('session_id');
  // Clean up URL without reloading the page
  if (result) {
    const clean = window.location.pathname;
    window.history.replaceState({}, '', clean);
  }
  return { result, sessionId };
}
