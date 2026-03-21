# pqc-readiness-tracker

Modular v2 backend for managing domains, test types, scheduled domain tests, and historical test runs. The stack stays small: Node.js, Express, Supabase, and Railway-friendly runtime conventions.

## API

- `GET /health`
- `GET /domains`
- `POST /domains`
- `PUT /domains/:id`
- `GET /test-types`
- `POST /test-types`
- `PUT /test-types/:id`
- `GET /domain-tests`
- `POST /domain-tests`
- `PUT /domain-tests/:id`
- `POST /domain-tests/:id/run`
- `GET /runs`
- `GET /runs/:id`

## Runner model

Each `test_types` record declares a `runner_type`. The API assigns a `test_type` to a `domain_test`, and `POST /domain-tests/:id/run` resolves that `runner_type` through a small registry in `src/services/runnerService.js`. The current implementation ships with one runner, `pqc_placeholder`, and keeps the execution contract simple so it can be replaced later with a real `pqcscan` integration.

## Retool fit

Retool can sit directly on top of this API as an internal admin layer. It can manage CRUD for domains, test types, and domain tests, and trigger `POST /domain-tests/:id/run` on demand while reading historical execution data from `/runs` for dashboards and operational workflows.

## Example curls

```bash
curl http://localhost:3000/health

curl http://localhost:3000/domains

curl -X POST http://localhost:3000/domains \
  -H 'Content-Type: application/json' \
  -d '{
    "domain": "example.com",
    "company_name": "Example Corp",
    "sector": "Technology",
    "country": "US",
    "notes": "Initial tracked domain"
  }'

curl -X PUT http://localhost:3000/domains/DOMAIN_ID \
  -H 'Content-Type: application/json' \
  -d '{
    "active": false,
    "notes": "Temporarily paused"
  }'

curl http://localhost:3000/test-types

curl -X POST http://localhost:3000/test-types \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "pqc_placeholder",
    "name": "PQC Placeholder",
    "description": "Simulated runner for early testing",
    "runner_type": "pqc_placeholder",
    "config_json": {
      "mode": "simulated"
    }
  }'

curl -X PUT http://localhost:3000/test-types/TEST_TYPE_ID \
  -H 'Content-Type: application/json' \
  -d '{
    "description": "Updated description"
  }'

curl http://localhost:3000/domain-tests

curl -X POST http://localhost:3000/domain-tests \
  -H 'Content-Type: application/json' \
  -d '{
    "domain_id": "DOMAIN_ID",
    "test_type_id": "TEST_TYPE_ID",
    "schedule_enabled": true,
    "schedule_frequency": "daily",
    "schedule_time": "09:00"
  }'

curl -X PUT http://localhost:3000/domain-tests/DOMAIN_TEST_ID \
  -H 'Content-Type: application/json' \
  -d '{
    "schedule_frequency": "weekly",
    "schedule_time": "14:30",
    "active": true
  }'

curl -X POST http://localhost:3000/domain-tests/DOMAIN_TEST_ID/run

curl http://localhost:3000/runs

curl http://localhost:3000/runs/RUN_ID
```
