// Supabase Edge Function — stripe-webhook
// Listens for Stripe events and writes orders to Supabase.
// Deploy: supabase functions deploy stripe-webhook
// Set in Stripe Dashboard → Webhooks → endpoint URL:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  // Verify Stripe signature
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.payment_status !== 'paid') break;

        const metadata = session.metadata ?? {};
        const userId = metadata.user_id !== 'guest' ? metadata.user_id : null;
        const items: Array<{
          product_id: string; name: string; price: number;
          qty: number; size: string | null; image: string | null;
        }> = JSON.parse(metadata.items ?? '[]');

        const shippingDetails = session.shipping_details;
        const shippingAddress = shippingDetails ? {
          name: shippingDetails.name,
          line1: shippingDetails.address?.line1,
          line2: shippingDetails.address?.line2,
          city: shippingDetails.address?.city,
          state: shippingDetails.address?.state,
          postal_code: shippingDetails.address?.postal_code,
          country: shippingDetails.address?.country,
        } : null;

        // Insert order
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            user_id: userId,
            status: 'paid',
            total: (session.amount_total ?? 0) / 100,
            currency: session.currency ?? 'usd',
            stripe_session_id: session.id,
            stripe_payment_id: session.payment_intent as string,
            customer_email: session.customer_email,
            shipping_address: shippingAddress,
          })
          .select()
          .single();

        if (orderError) {
          console.error('Error inserting order:', orderError);
          return new Response('DB error', { status: 500 });
        }

        // Insert order items
        if (items.length > 0) {
          const orderItems = items.map((item) => ({
            order_id: order.id,
            product_id: item.product_id,
            name: item.name,
            price: item.price,
            qty: item.qty,
            size: item.size,
            image: item.image,
          }));

          const { error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItems);

          if (itemsError) {
            console.error('Error inserting order items:', itemsError);
          }
        }

        // Clear the user's cart after successful payment
        if (userId) {
          await supabase
            .from('cart_items')
            .delete()
            .eq('user_id', userId);
        }

        console.log(`Order ${order.id} created for session ${session.id}`);
        break;
      }

      case 'checkout.session.expired': {
        // Session expired without payment — no action needed
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`Session expired: ${session.id}`);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        if (paymentIntentId) {
          await supabase
            .from('orders')
            .update({ status: 'refunded' })
            .eq('stripe_payment_id', paymentIntentId);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
