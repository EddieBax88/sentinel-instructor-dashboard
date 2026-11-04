-- Renames the seat grant function to grant_seat_access and the entitlement product code to
-- 'instructor_seat'. The old names appear only here, as the things being renamed.
-- Safe to re-run: every statement is idempotent, and the file runs as one transaction.
begin;

-- 1. Product code: drop the old check, convert existing rows, then allow only the new code.
alter table public.user_entitlements drop constraint if exists user_entitlements_product_code_check;

update public.user_entitlements
   set product_code = 'instructor_seat'
 where product_code = 'sentinel_volt';

alter table public.user_entitlements
  add constraint user_entitlements_product_code_check check (product_code = 'instructor_seat');

-- 2. The grant function under its new name. Same checks as before: amount = 49.00 x quantity,
-- owner must match, and a capture already recorded is a no-op so nothing is granted twice.
create or replace function public.grant_seat_access(
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
    p_user_id, 'instructor_seat', true, p_capture_id
  )
  on conflict (user_id, product_code) do update
    set is_active = true,
        granted_at = now(),
        source_capture_id = excluded.source_capture_id;
end;
$$;

revoke all on function public.grant_seat_access(uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.grant_seat_access(uuid, text, text, text, numeric, text) to service_role;

-- 3. Drop the old function now that the new one exists.
drop function if exists public.grant_sentinel_volt_access(uuid, text, text, text, numeric, text);

commit;
