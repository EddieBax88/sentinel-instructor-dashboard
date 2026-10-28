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

-- Seat grants: verify amount = 49.00 x quantity, and make repeats a no-op so a duplicate
-- capture or webhook never grants twice. The order row lock serializes concurrent calls.
create or replace function public.grant_sentinel_volt_access(
  p_user_id uuid,
  p_order_id text,
  p_capture_id text,
  p_status text,
  p_amount numeric,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.paypal_orders%rowtype;
  v_payment public.paypal_payments%rowtype;
begin
  if p_status <> 'COMPLETED' or p_capture_id is null or p_capture_id = '' then
    raise exception 'A completed PayPal capture is required';
  end if;

  select *
    into v_order
    from public.paypal_orders
   where paypal_order_id = p_order_id
   for update;

  if not found
     or v_order.user_id <> p_user_id
     or v_order.amount <> 49.00 * v_order.quantity
     or v_order.amount <> p_amount
     or v_order.currency <> p_currency then
    raise exception 'PayPal capture does not match the stored account order';
  end if;

  select *
    into v_payment
    from public.paypal_payments
   where paypal_order_id = p_order_id;

  if found then
    if v_payment.capture_id <> p_capture_id or v_payment.user_id <> p_user_id then
      raise exception 'PayPal order is already associated with a different capture';
    end if;
    -- Already granted for this capture: nothing to do.
    return;
  end if;

  insert into public.paypal_payments (
    capture_id, paypal_order_id, user_id, amount, currency, status
  ) values (
    p_capture_id, p_order_id, p_user_id, p_amount, p_currency, 'COMPLETED'
  );

  update public.paypal_orders
     set status = 'COMPLETED'
   where paypal_order_id = p_order_id;

  insert into public.user_entitlements (
    user_id, product_code, is_active, source_capture_id
  ) values (
    p_user_id, 'sentinel_volt', true, p_capture_id
  )
  on conflict (user_id, product_code) do update
    set is_active = true,
        granted_at = now(),
        source_capture_id = excluded.source_capture_id;
end;
$$;

revoke all on function public.grant_sentinel_volt_access(uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.grant_sentinel_volt_access(uuid, text, text, text, numeric, text) to service_role;
