-- Seat proposals from the seat assistant, held until the instructor clicks Confirm (10 minutes).
-- Stored here instead of server memory so any server instance can confirm a proposal (Vercel).
-- Only the server (secret key) reads and writes this table; instructors have no access.
-- Safe to re-run: every statement is idempotent, and the file runs as one transaction.
begin;

create table if not exists public.seat_proposals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  quantity integer not null,
  class_name text not null,
  unit_price numeric(10, 2) not null,
  total numeric(10, 2) not null,
  currency text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Kept outside create table so a re-run also updates a table created by an earlier version.
alter table public.seat_proposals drop constraint if exists seat_proposals_quantity_check;
alter table public.seat_proposals
  add constraint seat_proposals_quantity_check check (quantity between 1 and 200);

alter table public.seat_proposals drop constraint if exists seat_proposals_class_name_check;
alter table public.seat_proposals
  add constraint seat_proposals_class_name_check check (char_length(class_name) between 1 and 80);

alter table public.seat_proposals drop constraint if exists seat_proposals_price_check;
alter table public.seat_proposals
  add constraint seat_proposals_price_check check (unit_price = 49.00 and total = 49.00 * quantity and currency = 'USD');

-- expires_at is set by the server (created + 10 minutes) and checked by it on confirm; no check
-- against created_at here, so clock skew between the server and the database cannot reject a row.

create index if not exists seat_proposals_expires_at_idx on public.seat_proposals (expires_at);

-- RLS on with no policies: the anon and authenticated roles cannot touch the table.
alter table public.seat_proposals enable row level security;
revoke all on public.seat_proposals from anon, authenticated;
grant select, insert, delete on public.seat_proposals to service_role;

commit;
