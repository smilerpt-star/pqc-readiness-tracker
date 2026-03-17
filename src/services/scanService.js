const {
  getDomainByName,
  normalizeDomain,
  createHttpError
} = require("./domainService");
const { supabase } = require("../db/supabase");

function hashString(input) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function buildPlaceholderScanSummary(domain) {
  const hash = hashString(domain);
  const score = 35 + (hash % 51);
  const hasTls13 = hash % 2 === 0;
  const hasEcdsaCert = hash % 3 === 0;
  const dnssecEnabled = hash % 5 === 0;
  const keyExchange = hasTls13 ? "X25519" : "secp256r1";
  const status = score >= 75 ? "readying" : score >= 55 ? "partial" : "legacy";

  return {
    status,
    score,
    summary_json: {
      scan_version: "placeholder-v1",
      scan_mode: "simulated",
      scanned_target: domain,
      transport: {
        tls_versions: hasTls13 ? ["TLSv1.3", "TLSv1.2"] : ["TLSv1.2"],
        key_exchange: keyExchange,
        server_preference: hasTls13 ? "modern" : "mixed"
      },
      certificate: {
        public_key_algorithm: hasEcdsaCert ? "ECDSA" : "RSA",
        signature_algorithm: hasEcdsaCert ? "ecdsa-with-SHA384" : "sha256WithRSAEncryption",
        days_until_expiry: 30 + (hash % 300)
      },
      dns: {
        dnssec_enabled: dnssecEnabled
      },
      pqc_outlook: {
        exposure_level: score >= 75 ? "lower" : score >= 55 ? "medium" : "higher",
        likely_risks: [
          "No post-quantum handshake validation yet",
          "Classical certificate chain in use",
          "Internet-facing TLS endpoint may need inventory follow-up"
        ],
        next_actions: [
          "Inventory cryptographic dependencies for this domain",
          "Track TLS and certificate algorithm changes over time",
          "Replace this simulator with a real pqcscan execution step"
        ]
      }
    }
  };
}

async function createScanForDomain(payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object");
  }

  const normalizedDomain = normalizeDomain(payload.domain);
  const domainRecord = await getDomainByName(normalizedDomain);

  if (!domainRecord) {
    throw createHttpError(404, "domain not found; create it first", "Not Found");
  }

  const simulatedResult = buildPlaceholderScanSummary(normalizedDomain);

  const insertPayload = {
    domain_id: domainRecord.id,
    status: simulatedResult.status,
    score: simulatedResult.score,
    summary_json: simulatedResult.summary_json
  };

  const { data, error } = await supabase
    .from("scans")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    throw createHttpError(500, error.message, "Database Error");
  }

  return {
    ...data,
    domain: domainRecord.domain
  };
}

async function getScanHistoryByDomain(domain) {
  const normalizedDomain = normalizeDomain(domain);
  const domainRecord = await getDomainByName(normalizedDomain);

  if (!domainRecord) {
    throw createHttpError(404, "domain not found", "Not Found");
  }

  const { data, error } = await supabase
    .from("scans")
    .select("*")
    .eq("domain_id", domainRecord.id)
    .order("scanned_at", { ascending: false });

  if (error) {
    throw createHttpError(500, error.message, "Database Error");
  }

  return {
    domain: domainRecord.domain,
    company_name: domainRecord.company_name,
    scans: data
  };
}

module.exports = {
  createScanForDomain,
  getScanHistoryByDomain,
  buildPlaceholderScanSummary
};
