-- =============================================
-- LUMIÈRE — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- ── EXTENSIONS ──────────────────────────────
create extension if not exists "uuid-ossp";

-- ── PROFILES ────────────────────────────────
-- Mirrors auth.users with extra fields
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  phone       text,
  created_at  timestamptz default now()
);

-- Auto-create profile when a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── PRODUCTS ────────────────────────────────
create table if not exists public.products (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  description   text,
  category      text not null,            -- 'Women' | 'Men' | 'Accessories'
  price         numeric(10,2) not null,
  original_price numeric(10,2),           -- null = not on sale
  badge         text,                     -- 'New' | 'Sale' | 'Bestseller' | null
  rating        numeric(3,1) default 0,
  review_count  int default 0,
  sizes         text[] default '{}',
  colors        text[] default '{}',
  images        text[] default '{}',      -- array of URLs
  stock         int default 100,
  active        boolean default true,
  created_at    timestamptz default now()
);

-- ── CART ITEMS ──────────────────────────────
create table if not exists public.cart_items (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  qty         int not null default 1 check (qty > 0),
  size        text,
  created_at  timestamptz default now(),
  unique (user_id, product_id, size)
);

-- ── ORDERS ──────────────────────────────────
create type order_status as enum (
  'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'
);

create table if not exists public.orders (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references auth.users(id) on delete set null,
  status            order_status default 'pending',
  total             numeric(10,2) not null,
  currency          text default 'usd',
  stripe_session_id text unique,
  stripe_payment_id text,
  shipping_address  jsonb,
  customer_email    text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ── ORDER ITEMS ─────────────────────────────
create table if not exists public.order_items (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,   -- snapshot at time of purchase
  price       numeric(10,2) not null,
  qty         int not null,
  size        text,
  image       text
);

-- ── UPDATED_AT TRIGGER ───────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

alter table public.profiles   enable row level security;
alter table public.products    enable row level security;
alter table public.cart_items  enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- PROFILES: users can only read/update their own profile
create policy "profiles: own read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

-- PRODUCTS: anyone can read active products
create policy "products: public read"
  on public.products for select
  using (active = true);

-- CART ITEMS: users manage only their own cart
create policy "cart: own read"
  on public.cart_items for select
  using (auth.uid() = user_id);

create policy "cart: own insert"
  on public.cart_items for insert
  with check (auth.uid() = user_id);

create policy "cart: own update"
  on public.cart_items for update
  using (auth.uid() = user_id);

create policy "cart: own delete"
  on public.cart_items for delete
  using (auth.uid() = user_id);

-- ORDERS: users see only their own orders
create policy "orders: own read"
  on public.orders for select
  using (auth.uid() = user_id);

-- Service role (Edge Functions) can insert/update orders
create policy "orders: service insert"
  on public.orders for insert
  with check (true);   -- restricted by service_role key, not JWT

create policy "orders: service update"
  on public.orders for update
  using (true);

-- ORDER ITEMS: readable if owner of the parent order
create policy "order_items: own read"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = auth.uid()
    )
  );

create policy "order_items: service insert"
  on public.order_items for insert
  with check (true);

-- =============================================
-- SEED PRODUCTS (matches frontend data)
-- =============================================

insert into public.products (name, description, category, price, original_price, badge, rating, review_count, sizes, colors, images) values
(
  'Silk Wrap Midi Dress', 'A flowing midi dress in premium silk, perfect for both day and evening occasions.',
  'Women', 189, null, 'New', 4.9, 142,
  array['XS','S','M','L','XL'],
  array['#c89b6e','#1a1a2e','#e5e7eb'],
  array['https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80']
),
(
  'Structured Linen Blazer', 'A modern structured blazer in breathable linen. Tailored fit with clean lines.',
  'Women', 245, null, 'Bestseller', 4.8, 98,
  array['XS','S','M','L','XL','XXL'],
  array['#d4c5a9','#374151','#ffffff'],
  array['https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=600&q=80']
),
(
  'Classic Oxford Shirt', 'Timeless Oxford cloth shirt. Perfectly cut for a smart-casual look.',
  'Men', 95, null, null, 4.7, 211,
  array['S','M','L','XL','XXL'],
  array['#ffffff','#6b7280','#1a1a2e'],
  array['https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=600&q=80']
),
(
  'Leather Crossbody Bag', 'Full-grain leather crossbody with adjustable strap and gold hardware.',
  'Accessories', 165, 220, 'Sale', 4.9, 87,
  array['One Size'],
  array['#c89b6e','#0a0a0a'],
  array['https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=80']
),
(
  'High-Rise Tailored Trousers', 'Wide-leg tailored trousers with a high waist and pressed front crease.',
  'Women', 138, 195, 'Sale', 4.6, 64,
  array['XS','S','M','L','XL'],
  array['#1a1a2e','#e5e7eb','#c89b6e'],
  array['https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&q=80']
),
(
  'Merino Wool Crewneck', 'Lightweight 100% merino wool crewneck. Soft, temperature-regulating, timeless.',
  'Men', 145, null, 'New', 4.8, 53,
  array['S','M','L','XL','XXL'],
  array['#c89b6e','#374151','#1a1a2e'],
  array['https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&q=80']
),
(
  'Minimalist Watch', 'Swiss movement, sapphire crystal glass, and Italian leather strap.',
  'Accessories', 320, null, 'Bestseller', 5.0, 39,
  array['One Size'],
  array['#c89b6e','#374151'],
  array['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80']
),
(
  'Linen Wide-Leg Pants', 'Relaxed-fit wide-leg pants in 100% linen. Perfect for warm weather.',
  'Men', 118, 158, 'Sale', 4.5, 76,
  array['S','M','L','XL','XXL'],
  array['#d4c5a9','#374151'],
  array['https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80']
);
