# Lumière Store

A premium e-commerce web application for a fashion/lifestyle brand, built with vanilla JavaScript, Supabase, and Stripe.

## Features

- **Authentication** — Sign up, sign in, and sign out via Supabase Auth
- **Product catalog** — Browse products by category with search and filtering
- **Shopping cart** — Guest cart (localStorage) that merges into user account on login
- **Checkout** — Stripe-hosted checkout with support for 10+ countries
- **Order history** — View past orders for authenticated users
- **Admin portfolio** — Manage products and orders via `portfolio.html`
- **Responsive design** — Mobile-friendly with hamburger menu and slideshow hero

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Database & Auth | Supabase (PostgreSQL 17) |
| Payments | Stripe Checkout + Webhooks |
| Backend | Supabase Edge Functions (Deno) |
| Fonts | Google Fonts (Inter, Playfair Display) |

## Project Structure

```
Lumiere-Store/
├── index.html              # Main storefront
├── portfolio.html          # Admin/portfolio page
├── style.css               # Global styles
├── app.js                  # SPA logic (auth, cart, products, UI)
├── js/
│   ├── config.js           # Environment configuration
│   ├── supabase.js         # Supabase client & helpers
│   └── stripe.js           # Stripe checkout orchestration
├── supabase/
│   ├── schema.sql          # Database schema & RLS policies
│   ├── config.toml         # Local dev configuration
│   └── functions/
│       ├── create-checkout/ # Creates Stripe checkout sessions
│       └── stripe-webhook/  # Handles Stripe webhook events
└── .env.example            # Environment variables template
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A [Supabase](https://supabase.com/) project
- A [Stripe](https://stripe.com/) account

### 1. Clone the repository

```bash
git clone https://github.com/davidvalles1102/Lumiere-Store.git
cd Lumiere-Store
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (used in Edge Functions) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

### 4. Set up the database

Run the schema in your Supabase SQL editor:

```bash
# Or paste supabase/schema.sql directly in the Supabase dashboard
supabase db push
```

### 5. Deploy Edge Functions

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

### 6. Set up the Stripe webhook

In your Stripe dashboard, create a webhook pointing to:

```
https://<your-supabase-project>.supabase.co/functions/v1/stripe-webhook
```

Listen for the `checkout.session.completed` event.

### 7. Open the app

Since there's no build step, open `index.html` directly in your browser or serve it with any static file server:

```bash
npx serve .
```

## Database Schema

| Table | Description |
|---|---|
| `profiles` | User metadata, extends `auth.users` |
| `products` | Product catalog with categories, pricing, images, badges |
| `cart_items` | Per-user cart with product references |
| `orders` | Order records with shipping and total info |
| `order_items` | Line items per order with price snapshots |

Row-Level Security (RLS) is enabled on all tables to ensure data isolation per user.

## Payment Flow

1. User adds items to cart and proceeds to checkout
2. Frontend calls the `create-checkout` Edge Function
3. Edge Function validates cart and creates a Stripe Checkout session
4. User completes payment on Stripe's hosted page
5. Stripe fires a `checkout.session.completed` webhook
6. `stripe-webhook` Edge Function creates the order and clears the cart

## License

MIT
