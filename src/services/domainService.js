const { supabase } = require("../db/supabase");

function createHttpError(statusCode, message, name = "Bad Request") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.name = name;
  return error;
}

function normalizeDomain(value) {
  if (typeof value !== "string") {
    throw createHttpError(400, "domain must be a string");
  }

  const normalized = value.trim().toLowerCase();
  const domainPattern = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

  if (!domainPattern.test(normalized)) {
    throw createHttpError(400, "domain must be a valid hostname");
  }

  return normalized;
}

function validateCompanyName(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw createHttpError(400, "company_name must be a string");
  }

  return value.trim();
}

function validateActive(value) {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "boolean") {
    throw createHttpError(400, "active must be a boolean");
  }

  return value;
}

async function createDomain(payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object");
  }

  const insertPayload = {
    domain: normalizeDomain(payload.domain),
    company_name: validateCompanyName(payload.company_name),
    active: validateActive(payload.active)
  };

  const { data, error } = await supabase
    .from("domains")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw createHttpError(409, "domain already exists", "Conflict");
    }

    throw createHttpError(500, error.message, "Database Error");
  }

  return data;
}

async function listDomains() {
  const { data, error } = await supabase
    .from("domains")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(500, error.message, "Database Error");
  }

  return data;
}

async function getDomainByName(domain) {
  const normalizedDomain = normalizeDomain(domain);

  const { data, error } = await supabase
    .from("domains")
    .select("*")
    .eq("domain", normalizedDomain)
    .maybeSingle();

  if (error) {
    throw createHttpError(500, error.message, "Database Error");
  }

  return data;
}

module.exports = {
  createDomain,
  listDomains,
  getDomainByName,
  normalizeDomain,
  createHttpError
};
