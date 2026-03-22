const { createHttpError } = require("../lib/http");
const pqcPlaceholderRunner = require("./runners/pqcPlaceholderRunner");
const tlsRunner = require("./runners/tlsRunner");

const runners = {
  pqc_placeholder: pqcPlaceholderRunner,
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
