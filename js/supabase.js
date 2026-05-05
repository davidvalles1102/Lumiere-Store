// ─────────────────────────────────────────────
// Lumière — Supabase client: Auth + DB
// ─────────────────────────────────────────────

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ══════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════

export async function fetchProducts(category = null) {
  let query = supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (category && category !== 'All') {
    if (category === 'Sale') {
      query = query.not('original_price', 'is', null);
    } else {
      query = query.eq('category', category);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchProduct(id) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// ══════════════════════════════════════════════
// CART  (server-side for logged-in users)
// ══════════════════════════════════════════════

export async function fetchCart(userId) {
  const { data, error } = await supabase
    .from('cart_items')
    .select(`
      id, qty, size,
      products (id, name, category, price, original_price, images, sizes)
    `)
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function upsertCartItem(userId, productId, qty, size = null) {
  const { data, error } = await supabase
    .from('cart_items')
    .upsert(
      { user_id: userId, product_id: productId, qty, size },
      { onConflict: 'user_id,product_id,size' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCartQty(cartItemId, qty) {
  if (qty <= 0) return deleteCartItem(cartItemId);
  const { error } = await supabase
    .from('cart_items')
    .update({ qty })
    .eq('id', cartItemId);
  if (error) throw error;
}

export async function deleteCartItem(cartItemId) {
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', cartItemId);
  if (error) throw error;
}

export async function clearCart(userId) {
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

// Merge localStorage guest cart into Supabase on login
export async function mergeGuestCart(userId, guestItems) {
  if (!guestItems.length) return;
  const upserts = guestItems.map(item => ({
    user_id: userId,
    product_id: item.id,
    qty: item.qty,
    size: item.selectedSize ?? null,
  }));
  const { error } = await supabase
    .from('cart_items')
    .upsert(upserts, { onConflict: 'user_id,product_id,size' });
  if (error) console.warn('mergeGuestCart error:', error);
}

// ══════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════

export async function fetchOrders(userId) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, status, total, currency, created_at,
      order_items (name, price, qty, size, image)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchOrderBySession(sessionId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('stripe_session_id', sessionId)
    .single();
  if (error) throw error;
  return data;
}
