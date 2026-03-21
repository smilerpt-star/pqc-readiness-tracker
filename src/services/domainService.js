const domainRepository = require("../repositories/domainRepository");
const { unwrapResult } = require("./databaseService");
const {
  normalizeDomain,
  optionalBoolean,
  optionalTrimmedString,
  requireObject
} = require("../lib/validation");

function buildDomainPayload(payload, options = {}) {
  const body = requireObject(payload);
  const isCreate = options.mode !== "update";
  const updatePayload = {};

  if (isCreate || body.domain !== undefined) {
    updatePayload.domain = normalizeDomain(body.domain);
  }

  if (isCreate || body.company_name !== undefined) {
    updatePayload.company_name = optionalTrimmedString(body.company_name, "company_name");
  }

  if (isCreate || body.sector !== undefined) {
    updatePayload.sector = optionalTrimmedString(body.sector, "sector");
  }

  if (isCreate || body.country !== undefined) {
    updatePayload.country = optionalTrimmedString(body.country, "country");
  }

  if (isCreate || body.notes !== undefined) {
    updatePayload.notes = optionalTrimmedString(body.notes, "notes");
  }

  if (isCreate || body.active !== undefined) {
    updatePayload.active = optionalBoolean(body.active, "active", true);
  }

  return updatePayload;
}

async function listDomains() {
  return unwrapResult(await domainRepository.listDomains());
}

async function createDomain(payload) {
  return unwrapResult(await domainRepository.createDomain(buildDomainPayload(payload)));
}

async function updateDomain(id, payload) {
  return unwrapResult(await domainRepository.updateDomain(id, buildDomainPayload(payload, { mode: "update" })), {
    notFoundMessage: "domain not found"
  });
}

async function getDomainById(id) {
  return unwrapResult(await domainRepository.findDomainById(id), {
    notFoundMessage: "domain not found"
  });
}

module.exports = {
  createDomain,
  getDomainById,
  listDomains,
  updateDomain
};
