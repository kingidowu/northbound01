# Member upgrades setup

The report library regenerates PDFs from the saved assessment package. It does not need a new storage bucket or database migration. Signed-in members can see reports linked to their user ID; older emailed reports can be recovered through a confirmed matching account email.

Follow-up entries are kept in the signed-in member's Supabase Auth metadata. The account page shows due dates and customizable templates. It does not send follow-up messages or reminder emails automatically.

For subscription management, enable Stripe's customer portal in the Stripe dashboard. Configure the existing webhook endpoint at `https://thecareerarchitect.org/api/stripe-webhook` to receive `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. The endpoint requires `STRIPE_WEBHOOK_SECRET` and updates membership status on changes. Existing paid memberships need a `stripe_customer_id` to open the portal.
