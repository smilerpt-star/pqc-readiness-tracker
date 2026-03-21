const domainTestRepository = require("../repositories/domainTestRepository");
const testRunRepository = require("../repositories/testRunRepository");
const { unwrapResult } = require("./databaseService");
const { getDomainById } = require("./domainService");
const { getTestTypeById } = require("./testTypeService");
const { getRunner } = require("./runnerService");
const {
  calculateNextRunAt,
  normalizeScheduleSettings
} = require("./scheduleService");
const {
  optionalBoolean,
  optionalInteger,
  optionalTrimmedString,
  parseIdParam,
  requireObject
} = require("../lib/validation");
const { createHttpError } = require("../lib/http");

function buildDomainTestPayload(payload, options = {}) {
  const body = requireObject(payload);
  const isCreate = options.mode !== "update";
  const scheduleSettings = normalizeScheduleSettings(body, options);
  const updatePayload = {
    ...scheduleSettings
  };

  if (isCreate || body.domain_id !== undefined) {
    updatePayload.domain_id = parseIdParam(body.domain_id, "domain_id");
  }

  if (isCreate || body.test_type_id !== undefined) {
    updatePayload.test_type_id = parseIdParam(body.test_type_id, "test_type_id");
  }

  if (isCreate || body.active !== undefined) {
    updatePayload.active = optionalBoolean(body.active, "active", true);
  }

  if (isCreate || body.last_status !== undefined) {
    updatePayload.last_status = optionalTrimmedString(body.last_status, "last_status");
  }

  if (isCreate || body.last_score !== undefined) {
    updatePayload.last_score = optionalInteger(body.last_score, "last_score");
  }

  if (
    updatePayload.schedule_enabled !== undefined ||
    updatePayload.schedule_frequency !== undefined ||
    updatePayload.schedule_time !== undefined
  ) {
    const scheduleEnabled = updatePayload.schedule_enabled ?? false;
    const scheduleFrequency = updatePayload.schedule_frequency ?? "manual";
    const scheduleTime = updatePayload.schedule_time ?? null;

    updatePayload.next_run_at = calculateNextRunAt(
      scheduleFrequency,
      scheduleEnabled,
      scheduleTime,
      new Date()
    );
  }

  return updatePayload;
}

async function validateReferences(payload) {
  if (payload.domain_id) {
    await getDomainById(payload.domain_id);
  }

  if (payload.test_type_id) {
    const testType = await getTestTypeById(payload.test_type_id);

    if (!testType.active) {
      throw createHttpError(400, "test type must be active before it can be assigned");
    }
  }
}

async function listDomainTests() {
  return unwrapResult(await domainTestRepository.listDomainTests());
}

async function createDomainTest(payload) {
  const insertPayload = buildDomainTestPayload(payload);
  await validateReferences(insertPayload);
  const created = unwrapResult(await domainTestRepository.createDomainTest(insertPayload));

  return unwrapResult(await domainTestRepository.findDomainTestById(created.id), {
    notFoundMessage: "domain test not found"
  });
}

async function updateDomainTest(id, payload) {
  const updatePayload = buildDomainTestPayload(payload, { mode: "update" });
  await validateReferences(updatePayload);
  const updated = unwrapResult(await domainTestRepository.updateDomainTest(id, updatePayload), {
    notFoundMessage: "domain test not found"
  });

  return unwrapResult(await domainTestRepository.findDomainTestById(updated.id), {
    notFoundMessage: "domain test not found"
  });
}

async function getDomainTestById(id) {
  return unwrapResult(await domainTestRepository.findDomainTestById(id), {
    notFoundMessage: "domain test not found"
  });
}

async function runDomainTest(id, triggeredBy = "api") {
  const domainTest = await getDomainTestById(id);

  if (!domainTest.active) {
    throw createHttpError(400, "domain test is inactive");
  }

  if (!domainTest.domain || !domainTest.test_type) {
    throw createHttpError(500, "domain test is missing related domain or test type");
  }

  if (!domainTest.test_type.active) {
    throw createHttpError(400, "assigned test type is inactive");
  }

  const startedAt = new Date().toISOString();
  const createdRun = unwrapResult(
    await testRunRepository.createTestRun({
      domain_test_id: id,
      started_at: startedAt,
      status: "running",
      triggered_by: triggeredBy
    })
  );

  try {
    const runner = getRunner(domainTest.test_type.runner_type);
    const runnerResult = await runner.run({
      domainTest,
      domain: domainTest.domain,
      testType: domainTest.test_type
    });
    const finishedAt = new Date().toISOString();
    const nextRunAt = calculateNextRunAt(
      domainTest.schedule_frequency,
      domainTest.schedule_enabled,
      domainTest.schedule_time,
      new Date(finishedAt)
    );

    await unwrapResult(
      await testRunRepository.updateTestRun(createdRun.id, {
        finished_at: finishedAt,
        status: runnerResult.status,
        score: runnerResult.score,
        summary_json: runnerResult.summary,
        raw_json: runnerResult.raw,
        error_message: null
      }),
      { notFoundMessage: "test run not found" }
    );

    await unwrapResult(
      await domainTestRepository.updateDomainTest(id, {
        last_run_at: finishedAt,
        next_run_at: nextRunAt,
        last_status: runnerResult.status,
        last_score: runnerResult.score
      }),
      { notFoundMessage: "domain test not found" }
    );
  } catch (error) {
    const finishedAt = new Date().toISOString();

    await unwrapResult(
      await testRunRepository.updateTestRun(createdRun.id, {
        finished_at: finishedAt,
        status: "failed",
        error_message: error.message
      }),
      { notFoundMessage: "test run not found" }
    );

    await unwrapResult(
      await domainTestRepository.updateDomainTest(id, {
        last_run_at: finishedAt,
        last_status: "failed"
      }),
      { notFoundMessage: "domain test not found" }
    );

    throw error;
  }

  return unwrapResult(await testRunRepository.findTestRunById(createdRun.id), {
    notFoundMessage: "test run not found"
  });
}

module.exports = {
  createDomainTest,
  getDomainTestById,
  listDomainTests,
  runDomainTest,
  updateDomainTest
};
