const { supabase } = require("../db/supabase");

const domainTestSelect = `
  *,
  domain:domains(id, domain, company_name, sector, country, active),
  test_type:test_types(id, key, name, description, runner_type, config_json, active)
`;

async function listDomainTests() {
  return supabase
    .from("domain_tests")
    .select(domainTestSelect)
    .order("created_at", { ascending: false });
}

async function createDomainTest(payload) {
  return supabase.from("domain_tests").insert(payload).select("*").single();
}

async function updateDomainTest(id, payload) {
  return supabase.from("domain_tests").update(payload).eq("id", id).select("*").maybeSingle();
}

async function findDomainTestById(id) {
  return supabase.from("domain_tests").select(domainTestSelect).eq("id", id).maybeSingle();
}

module.exports = {
  createDomainTest,
  findDomainTestById,
  listDomainTests,
  updateDomainTest
};
