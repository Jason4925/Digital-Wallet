-- Digital Wallet Simulator - Supabase PostgreSQL schema
-- The web browser never uses a Supabase secret key. Node.js is the only client
-- allowed to access these tables directly.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  user_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_idx on public.users (lower(email));

create table if not exists public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  username text,
  phone text,
  wallet_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  balance numeric(18,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_security (
  user_id uuid primary key references public.users(id) on delete cascade,
  pin_hash text,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  reference_id text not null unique,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  sender_id uuid references public.users(id) on delete cascade,
  receiver_id uuid references public.users(id) on delete cascade,
  amount numeric(18,2) not null check (amount > 0),
  type text not null,
  category text not null default 'Other',
  note text,
  counterparty_wallet_id text,
  sender_wallet_id text,
  receiver_wallet_id text,
  counterparty_name text,
  sender_name text,
  receiver_name text
);

alter table public.transactions add column if not exists sender_name text;
alter table public.transactions add column if not exists receiver_name text;

create index if not exists transactions_sender_idx on public.transactions(sender_id, created_at desc);
create index if not exists transactions_receiver_idx on public.transactions(receiver_id, created_at desc);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  contact_user_id uuid not null references public.users(id) on delete cascade,
  wallet_id text not null,
  nickname text not null,
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists contacts_owner_wallet_idx on public.contacts(owner_id, wallet_id);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  month_start date not null,
  category text not null,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(user_id, month_start, category)
);

