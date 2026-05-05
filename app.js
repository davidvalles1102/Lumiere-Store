'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIGURATION — paste your real keys here to enable the backend
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://cjqtchwfoypqsqifhpxc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YKpcOWEYAgd41uDZoo9XHg_iu94QqPN';
const CHECKOUT_FN_URL   = SUPABASE_URL + '/functions/v1/create-checkout';

// Returns true only when real keys have been filled in
function isConfigured() {
  return !SUPABASE_URL.startsWith('YOUR_') && !SUPABASE_ANON_KEY.startsWith('YOUR_');
}

// ─────────────────────────────────────────────────────────────
// SUPABASE CLIENT  (initialised lazily after DOM ready)
// ─────────────────────────────────────────────────────────────
let _sb = null;
function sb() {
  if (!isConfigured()) return null;
  if (!_sb) {
    if (typeof window.supabase === 'undefined') {
      console.warn('Supabase SDK not loaded yet.');
      return null;
    }
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _sb;
}

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let currentUser   = null;
let cart          = [];
let productsCache = [];
let currentSlide  = 0;
let slideInterval;

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  startSlideshow();
  initScrollHeader();
  initSmoothScroll();
  initIntersectionObserver();

  if (isConfigured()) {
    // Watch auth state — fires immediately with current session
    sb().auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user ?? null;
      updateAuthUI(currentUser);
      if (currentUser) {
        await loadServerCart(currentUser.id);
      } else {
        loadGuestCart();
      }
    });
  } else {
    updateAuthUI(null);
    loadGuestCart();
  }

  await loadProducts('All');

  // Handle Stripe redirect back to the page
  const params   = new URLSearchParams(window.location.search);
  const payment  = params.get('payment');
  if (payment === 'success') {
    window.history.replaceState({}, '', window.location.pathname);
    showToast('Payment successful! Your order has been placed. 🎉');
    if (currentUser) await loadServerCart(currentUser.id);
    else { localStorage.removeItem('lumiere_cart'); cart = []; updateCartUI(); }
  } else if (payment === 'cancelled') {
    window.history.replaceState({}, '', window.location.pathname);
    showToast('Checkout cancelled. Your cart is still saved.');
  }
});

// ─────────────────────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────────────────────
async function loadProducts(category) {
  if (isConfigured()) {
    try {
      let query = sb().from('products').select('*').eq('active', true).order('created_at', { ascending: false });
      if (category && category !== 'All') {
        if (category === 'Sale') query = query.not('original_price', 'is', null);
        else query = query.eq('category', category);
      }
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      const { data, error } = await Promise.race([query, timeout]);
      if (error) throw error;
      if (data && data.length) {
        productsCache = data;
        renderProducts(data);
        return;
      }
    } catch (err) {
      console.warn('Products fetch failed, using static data:', err.message);
    }
  }
  // Static fallback
  const filtered = category === 'All'  ? STATIC_PRODUCTS
    : category === 'Sale' ? STATIC_PRODUCTS.filter(p => p.original_price)
    : STATIC_PRODUCTS.filter(p => p.category === category);
  productsCache = filtered;
  renderProducts(filtered);
}

