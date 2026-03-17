create extension if not exists pgcrypto;

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  company_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  status text not null,
  score integer not null check (score >= 0 and score <= 100),
  summary_json jsonb not null
);

create index if not exists idx_scans_domain_id on public.scans(domain_id);
create index if not exists idx_scans_scanned_at on public.scans(scanned_at desc);
