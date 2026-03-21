insert into public.test_types (
  key,
  name,
  description,
  runner_type,
  config_json,
  active
)
values (
  'pqc_placeholder',
  'PQC Placeholder',
  'Simulated PQC readiness runner used until real pqcscan integration is wired in.',
  'pqc_placeholder',
  '{"mode":"simulated","version":"placeholder-v2"}'::jsonb,
  true
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  runner_type = excluded.runner_type,
  config_json = excluded.config_json,
  active = excluded.active;
