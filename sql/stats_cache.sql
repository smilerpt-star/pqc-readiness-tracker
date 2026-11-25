-- Precomputed snapshot for /stats. The dashboard reads this single row instead
-- of aggregating a year of test_runs on every request (which overwhelmed the
-- free-tier DB). The backend refreshes it after each daily scan.
create table if not exists public.stats_cache (
  id          int primary key default 1,
  data        jsonb not null,
  computed_at timestamptz not null default now(),
  constraint stats_cache_singleton check (id = 1)
);

-- Lock the table to the backend only (service_role bypasses RLS; anon/authenticated
-- get no access since there are no policies).
alter table public.stats_cache enable row level security;

-- The once-a-day snapshot refresh scans ~188k rows; on the throttled free tier a
-- seq scan can take ~11s, past the default statement timeout. Give the backend's
-- role headroom. Only affects service_role (backend), which is trusted.
alter role service_role set statement_timeout = '60s';
