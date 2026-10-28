-- Multi-seat orders: one PayPal order can now cover 1-200 seats at the fixed USD 49.00 seat price.
alter table public.paypal_orders
  add column if not exists quantity integer not null default 1;

alter table public.paypal_orders drop constraint if exists paypal_orders_quantity_check;
alter table public.paypal_orders
  add constraint paypal_orders_quantity_check check (quantity between 1 and 200);

alter table public.paypal_orders drop constraint if exists paypal_orders_amount_check;
alter table public.paypal_orders
  add constraint paypal_orders_amount_check check (amount = 49.00 * quantity);

-- The grant function already checks each capture against its stored order amount.
alter table public.paypal_payments drop constraint if exists paypal_payments_amount_check;
alter table public.paypal_payments
  add constraint paypal_payments_amount_check check (amount > 0 and amount <= 49.00 * 200);

-- Audit log for the seat assistant. Only the server (secret key) writes; instructors read their own rows.
create table if not exists public.agent_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in (
    'chat_request', 'tool_call', 'tool_rejected', 'order_proposed',
    'agent_reply', 'off_topic_blocked', 'confirm_rejected', 'order_created', 'order_failed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_actions_user_id_created_at_idx
  on public.agent_actions (user_id, created_at desc);

alter table public.agent_actions enable row level security;

grant select on public.agent_actions to authenticated;

create policy "Instructors can read their own agent actions"
  on public.agent_actions
  for select
  to authenticated
  using (auth.uid() = user_id);
