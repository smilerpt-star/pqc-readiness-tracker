const { scanDomain } = require("./runners/tlsRunner");
const { normalizeDomain, requireObject } = require("../lib/validation");
const { createHttpError } = require("../lib/http");

async function runPublicTest(payload) {
  const body = requireObject(payload);
  const domain = normalizeDomain(body.domain);

  let result;
  try {
    result = await scanDomain(domain);
  } catch (err) {
    throw createHttpError(422, `Unable to scan ${domain}: ${err.message}`);
  }

  return {
    domain,
    scanned_at: new Date().toISOString(),
    status: result.status,
    score: result.score,
    transport: result.summary.transport,
    certificate: result.summary.certificate,
    dns: result.summary.dns,
    pqc_outlook: result.summary.pqc_outlook,
  };
}

module.exports = { runPublicTest };
