const { supabase } = require("../db/supabase");

async function listTestTypes() {
  return supabase.from("test_types").select("*").order("created_at", { ascending: false });
}

async function createTestType(payload) {
  return supabase.from("test_types").insert(payload).select("*").single();
}

async function updateTestType(id, payload) {
  return supabase.from("test_types").update(payload).eq("id", id).select("*").maybeSingle();
}

async function findTestTypeById(id) {
  return supabase.from("test_types").select("*").eq("id", id).maybeSingle();
}

module.exports = {
  createTestType,
  findTestTypeById,
  listTestTypes,
  updateTestType
};
