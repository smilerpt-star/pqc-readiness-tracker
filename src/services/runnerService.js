const { createHttpError } = require("../lib/http");
const tlsRunner = require("./runners/tlsRunner");

const runners = {
  tls_scan: tlsRunner,
};

function getRunner(runnerType) {
  const runner = runners[runnerType];

  if (!runner) {
    throw createHttpError(400, `Unsupported runner_type: ${runnerType}`);
  }

  return runner;
}

module.exports = {
  getRunner
};
