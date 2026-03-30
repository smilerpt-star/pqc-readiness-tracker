const { supabase } = require("../db/supabase");

async function listIndexes() {
  return supabase
    .from("indexes")
    .select("*, domain_count:domain_indexes(count)")
    .order("created_at", { ascending: false });
}

async function findIndexById(id) {
  return supabase
    .from("indexes")
    .select("*, domain_count:domain_indexes(count)")
    .eq("id", id)
    .maybeSingle();
}

async function findIndexByKey(key) {
  return supabase.from("indexes").select("*").eq("key", key).maybeSingle();
}

async function createIndex(payload) {
  return supabase.from("indexes").insert(payload).select("*").single();
}

async function updateIndex(id, payload) {
  return supabase.from("indexes").update(payload).eq("id", id).select("*").maybeSingle();
}

async function upsertDomainIndex(domainId, indexId, rank, year) {
  return supabase
    .from("domain_indexes")
    .upsert({ domain_id: domainId, index_id: indexId, rank, year }, { onConflict: "domain_id,index_id" })
    .select("*")
    .single();
}

async function listDomainsByIndex(indexId) {
  return supabase
    .from("domain_indexes")
    .select("rank, year, domain:domains(id, domain, company_name, country, sector, active)")
    .eq("index_id", indexId)
    .order("rank", { ascending: true, nullsFirst: false });
}

module.exports = { listIndexes, findIndexById, findIndexByKey, createIndex, updateIndex, upsertDomainIndex, listDomainsByIndex };
