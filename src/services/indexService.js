const indexRepository = require("../repositories/indexRepository");
const domainRepository = require("../repositories/domainRepository");
const { autoAssignTlsScan } = require("./domainTestService");
const { unwrapResult } = require("./databaseService");
const { createHttpError } = require("../lib/http");

async function listIndexes() {
  return unwrapResult(await indexRepository.listIndexes());
}

async function getIndexById(id) {
  return unwrapResult(await indexRepository.findIndexById(id), { notFoundMessage: "index not found" });
}

async function createIndex(payload) {
  return unwrapResult(await indexRepository.createIndex(payload));
}

async function updateIndex(id, payload) {
  return unwrapResult(await indexRepository.updateIndex(id, payload));
}

async function listDomainsByIndex(indexId) {
  return unwrapResult(await indexRepository.listDomainsByIndex(indexId));
}

// Bulk import: array of { domain, company_name, country, sector, rank, year }
// Deduplication: if domain already exists, reuse it — don't create duplicate
async function bulkImport(indexId, rows) {
  const results = { created: 0, existing: 0, errors: [] };

  for (const row of rows) {
    if (!row.domain) continue;
    const domainName = row.domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

    try {
      // Check if domain already exists
      let { data: existing } = await domainRepository.findDomainByDomain(domainName);

      let domainId;
      if (existing) {
        domainId = existing.id;
        results.existing++;
      } else {
        // Create new domain (active by default)
        const created = unwrapResult(
          await domainRepository.createDomain({
            domain: domainName,
            company_name: row.company_name || null,
            country: row.country || null,
            sector: row.sector || null,
            active: true,
          })
        );
        domainId = created.id;
        await autoAssignTlsScan(domainId);
        results.created++;
      }

      // Add to index (upsert — safe if already in index)
      await indexRepository.upsertDomainIndex(domainId, indexId, row.rank || null, row.year || null);
    } catch (err) {
      results.errors.push({ domain: row.domain, error: err.message });
    }
  }

  return results;
}

module.exports = { listIndexes, getIndexById, createIndex, updateIndex, listDomainsByIndex, bulkImport };
