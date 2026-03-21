const { supabase } = require("../db/supabase");

const testRunSelect = `
  *,
  domain_test:domain_tests(
    id,
    domain_id,
    test_type_id,
    active,
    schedule_enabled,
    schedule_frequency,
    schedule_time,
    last_run_at,
    next_run_at,
    last_status,
    last_score,
    domain:domains(id, domain, company_name),
    test_type:test_types(id, key, name, runner_type)
  )
`;

async function createTestRun(payload) {
  return supabase.from("test_runs").insert(payload).select("*").single();
}

async function updateTestRun(id, payload) {
  return supabase.from("test_runs").update(payload).eq("id", id).select("*").maybeSingle();
}

async function listTestRuns() {
  return supabase
    .from("test_runs")
    .select(testRunSelect)
    .order("created_at", { ascending: false });
}

async function findTestRunById(id) {
  return supabase.from("test_runs").select(testRunSelect).eq("id", id).maybeSingle();
}

module.exports = {
  createTestRun,
  findTestRunById,
  listTestRuns,
  updateTestRun
};
