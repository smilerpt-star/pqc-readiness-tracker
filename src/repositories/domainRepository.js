const { supabase } = require("../db/supabase");

async function listDomains() {
  return supabase.from("domains").select("*").order("created_at", { ascending: false });
}

async function createDomain(payload) {
  return supabase.from("domains").insert(payload).select("*").single();
}

async function updateDomain(id, payload) {
  return supabase.from("domains").update(payload).eq("id", id).select("*").maybeSingle();
}

async function findDomainById(id) {
  return supabase.from("domains").select("*").eq("id", id).maybeSingle();
}

async function findDomainByName(domain) {
  return supabase.from("domains").select("*").eq("domain", domain).maybeSingle();
}

module.exports = {
  createDomain,
  findDomainById,
  findDomainByName,
  listDomains,
  updateDomain
};
