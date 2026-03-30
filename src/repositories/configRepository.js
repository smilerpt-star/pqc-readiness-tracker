const { supabase } = require("../db/supabase");

async function getConfig(key) {
  const { data, error } = await supabase.from("system_config").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function setConfig(key, value) {
  const { data, error } = await supabase
    .from("system_config")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function getAllConfig() {
  const { data, error } = await supabase.from("system_config").select("*").order("key");
  if (error) throw error;
  return data || [];
}

module.exports = { getConfig, setConfig, getAllConfig };
