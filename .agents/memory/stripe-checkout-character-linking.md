---
name: Stripe checkout character linking (DreamStick backend)
description: How completed Stripe checkout sessions get tied back to a `characters` row and activate a subscription, without a webhook.
---

`STRIPE_WEBHOOK_SECRET` is not configured in this environment, so subscription activation cannot rely on a webhook endpoint.

Approach: `/api/create-checkout-session` collects the parent's email client-side and passes it as both `customer_email` and `session.metadata.email`, with `success_url` including `{CHECKOUT_SESSION_ID}`. `/api/success` retrieves the session server-side via `stripe.checkout.sessions.retrieve(session_id)`, checks `payment_status`/`status`, and updates `characters.subscription_status = 'active'` by matching `parent_email`.

**Why:** avoids requiring Stripe CLI/dashboard webhook setup in this sandboxed environment while still verifying payment server-side (never trusting client-supplied success state).

**How to apply:** if a real webhook secret is later configured, prefer switching to a `checkout.session.completed` webhook handler for reliability (session-retrieval on redirect is best-effort — it only fires if the user's browser actually reaches `/api/success`). Keep the metadata.email pattern either way for linking sessions to characters.
