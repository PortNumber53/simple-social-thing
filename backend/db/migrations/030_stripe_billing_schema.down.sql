-- +migrate Down
DROP TABLE IF EXISTS public.invoices;
DROP TABLE IF EXISTS public.payment_methods;
DROP TABLE IF EXISTS public.billing_events;
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.billing_plans;
