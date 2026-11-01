-- Verified PayPal webhook events, for the instructor's live event drawer. One row per PayPal event
-- ID, so PayPal's retries of the same event never add a second row. Only what the drawer shows is
-- kept (no payer names or emails). user_id is the owner of the matching seat order, or null when
-- no stored order matches; null rows are never shown to anyone.
-- Only the server (secret key) reads and writes this table; instructors have no direct access.
-- Safe to re-run: every statement is idempotent, and the file runs as one transaction.
begin;

create table if not exists public.paypal_webhook_events (
  event_id text primary key,
  event_type text not null,
  resource_type text,
  resource_id text,
  resource_status text,
  paypal_order_id text,
  user_id uuid references auth.users (id) on delete cascade,
  amount numeric(12, 2),
  currency text,
  event_created_at timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists paypal_webhook_events_user_received_idx
  on public.paypal_webhook_events (user_id, received_at desc);

-- RLS on with no policies: the anon and authenticated roles cannot touch the table.
alter table public.paypal_webhook_events enable row level security;
revoke all on public.paypal_webhook_events from anon, authenticated;
grant select, insert on public.paypal_webhook_events to service_role;

commit;
