-- Refunds: a full PayPal refund of a captured seat order revokes the seats. Adds the REFUNDED
-- status to paypal_orders and paypal_payments, records the refund on the payment row, and adds
-- revoke_seat_access, the idempotent counterpart of grant_seat_access.
-- Safe to re-run: every statement is idempotent, and the file runs as one transaction.
begin;

-- 1. Statuses. The checks are recreated so a re-run on any earlier version ends up the same.
alter table public.paypal_orders drop constraint if exists paypal_orders_status_check;
alter table public.paypal_orders
  add constraint paypal_orders_status_check check (status in ('PENDING', 'COMPLETED', 'REFUNDED'));

alter table public.paypal_payments drop constraint if exists paypal_payments_status_check;
alter table public.paypal_payments
  add constraint paypal_payments_status_check check (status in ('COMPLETED', 'REFUNDED'));

-- 2. The refund that revoked a payment, for the audit trail. Server-only columns (RLS already on).
alter table public.paypal_payments add column if not exists refund_id text;
alter table public.paypal_payments add column if not exists refunded_at timestamptz;

create unique index if not exists paypal_payments_refund_id_idx
  on public.paypal_payments (refund_id) where refund_id is not null;

-- 3. Revoke seats for a full refund. Locks the order row (serialises against grant_seat_access
-- and a concurrent retry), checks the caller's refund amount against the recorded capture, and
-- returns 'already_revoked' instead of failing when the same refund arrives again. The seat
-- entitlement is deactivated only when the instructor has no other completed order left.
create or replace function public.revoke_seat_access(
  p_user_id uuid,
  p_order_id text,
  p_capture_id text,
  p_refund_id text,
  p_amount numeric,
  p_currency text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.paypal_orders%rowtype;
  v_payment public.paypal_payments%rowtype;
begin
  if p_refund_id is null or p_refund_id = '' or p_capture_id is null or p_capture_id = '' then
    raise exception 'A PayPal refund ID and capture ID are required';
  end if;

  select *
    into v_order
    from public.paypal_orders
   where paypal_order_id = p_order_id
   for update;

  if not found or v_order.user_id <> p_user_id then
    raise exception 'PayPal refund does not match the stored account order';
  end if;

  select *
    into v_payment
    from public.paypal_payments
   where paypal_order_id = p_order_id;

  if not found or v_payment.capture_id <> p_capture_id or v_payment.user_id <> p_user_id then
    raise exception 'PayPal refund does not match the recorded capture for this order';
  end if;

  if v_payment.status = 'REFUNDED' then
    -- Already revoked (same refund retried, or a later refund of an already-refunded capture).
    return 'already_revoked';
  end if;

  -- Full refunds only: the refund must equal the captured amount in the captured currency.
  if p_amount is null or p_amount <> v_payment.amount or p_currency <> v_payment.currency then
    raise exception 'Refund amount or currency does not match the captured payment';
  end if;

  update public.paypal_payments
     set status = 'REFUNDED',
         refund_id = p_refund_id,
         refunded_at = now()
   where capture_id = p_capture_id;

  update public.paypal_orders
     set status = 'REFUNDED'
   where paypal_order_id = p_order_id;

  if not exists (
    select 1
      from public.paypal_orders
     where user_id = p_user_id
       and status = 'COMPLETED'
  ) then
    update public.user_entitlements
       set is_active = false
     where user_id = p_user_id
       and product_code = 'instructor_seat';
  end if;

  return 'revoked';
end;
$$;

revoke all on function public.revoke_seat_access(uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.revoke_seat_access(uuid, text, text, text, numeric, text) to service_role;

commit;