function renderProducts(products) {
  const grid = document.getElementById('products-grid');
  if (!products || !products.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#6b7280;padding:40px 0">No products found.</p>';
    return;
  }
  grid.innerHTML = products.map((p, i) => {
    const img          = Array.isArray(p.images) ? p.images[0] : (p.img || '');
    const origPrice    = p.original_price ?? p.originalPrice ?? null;
    const reviewCount  = p.review_count  ?? p.reviews ?? 0;
    const discount     = origPrice ? Math.round((1 - p.price / origPrice) * 100) : 0;
    const badgeClass   = p.badge ? 'badge-' + p.badge.toLowerCase().replace(' ', '') : '';
    return `
    <div class="product-card" style="animation-delay:${i * .07}s" onclick="openModal('${p.id}')">
      <div class="product-image-wrap">
        <img src="${img}" alt="${p.name}" loading="lazy" />
        ${p.badge ? `<span class="product-badge ${badgeClass}">${p.badge}</span>` : ''}
        <div class="product-actions" onclick="event.stopPropagation()">
          <button class="btn" onclick="addToCart('${p.id}', event)">Add to Cart</button>
          <button class="btn btn-wish" title="Wishlist" onclick="toggleWishlist(this)">♡</button>
        </div>
      </div>
      <div class="product-body">
        <p class="product-category">${p.category}</p>
        <h3 class="product-name">${p.name}</h3>
        <div class="product-rating">
          <span class="stars">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</span>
          <span class="count">${p.rating} (${reviewCount})</span>
        </div>
        <div class="product-price">
          <span class="price">$${Number(p.price).toFixed(2)}</span>
          ${origPrice ? `<span class="original">$${origPrice}</span><span class="discount">${discount}% off</span>` : ''}
        </div>
        <div class="color-dots">
          ${(p.colors || []).map(c => `<span class="color-dot" style="background:${c}"></span>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterProducts(category, btn) {
  if (btn) {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  loadProducts(category);
  if (btn) document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────────────────────
// CART
// ─────────────────────────────────────────────────────────────
async function loadServerCart(userId) {
  try {
    const { data, error } = await sb()
      .from('cart_items')
      .select('id, qty, size, products(id, name, category, price, original_price, images)')
      .eq('user_id', userId);
    if (error) throw error;
    cart = data.map(r => ({
      cartItemId : r.id,
      id         : r.products.id,
      name       : r.products.name,
      category   : r.products.category,
      price      : Number(r.products.price),
      img        : r.products.images?.[0] || '',
      qty        : r.qty,
      size       : r.size,
    }));
    updateCartUI();
  } catch (err) {
    console.warn('loadServerCart error:', err.message);
    loadGuestCart();
  }
}

function loadGuestCart() {
  try { cart = JSON.parse(localStorage.getItem('lumiere_cart') || '[]'); }
  catch { cart = []; }
  updateCartUI();
}

function saveGuestCart() {
  localStorage.setItem('lumiere_cart', JSON.stringify(cart));
}

async function addToCart(productId, event) {
  if (event) event.stopPropagation();
  const product = productsCache.find(p => String(p.id) === String(productId))
    || STATIC_PRODUCTS.find(p => String(p.id) === String(productId));
  if (!product) return;

  // Always add to local cart immediately so the UI updates right away
  const existing = cart.find(i => String(i.id) === String(productId));
  if (existing) {
    existing.qty++;
  } else {
    const img = Array.isArray(product.images) ? product.images[0] : (product.img || '');
    cart.push({ id: product.id, name: product.name, category: product.category,
                price: Number(product.price), img, qty: 1, size: null });
  }
  saveGuestCart();
  updateCartUI();
  showToast('"' + product.name + '" added to cart');

  // Sync to server in the background if logged in (requires cart_items table)
  if (isConfigured() && currentUser) {
    const newQty = cart.find(i => String(i.id) === String(productId))?.qty || 1;
    const timer  = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 4000));
    Promise.race([
      sb().from('cart_items').upsert(
        { user_id: currentUser.id, product_id: productId, qty: newQty, size: null },
        { onConflict: 'user_id,product_id,size' }
      ),
      timer,
    ]).catch(err => console.warn('Server cart sync skipped:', err.message));
  }
}

async function changeQty(key, delta) {
  const item   = cart.find(i => String(i.cartItemId || i.id) === String(key));
  if (!item) return;
  const newQty = item.qty + delta;

  if (isConfigured() && currentUser && item.cartItemId) {
    try {
      if (newQty <= 0) {
        await sb().from('cart_items').delete().eq('id', item.cartItemId);
      } else {
        await sb().from('cart_items').update({ qty: newQty }).eq('id', item.cartItemId);
      }
      await loadServerCart(currentUser.id);
    } catch (err) { showToast('Error updating cart'); }
  } else {
    if (newQty <= 0) { cart = cart.filter(i => String(i.id) !== String(key)); }
    else { item.qty = newQty; }
    saveGuestCart();
    updateCartUI();
  }
}

async function removeFromCart(key) {
  const item = cart.find(i => String(i.cartItemId || i.id) === String(key));
  if (!item) return;

  if (isConfigured() && currentUser && item.cartItemId) {
    try {
      await sb().from('cart_items').delete().eq('id', item.cartItemId);
      await loadServerCart(currentUser.id);
    } catch (err) { showToast('Error removing item'); }
  } else {
    cart = cart.filter(i => String(i.cartItemId || i.id) !== String(key));
    saveGuestCart();
    updateCartUI();
  }
}

function updateCartUI() {
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  const subtotal   = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const countEl = document.getElementById('cart-count');
  countEl.textContent = totalItems;
  countEl.classList.toggle('visible', totalItems > 0);
  document.getElementById('cart-total-items').textContent = totalItems;
  document.getElementById('cart-subtotal').textContent    = '$' + subtotal.toFixed(2);

  const itemsEl  = document.getElementById('cart-items');
  const footerEl = document.getElementById('cart-footer');

  if (!cart.length) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <svg width="64" height="64" fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        <p>Your cart is empty</p>
        <button onclick="closeCart()" class="btn btn-outline">Continue Shopping</button>
      </div>`;
    footerEl.style.display = 'none';
  } else {
    itemsEl.innerHTML = cart.map(item => {
      const key = item.cartItemId || item.id;
      return `
      <div class="cart-item">
        <div class="cart-item-img"><img src="${item.img}" alt="${item.name}"/></div>
        <div class="cart-item-info">
          <p class="cart-item-name">${item.name}</p>
          <p class="cart-item-meta">${item.category}${item.size ? ' · ' + item.size : ''}</p>
          <div class="cart-item-controls">
            <button class="qty-btn" onclick="changeQty('${key}', -1)">−</button>
            <span class="cart-item-qty">${item.qty}</span>
            <button class="qty-btn" onclick="changeQty('${key}', 1)">+</button>
            <span class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</span>
          </div>
          <span class="cart-item-remove" onclick="removeFromCart('${key}')">Remove</span>
        </div>
      </div>`;
    }).join('');
    footerEl.style.display = 'flex';
  }
}

function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('cart-btn').addEventListener('click', openCart);

// ─────────────────────────────────────────────────────────────
// CHECKOUT
// ─────────────────────────────────────────────────────────────
async function handleCheckout() {
  if (!cart.length) { showToast('Your cart is empty'); return; }

  if (!isConfigured()) {
    showToast('Add your Supabase & Stripe keys in app.js to enable checkout');
    return;
  }

  const btn = document.getElementById('checkout-btn');
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  try {
    const items = cart.map(item => ({
      product_id : item.id,
      name       : item.name,
      price      : item.price,
      qty        : item.qty,
      size       : item.size || null,
      image      : item.img  || null,
    }));

    const { data: { session } } = isConfigured() ? await sb().auth.getSession() : { data: { session: null } };
    const headers = {
      'Content-Type' : 'application/json',
      ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}),
    };

    const origin  = (window.location.origin === 'null' ? '' : window.location.origin);
    const res = await fetch(CHECKOUT_FN_URL, {
      method  : 'POST',
      headers,
      body    : JSON.stringify({
        items,
        success_url : origin + '/index.html?payment=success',
        cancel_url  : origin + '/index.html?payment=cancelled',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Checkout failed (' + res.status + ')');
    }
    const { url } = await res.json();
    if (url) window.location.href = url;

  } catch (err) {
    showToast(err.message);
    btn.textContent = 'Checkout';
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
function updateAuthUI(user) {
  const btn      = document.getElementById('auth-btn');
  const dropdown = document.getElementById('account-dropdown');
  if (user) {
    btn.style.color = 'var(--accent)';
    btn.onclick = () => dropdown.classList.toggle('open');
    document.getElementById('account-name').textContent  = (user.user_metadata && user.user_metadata.full_name) || 'My Account';
    document.getElementById('account-email').textContent = user.email || '';
  } else {
    btn.style.color = '';
    btn.onclick = () => openAuthModal('login');
    dropdown.classList.remove('open');
  }
}

function openAuthModal(tab) {
  document.getElementById('auth-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('auth-signup').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('login-error').textContent  = '';
  document.getElementById('signup-error').textContent = '';
  document.getElementById('auth-overlay').classList.add('open');
  document.getElementById('auth-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuthModal() {
  document.getElementById('auth-overlay').classList.remove('open');
  document.getElementById('auth-modal').classList.remove('open');
  document.body.style.overflow = '';
}

async function handleLogin(e) {
  e.preventDefault();
  if (!isConfigured()) { showToast('Add Supabase keys in app.js to enable login'); return; }

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-submit');
  errEl.textContent = '';
  btn.textContent = 'Signing in…'; btn.disabled = true;

  try {
    const guestCart = cart.slice();
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Merge guest cart
    if (guestCart.length && currentUser) {
      const upserts = guestCart.map(i => ({ user_id: currentUser.id, product_id: i.id, qty: i.qty, size: i.size || null }));
      await sb().from('cart_items').upsert(upserts, { onConflict: 'user_id,product_id,size' });
      localStorage.removeItem('lumiere_cart');
    }
    closeAuthModal();
    showToast('Welcome back!');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
}

async function handleSignup(e) {
  e.preventDefault();
  if (!isConfigured()) { showToast('Add Supabase keys in app.js to enable sign up'); return; }

  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl    = document.getElementById('signup-error');
  const btn      = document.getElementById('signup-submit');
  errEl.textContent = '';
  btn.textContent = 'Creating account…'; btn.disabled = true;

  try {
    const { error } = await sb().auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) throw error;
    closeAuthModal();
    showToast('Account created! Check your email to confirm.');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.textContent = 'Create Account'; btn.disabled = false;
  }
}

async function handleSignOut() {
  document.getElementById('account-dropdown').classList.remove('open');
  if (isConfigured()) await sb().auth.signOut();
  currentUser = null;
  cart = [];
  updateCartUI();
  updateAuthUI(null);
  showToast("You've been signed out.");
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('auth-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('account-dropdown').classList.remove('open');
  }
});

// ─────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────
async function showOrders() {
  document.getElementById('account-dropdown').classList.remove('open');
  if (!currentUser) { openAuthModal('login'); return; }

  document.getElementById('orders-overlay').classList.add('open');
  document.getElementById('orders-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  const listEl = document.getElementById('orders-list');
  listEl.innerHTML = '<p style="color:#6b7280">Loading orders…</p>';

  try {
    const { data, error } = await sb()
      .from('orders')
      .select('id, status, total, currency, created_at, order_items(name, price, qty, size, image)')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (!data.length) {
      listEl.innerHTML = '<p style="color:#6b7280;text-align:center;padding:24px 0">No orders yet. Time to shop!</p>';
      return;
    }
    listEl.innerHTML = data.map(o => `
      <div class="order-card">
        <div class="order-header">
          <div>
            <strong>Order #${o.id.slice(0, 8).toUpperCase()}</strong>
            <span class="order-date">${new Date(o.created_at).toLocaleDateString()}</span>
          </div>
          <span class="order-status status-${o.status}">${o.status}</span>
        </div>
        <div class="order-items-list">
          ${(o.order_items || []).map(i => `
            <div class="order-item">
              ${i.image ? `<img src="${i.image}" alt="${i.name}" />` : ''}
              <span>${i.name}${i.size ? ' (' + i.size + ')' : ''} × ${i.qty}</span>
              <span>$${(i.price * i.qty).toFixed(2)}</span>
            </div>`).join('')}
        </div>
        <div class="order-total">Total: <strong>$${Number(o.total).toFixed(2)}</strong></div>
      </div>`).join('');
  } catch (err) {
    listEl.innerHTML = '<p style="color:var(--error)">' + err.message + '</p>';
  }
}

function closeOrdersModal() {
  document.getElementById('orders-overlay').classList.remove('open');
  document.getElementById('orders-modal').classList.remove('open');
  document.body.style.overflow = '';
}

// ─────────────────────────────────────────────────────────────
// QUICK VIEW MODAL
// ─────────────────────────────────────────────────────────────
function openModal(productId) {
  const p = productsCache.find(pr => String(pr.id) === String(productId))
    || STATIC_PRODUCTS.find(pr => String(pr.id) === String(productId));
  if (!p) return;

  const img        = Array.isArray(p.images) ? p.images[0] : (p.img || '');
  const origPrice  = p.original_price ?? p.originalPrice ?? null;
  const reviewCount = p.review_count  ?? p.reviews ?? 0;

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-img"><img src="${img}" alt="${p.name}" /></div>
    <div class="modal-details">
      <p class="modal-category">${p.category}</p>
      <h2 class="modal-name">${p.name}</h2>
      <div class="product-rating" style="margin-bottom:16px">
        <span class="stars">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</span>
        <span class="count">${p.rating} (${reviewCount} reviews)</span>
      </div>
      <p class="modal-price">$${Number(p.price).toFixed(2)}
        ${origPrice ? `<s style="font-size:.85rem;color:#6b7280;margin-left:8px;font-weight:400">$${origPrice}</s>` : ''}
      </p>
      <p class="modal-desc">${p.description || p.desc || ''}</p>
      <p class="modal-label">Select Size</p>
      <div class="modal-sizes">
        ${(p.sizes || []).map((s, i) => `<button class="size-btn${i === 0 ? ' active' : ''}" onclick="selectSize(this, '${s}')">${s}</button>`).join('')}
      </div>
      <div class="color-dots" style="margin-bottom:24px">
        ${(p.colors || []).map(c => `<span style="background:${c};width:20px;height:20px;border-radius:50%;border:2px solid #e5e7eb;display:inline-block;margin-right:4px"></span>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="addToCart('${p.id}'); closeModal()">Add to Cart — $${Number(p.price).toFixed(2)}</button>
        <button class="btn btn-outline" onclick="toggleWishlistBtn(this)">♡ Add to Wishlist</button>
      </div>
    </div>`;

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('product-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('product-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function selectSize(btn) {
  btn.closest('.modal-sizes').querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ─────────────────────────────────────────────────────────────
// WISHLIST
// ─────────────────────────────────────────────────────────────
function toggleWishlist(btn) {
  const wished = btn.textContent === '♥';
  btn.textContent  = wished ? '♡' : '♥';
  btn.style.color  = wished ? '' : '#ef4444';
  showToast(wished ? 'Removed from wishlist' : 'Added to wishlist ♥');
}
function toggleWishlistBtn(btn) {
  btn.textContent = '♥ Wishlisted';
  btn.style.color = '#ef4444';
  showToast('Added to wishlist ♥');
}

// ─────────────────────────────────────────────────────────────
// HERO SLIDER
// ─────────────────────────────────────────────────────────────
function goToSlide(index) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots   = document.querySelectorAll('.dot');
  slides[currentSlide].classList.remove('active');
  dots[currentSlide].classList.remove('active');
  currentSlide = (index + slides.length) % slides.length;
  slides[currentSlide].classList.add('active');
  dots[currentSlide].classList.add('active');
}
function nextSlide() { goToSlide(currentSlide + 1); resetSlideInterval(); }
function prevSlide() { goToSlide(currentSlide - 1); resetSlideInterval(); }
function startSlideshow()    { slideInterval = setInterval(() => goToSlide(currentSlide + 1), 5000); }
function resetSlideInterval(){ clearInterval(slideInterval); startSlideshow(); }

// ─────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────
document.getElementById('search-btn').addEventListener('click', () => {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('open');
  if (bar.classList.contains('open')) setTimeout(() => document.getElementById('search-input').focus(), 50);
});
function closeSearch() { document.getElementById('search-bar').classList.remove('open'); }
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
  if (e.key === 'Enter' && e.target.value.trim()) showToast('Searching for "' + e.target.value.trim() + '"…');
});

// ─────────────────────────────────────────────────────────────
// HAMBURGER
// ─────────────────────────────────────────────────────────────
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('mobile-nav').classList.toggle('open');
});

// ─────────────────────────────────────────────────────────────
// SCROLL HEADER
// ─────────────────────────────────────────────────────────────
function initScrollHeader() {
  window.addEventListener('scroll', () => {
    document.getElementById('header').classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────
// NEWSLETTER
// ─────────────────────────────────────────────────────────────
function handleNewsletter(e) {
  e.preventDefault();
  e.target.querySelector('input').value = '';
  showToast("You're subscribed! Welcome to Lumière.");
}

// ─────────────────────────────────────────────────────────────
// SMOOTH SCROLL
// ─────────────────────────────────────────────────────────────
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('mobile-nav').classList.remove('open');
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
// INTERSECTION OBSERVER (fade-in on scroll)
// ─────────────────────────────────────────────────────────────
function initIntersectionObserver() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity   = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.trust-item, .testimonial-card, .collection-card').forEach(el => {
    el.style.opacity    = '0';
    el.style.transform  = 'translateY(20px)';
    el.style.transition = 'opacity .5s ease, transform .5s ease';
    observer.observe(el);
  });
}

// ─────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ─────────────────────────────────────────────────────────────
// STATIC PRODUCT DATA  (fallback when Supabase is not configured)
// ─────────────────────────────────────────────────────────────
const STATIC_PRODUCTS = [
  {
    id: 'sp1', name: 'Silk Wrap Midi Dress', category: 'Women',
    price: 189, original_price: null, badge: 'New', rating: 4.9, review_count: 142,
    colors: ['#c89b6e','#1a1a2e','#e5e7eb'], sizes: ['XS','S','M','L','XL'],
    images: ['https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80'],
    description: 'A flowing midi dress in premium silk, perfect for both day and evening occasions.',
  },
  {
    id: 'sp2', name: 'Structured Linen Blazer', category: 'Women',
    price: 245, original_price: null, badge: 'Bestseller', rating: 4.8, review_count: 98,
    colors: ['#d4c5a9','#374151','#ffffff'], sizes: ['XS','S','M','L','XL','XXL'],
    images: ['https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=600&q=80'],
    description: 'A modern structured blazer in breathable linen. Tailored fit with clean lines.',
  },
  {
    id: 'sp3', name: 'Classic Oxford Shirt', category: 'Men',
    price: 95, original_price: null, badge: null, rating: 4.7, review_count: 211,
    colors: ['#ffffff','#6b7280','#1a1a2e'], sizes: ['S','M','L','XL','XXL'],
    images: ['https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=600&q=80'],
    description: 'Timeless Oxford cloth shirt. Perfectly cut for a smart-casual look.',
  },
  {
    id: 'sp4', name: 'Leather Crossbody Bag', category: 'Accessories',
    price: 165, original_price: 220, badge: 'Sale', rating: 4.9, review_count: 87,
    colors: ['#c89b6e','#0a0a0a'], sizes: ['One Size'],
    images: ['https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=80'],
    description: 'Full-grain leather crossbody with adjustable strap and gold hardware.',
  },
  {
    id: 'sp5', name: 'High-Rise Tailored Trousers', category: 'Women',
    price: 138, original_price: 195, badge: 'Sale', rating: 4.6, review_count: 64,
    colors: ['#1a1a2e','#e5e7eb','#c89b6e'], sizes: ['XS','S','M','L','XL'],
    images: ['https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&q=80'],
    description: 'Wide-leg tailored trousers with a high waist and pressed front crease.',
  },
  {
    id: 'sp6', name: 'Merino Wool Crewneck', category: 'Men',
    price: 145, original_price: null, badge: 'New', rating: 4.8, review_count: 53,
    colors: ['#c89b6e','#374151','#1a1a2e'], sizes: ['S','M','L','XL','XXL'],
    images: ['https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&q=80'],
    description: 'Lightweight 100% merino wool crewneck. Soft, temperature-regulating, timeless.',
  },
  {
    id: 'sp7', name: 'Minimalist Watch', category: 'Accessories',
    price: 320, original_price: null, badge: 'Bestseller', rating: 5.0, review_count: 39,
    colors: ['#c89b6e','#374151'], sizes: ['One Size'],
    images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80'],
    description: 'Swiss movement, sapphire crystal glass, and Italian leather strap.',
  },
  {
    id: 'sp8', name: 'Linen Wide-Leg Pants', category: 'Men',
    price: 118, original_price: 158, badge: 'Sale', rating: 4.5, review_count: 76,
    colors: ['#d4c5a9','#374151'], sizes: ['S','M','L','XL','XXL'],
    images: ['https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80'],
    description: 'Relaxed-fit wide-leg pants in 100% linen. Perfect for warm weather.',
  },
];