create table if not exists public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  amount numeric(18,2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly','monthly')),
  category text not null default 'Other',
  next_run_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists auth_sessions_user_idx on public.auth_sessions(user_id);
create index if not exists auth_sessions_expires_idx on public.auth_sessions(expires_at);

-- Realtime database changes are consumed by the Node server and then forwarded
-- only to the authenticated browser session that owns the changed records.
do $$
declare
  tbl text;
begin
  foreach tbl in array ARRAY['users','profiles','wallets','wallet_security','transactions','contacts','budgets','recurring_payments','notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
exception
  when undefined_table or undefined_object then
    raise notice 'supabase_realtime publication is not available yet. Enable Realtime replication and rerun this section.';
end $$;

-- Keep RLS enabled on every exposed application table. Only the backend secret-key client is granted table access.

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_security enable row level security;
alter table public.transactions enable row level security;
alter table public.contacts enable row level security;
alter table public.budgets enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.notifications enable row level security;
alter table public.auth_sessions enable row level security;

-- The server needs DELETE events to identify the user that owned the deleted row.
alter table public.users replica identity full;
alter table public.profiles replica identity full;
alter table public.wallets replica identity full;
alter table public.wallet_security replica identity full;
alter table public.transactions replica identity full;
alter table public.contacts replica identity full;
alter table public.budgets replica identity full;
alter table public.recurring_payments replica identity full;
alter table public.notifications replica identity full;

-- Account creation is atomic.
create or replace function public.create_wallet_account(p_email text, p_full_name text, p_password_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_id uuid := gen_random_uuid();
  new_wallet_id text;
begin
  if exists (select 1 from public.users where lower(email) = lower(trim(p_email))) then
    raise exception using errcode = '23505', message = 'DUPLICATE_EMAIL';
  end if;

  loop
    new_wallet_id := 'DW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.profiles where wallet_id = new_wallet_id);
  end loop;

  insert into public.users(id, email, password_hash, user_metadata)
  values (new_user_id, lower(trim(p_email)), p_password_hash, jsonb_build_object('full_name', trim(p_full_name), 'email_demo', true));

  insert into public.profiles(id, full_name, email, wallet_id)
  values (new_user_id, trim(p_full_name), lower(trim(p_email)), new_wallet_id);

  insert into public.wallets(user_id, balance) values (new_user_id, 0);
  insert into public.wallet_security(user_id) values (new_user_id);
  insert into public.notifications(user_id, title, message, type)
  values (new_user_id, 'Welcome to your wallet', 'Your simulated wallet is ready.', 'info');

  return jsonb_build_object('user_id', new_user_id, 'wallet_id', new_wallet_id);
end;
$$;

-- Atomic simulated deposit.
create or replace function public.wallet_deposit(p_user_id uuid, p_amount numeric, p_category text, p_note text, p_reference_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row public.wallets%rowtype;
  profile_row public.profiles%rowtype;
  tx_id uuid := gen_random_uuid();
  created_time timestamptz := now();
begin
  select * into wallet_row from public.wallets where user_id = p_user_id for update;
  select * into profile_row from public.profiles where id = p_user_id;
  if wallet_row.user_id is null or profile_row.id is null then raise exception using message = 'WALLET_NOT_READY'; end if;
  if p_amount <= 0 or p_amount > 1000000000 then raise exception using message = 'INVALID_AMOUNT'; end if;

  update public.wallets set balance = balance + p_amount, updated_at = created_time where user_id = p_user_id;
  insert into public.transactions(id, reference_id, status, created_at, sender_id, receiver_id, amount, type, category, note)
  values (tx_id, p_reference_id, 'completed', created_time, null, p_user_id, p_amount, 'deposit', 'Income', nullif(trim(p_note), ''));
  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, 'Money deposited', p_amount::text || ' was recorded in your simulated wallet.', 'success');

  return jsonb_build_object('success', true, 'transaction_id', tx_id, 'reference_id', p_reference_id, 'status', 'completed');
end;
$$;

-- Atomic simulated withdrawal.
create or replace function public.wallet_withdraw(p_user_id uuid, p_amount numeric, p_category text, p_note text, p_reference_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row public.wallets%rowtype;
  tx_id uuid := gen_random_uuid();
  created_time timestamptz := now();
begin
  select * into wallet_row from public.wallets where user_id = p_user_id for update;
  if wallet_row.user_id is null then raise exception using message = 'WALLET_NOT_READY'; end if;
  if p_amount <= 0 or p_amount > 1000000000 then raise exception using message = 'INVALID_AMOUNT'; end if;
  if wallet_row.balance < p_amount then raise exception using message = 'INSUFFICIENT_BALANCE'; end if;

  update public.wallets set balance = balance - p_amount, updated_at = created_time where user_id = p_user_id;
  insert into public.transactions(id, reference_id, status, created_at, sender_id, receiver_id, amount, type, category, note)
  values (tx_id, p_reference_id, 'completed', created_time, p_user_id, null, p_amount, 'withdrawal', coalesce(nullif(p_category, ''), 'Other'), nullif(trim(p_note), ''));
  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, 'Money withdrawn', p_amount::text || ' was removed from your simulated wallet.', 'info');

  return jsonb_build_object('success', true, 'transaction_id', tx_id, 'reference_id', p_reference_id, 'status', 'completed');
end;
$$;

-- Atomic wallet-to-wallet transfer. Both wallet rows are locked in a stable order.
create or replace function public.wallet_transfer(p_user_id uuid, p_receiver_wallet_id text, p_amount numeric, p_category text, p_note text, p_reference_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_profile public.profiles%rowtype;
  sender_profile public.profiles%rowtype;
  sender_balance numeric;
  receiver_balance numeric;
  tx_id uuid := gen_random_uuid();
  created_time timestamptz := now();
  clean_wallet_id text := upper(trim(p_receiver_wallet_id));
begin
  if p_amount <= 0 or p_amount > 1000000000 then raise exception using message = 'INVALID_AMOUNT'; end if;
  select * into recipient_profile from public.profiles where wallet_id = clean_wallet_id;
  select * into sender_profile from public.profiles where id = p_user_id;
  if recipient_profile.id is null then raise exception using message = 'RECIPIENT_NOT_FOUND'; end if;
  if recipient_profile.id = p_user_id then raise exception using message = 'SELF_TRANSFER'; end if;
  if sender_profile.id is null then raise exception using message = 'WALLET_NOT_READY'; end if;

  perform 1 from public.wallets
    where user_id in (p_user_id, recipient_profile.id)
    order by user_id
    for update;

  select balance into sender_balance from public.wallets where user_id = p_user_id;
  select balance into receiver_balance from public.wallets where user_id = recipient_profile.id;
  if sender_balance is null or receiver_balance is null then raise exception using message = 'RECIPIENT_WALLET_MISSING'; end if;
  if sender_balance < p_amount then raise exception using message = 'INSUFFICIENT_BALANCE'; end if;

  update public.wallets set balance = balance - p_amount, updated_at = created_time where user_id = p_user_id;
  update public.wallets set balance = balance + p_amount, updated_at = created_time where user_id = recipient_profile.id;

  insert into public.transactions(id, reference_id, status, created_at, sender_id, receiver_id, amount, type, category, note, counterparty_wallet_id, sender_wallet_id, receiver_wallet_id, counterparty_name, sender_name, receiver_name)
  values (tx_id, p_reference_id, 'completed', created_time, p_user_id, recipient_profile.id, p_amount, 'transfer', coalesce(nullif(p_category, ''), 'Other'), nullif(trim(p_note), ''), recipient_profile.wallet_id, sender_profile.wallet_id, recipient_profile.wallet_id, recipient_profile.full_name, sender_profile.full_name, recipient_profile.full_name);

  insert into public.notifications(user_id, title, message, type)
  values (recipient_profile.id, 'Money received', 'You received ' || p_amount::text || ' in your simulated wallet.', 'success');
  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, 'Transfer completed', 'You sent ' || p_amount::text || ' to ' || recipient_profile.full_name || '.', 'success');

  return jsonb_build_object('success', true, 'transaction_id', tx_id, 'reference_id', p_reference_id, 'status', 'completed', 'recipient', jsonb_build_object('full_name', recipient_profile.full_name, 'wallet_id', recipient_profile.wallet_id));
end;
$$;

-- Atomic recurring payment execution with calendar-month scheduling.
create or replace function public.wallet_run_recurring(p_user_id uuid, p_recurring_id uuid, p_reference_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recurring_row public.recurring_payments%rowtype;
  wallet_balance numeric;
  profile_row public.profiles%rowtype;
  tx_id uuid := gen_random_uuid();
  created_time timestamptz := now();
  next_time timestamptz;
begin
  select * into recurring_row from public.recurring_payments where id = p_recurring_id and user_id = p_user_id for update;
  select balance into wallet_balance from public.wallets where user_id = p_user_id for update;
  select * into profile_row from public.profiles where id = p_user_id;
  if recurring_row.id is null then raise exception using message = 'RECURRING_NOT_FOUND'; end if;
  if not recurring_row.active then raise exception using message = 'RECURRING_INACTIVE'; end if;
  if wallet_balance is null or profile_row.id is null then raise exception using message = 'WALLET_NOT_READY'; end if;
  if wallet_balance < recurring_row.amount then raise exception using message = 'INSUFFICIENT_BALANCE'; end if;

  update public.wallets set balance = balance - recurring_row.amount, updated_at = created_time where user_id = p_user_id;
  next_time := recurring_row.next_run_at;
  if recurring_row.frequency = 'monthly' then
    next_time := next_time + interval '1 month';
    while next_time <= created_time loop next_time := next_time + interval '1 month'; end loop;
  else
    next_time := next_time + interval '7 days';
    while next_time <= created_time loop next_time := next_time + interval '7 days'; end loop;
  end if;
  update public.recurring_payments set next_run_at = next_time where id = recurring_row.id;

  insert into public.transactions(id, reference_id, status, created_at, sender_id, amount, type, category, note, sender_wallet_id)
  values (tx_id, p_reference_id, 'completed', created_time, p_user_id, recurring_row.amount, 'recurring_payment', recurring_row.category, recurring_row.title, profile_row.wallet_id);
  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, 'Recurring payment completed', recurring_row.title || ' was paid.', 'info');

  return jsonb_build_object('success', true, 'transaction_id', tx_id, 'reference_id', p_reference_id, 'status', 'completed');
end;
$$;

create or replace function public.reset_wallet_simulation(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wallets set balance = 0, updated_at = now() where user_id = p_user_id;
  update public.wallet_security set pin_hash = null, failed_attempts = 0, locked = false, updated_at = now() where user_id = p_user_id;
  delete from public.transactions where sender_id = p_user_id or receiver_id = p_user_id;
  delete from public.contacts where owner_id = p_user_id;
  delete from public.budgets where user_id = p_user_id;
  delete from public.recurring_payments where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, 'Simulation reset', 'Your wallet simulation data was reset. Set a new PIN before making transactions.', 'info');
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.delete_wallet_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.users where id = p_user_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.reset_all_wallet_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.auth_sessions, public.notifications, public.recurring_payments, public.budgets, public.contacts, public.transactions, public.wallet_security, public.wallets, public.profiles, public.users restart identity cascade;
  return jsonb_build_object('success', true, 'message', 'All wallet database data was deleted. Tables and functions were kept.');
end;
$$;

-- Least privilege: the browser does not talk directly to these application tables.
revoke all on table public.users, public.profiles, public.wallets, public.wallet_security, public.transactions, public.contacts, public.budgets, public.recurring_payments, public.notifications, public.auth_sessions from anon, authenticated;
grant all on table public.users, public.profiles, public.wallets, public.wallet_security, public.transactions, public.contacts, public.budgets, public.recurring_payments, public.notifications, public.auth_sessions to service_role;
revoke all on function public.create_wallet_account(text,text,text) from public, anon, authenticated;
revoke all on function public.wallet_deposit(uuid,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.wallet_withdraw(uuid,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.wallet_transfer(uuid,text,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.wallet_run_recurring(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reset_wallet_simulation(uuid) from public, anon, authenticated;
revoke all on function public.delete_wallet_account(uuid) from public, anon, authenticated;
revoke all on function public.reset_all_wallet_data() from public, anon, authenticated;
grant execute on function public.create_wallet_account(text,text,text) to service_role;
grant execute on function public.wallet_deposit(uuid,numeric,text,text,text) to service_role;
grant execute on function public.wallet_withdraw(uuid,numeric,text,text,text) to service_role;
grant execute on function public.wallet_transfer(uuid,text,numeric,text,text,text) to service_role;
grant execute on function public.wallet_run_recurring(uuid,uuid,text) to service_role;
grant execute on function public.reset_wallet_simulation(uuid) to service_role;
grant execute on function public.delete_wallet_account(uuid) to service_role;
grant execute on function public.reset_all_wallet_data() to service_role;
