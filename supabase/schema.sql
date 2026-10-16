create table if not exists public.bot_settings (
  id integer primary key check (id = 1),
  username text not null default '',
  password text not null default '',
  invite_name text not null default '',
  license_key text not null default '',
  friends jsonb not null default '[]'::jsonb
);

alter table public.bot_settings add column if not exists license_key text not null default '';

create table if not exists public.bot_status (
  id integer primary key check (id = 1),
  online boolean not null default false,
  logged_in boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_control (
  id integer primary key check (id = 1),
  reconnect_token text not null default ''
);

create table if not exists public.bot_logs (
  id bigint generated always as identity primary key,
  t text not null,
  kind text not null,
  msg text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.license_keys (
  key text primary key check (key ~ '^[a-f0-9]{30}$'),
  key_type text not null check (key_type in ('free', 'vip')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_ip inet,
  bound_ip inet,
  bound_at timestamptz,
  last_verified_at timestamptz
);

create table if not exists public.license_free_issues (
  ip inet not null,
  window_start timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (ip, window_start)
);

insert into public.bot_settings (id) values (1) on conflict (id) do nothing;
insert into public.bot_status (id) values (1) on conflict (id) do nothing;
insert into public.bot_control (id) values (1) on conflict (id) do nothing;

alter table public.bot_settings enable row level security;
alter table public.bot_status enable row level security;
alter table public.bot_control enable row level security;
alter table public.bot_logs enable row level security;
alter table public.license_keys enable row level security;
alter table public.license_free_issues enable row level security;