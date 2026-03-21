create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  company_name text,
  sector text,
  country text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  runner_type text not null,
  config_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.domain_tests (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains(id) on delete cascade,
  test_type_id uuid not null references public.test_types(id) on delete restrict,
  active boolean not null default true,
  schedule_enabled boolean not null default false,
  schedule_frequency text not null default 'manual'
    check (schedule_frequency in ('manual', 'daily', 'weekly')),
  schedule_time time,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  last_score integer check (last_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_id, test_type_id)
);

create table if not exists public.test_runs (
  id uuid primary key default gen_random_uuid(),
  domain_test_id uuid not null references public.domain_tests(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  score integer check (score between 0 and 100),
  summary_json jsonb,
  raw_json jsonb,
  error_message text,
  triggered_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  scope_type text not null,
  scope_id uuid,
  generated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_domains_active on public.domains(active);
create index if not exists idx_test_types_active on public.test_types(active);
create index if not exists idx_test_types_runner_type on public.test_types(runner_type);
create index if not exists idx_domain_tests_domain_id on public.domain_tests(domain_id);
create index if not exists idx_domain_tests_test_type_id on public.domain_tests(test_type_id);
create index if not exists idx_domain_tests_next_run_at on public.domain_tests(next_run_at);
create index if not exists idx_test_runs_domain_test_id on public.test_runs(domain_test_id);
create index if not exists idx_test_runs_created_at on public.test_runs(created_at desc);
create index if not exists idx_reports_scope on public.reports(scope_type, scope_id);

drop trigger if exists set_domains_updated_at on public.domains;
create trigger set_domains_updated_at
before update on public.domains
for each row
execute function public.set_updated_at();

drop trigger if exists set_test_types_updated_at on public.test_types;
create trigger set_test_types_updated_at
before update on public.test_types
for each row
execute function public.set_updated_at();

drop trigger if exists set_domain_tests_updated_at on public.domain_tests;
create trigger set_domain_tests_updated_at
before update on public.domain_tests
for each row
execute function public.set_updated_at();
