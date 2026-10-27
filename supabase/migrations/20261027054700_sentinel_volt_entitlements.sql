create table if not exists public.paypal_orders (
  paypal_order_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  student_name text not null,
  amount numeric(10, 2) not null check (amount = 49.00),
  currency text not null check (currency = 'USD'),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED')),
  created_at timestamptz not null default now()
);

create table if not exists public.paypal_payments (
  capture_id text primary key,
  paypal_order_id text not null unique references public.paypal_orders (paypal_order_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(10, 2) not null check (amount = 49.00),
  currency text not null check (currency = 'USD'),
  status text not null check (status = 'COMPLETED'),
  created_at timestamptz not null default now()
);

create table if not exists public.user_entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_code text not null check (product_code = 'sentinel_volt'),
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  source_capture_id text not null references public.paypal_payments (capture_id),
  primary key (user_id, product_code)
);

alter table public.paypal_orders enable row level security;
alter table public.paypal_payments enable row level security;
alter table public.user_entitlements enable row level security;

grant select on public.user_entitlements to authenticated;

create policy "Users can read their own entitlements"
  on public.user_entitlements
  for select
  to authenticated
  using (auth.uid() = user_id);

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
     or v_order.amount <> p_amount
     or v_order.currency <> p_currency then
    raise exception 'PayPal capture does not match the stored account order';
  end if;

  insert into public.paypal_payments (
    capture_id, paypal_order_id, user_id, amount, currency, status
  ) values (
    p_capture_id, p_order_id, p_user_id, p_amount, p_currency, 'COMPLETED'
  )
  on conflict (capture_id) do nothing;

  select *
    into v_payment
    from public.paypal_payments
   where capture_id = p_capture_id;

  if v_payment.paypal_order_id <> p_order_id or v_payment.user_id <> p_user_id then
    raise exception 'PayPal capture is already associated with a different order';
  end if;

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
