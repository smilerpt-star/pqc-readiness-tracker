const testRunRepository = require("../repositories/testRunRepository");
const { unwrapResult } = require("./databaseService");

async function listRuns(limit) {
  return unwrapResult(await testRunRepository.listTestRuns(limit));
}

async function listRunsByDomainId(domainId, limit) {
  return unwrapResult(await testRunRepository.listTestRunsByDomainId(domainId, limit));
}

async function getRunById(id) {
  return unwrapResult(await testRunRepository.findTestRunById(id), {
    notFoundMessage: "test run not found"
  });
}

module.exports = {
  getRunById,
  listRuns,
  listRunsByDomainId
};
