const testTypeRepository = require("../repositories/testTypeRepository");
const { unwrapResult } = require("./databaseService");
const { createHttpError } = require("../lib/http");
const {
  optionalBoolean,
  optionalJsonObject,
  optionalTrimmedString,
  requireObject,
  requiredTrimmedString
} = require("../lib/validation");

function normalizeKey(value) {
  const normalized = requiredTrimmedString(value, "key").toLowerCase();

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw createHttpError(
      400,
      "key must contain only lowercase letters, numbers, and underscores"
    );
  }

  return normalized;
}

function buildTestTypePayload(payload, options = {}) {
  const body = requireObject(payload);
  const isCreate = options.mode !== "update";
  const updatePayload = {};

  if (isCreate || body.key !== undefined) {
    updatePayload.key = normalizeKey(body.key);
  }

  if (isCreate || body.name !== undefined) {
    updatePayload.name = requiredTrimmedString(body.name, "name");
  }

  if (isCreate || body.description !== undefined) {
    updatePayload.description = optionalTrimmedString(body.description, "description");
  }

  if (isCreate || body.runner_type !== undefined) {
    updatePayload.runner_type = requiredTrimmedString(body.runner_type, "runner_type");
  }

  if (isCreate || body.config_json !== undefined) {
    updatePayload.config_json = optionalJsonObject(body.config_json, "config_json", {});
  }

  if (isCreate || body.active !== undefined) {
    updatePayload.active = optionalBoolean(body.active, "active", true);
  }

  return updatePayload;
}

async function listTestTypes() {
  return unwrapResult(await testTypeRepository.listTestTypes());
}

async function createTestType(payload) {
  return unwrapResult(await testTypeRepository.createTestType(buildTestTypePayload(payload)));
}

async function updateTestType(id, payload) {
  return unwrapResult(await testTypeRepository.updateTestType(id, buildTestTypePayload(payload, { mode: "update" })), {
    notFoundMessage: "test type not found"
  });
}

async function getTestTypeById(id) {
  return unwrapResult(await testTypeRepository.findTestTypeById(id), {
    notFoundMessage: "test type not found"
  });
}

module.exports = {
  createTestType,
  getTestTypeById,
  listTestTypes,
  updateTestType
};
