const testRunRepository = require("../repositories/testRunRepository");
const { unwrapResult } = require("./databaseService");

async function listRuns() {
  return unwrapResult(await testRunRepository.listTestRuns());
}

async function getRunById(id) {
  return unwrapResult(await testRunRepository.findTestRunById(id), {
    notFoundMessage: "test run not found"
  });
}

module.exports = {
  getRunById,
  listRuns
};
