-- Server-side aggregation for /stats.
-- Moves the heavy work (trends + today/yesterday deltas) into Postgres so the
-- API no longer pulls a full year of test_runs into Node just to bucket them.
-- Run this in the Supabase SQL editor. All dates are computed in UTC to match
-- the previous JS implementation.

create or replace function public.stats_trend_daily()
returns table(day date, avg_score int, count int)
language sql stable as $$
  select (started_at at time zone 'UTC')::date as day,
         round(avg(score))::int                 as avg_score,
         count(*)::int                           as count
  from public.test_runs
  where score is not null
    and started_at >= now() - interval '30 days'
  group by 1
  order by 1;
$$;

create or replace function public.stats_trend_weekly()
returns table(week date, avg_score int, count int)
language sql stable as $$
  select date_trunc('week', started_at at time zone 'UTC')::date as week,
         round(avg(score))::int                                   as avg_score,
         count(*)::int                                            as count
  from public.test_runs
  where score is not null
    and started_at >= now() - interval '12 weeks'
  group by 1
  order by 1;
$$;

create or replace function public.stats_trend_monthly()
returns table(month text, avg_score int, count int)
language sql stable as $$
  select to_char(date_trunc('month', started_at at time zone 'UTC'), 'YYYY-MM') as month,
         round(avg(score))::int                                                  as avg_score,
         count(*)::int                                                           as count
  from public.test_runs
  where score is not null
    and started_at >= now() - interval '12 months'
  group by 1
  order by 1;
$$;

create or replace function public.stats_delta_1d()
returns table(dimension text, label text, today_avg int, yesterday_avg int)
language sql stable as $$
  with bounds as (
    select (now() at time zone 'UTC')::date as today
  ),
  r2 as (
    select r.score,
           (r.started_at at time zone 'UTC')::date as day,
           d.country,
           d.sector
    from public.test_runs r
    join public.domain_tests dt on dt.id = r.domain_test_id
    join public.domains d       on d.id  = dt.domain_id
    cross join bounds
    where r.score is not null
      -- Sargable range on the raw column so idx_test_runs_started_at is used
      -- (only ~2 days of rows scanned) instead of a full-table scan.
      and r.started_at >= ((bounds.today - 1)::timestamp at time zone 'UTC')
      and r.started_at <  ((bounds.today + 1)::timestamp at time zone 'UTC')
  )
  select 'country' as dimension,
         country   as label,
         round(avg(score) filter (where day = (now() at time zone 'UTC')::date))::int     as today_avg,
         round(avg(score) filter (where day = (now() at time zone 'UTC')::date - 1))::int as yesterday_avg
  from r2 where country is not null group by country
  union all
  select 'sector',
         sector,
         round(avg(score) filter (where day = (now() at time zone 'UTC')::date))::int,
         round(avg(score) filter (where day = (now() at time zone 'UTC')::date - 1))::int
  from r2 where sector is not null group by sector;
$$;
