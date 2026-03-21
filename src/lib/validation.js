const { createHttpError } = require("./http");

function requireObject(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createHttpError(400, "Request body must be a JSON object");
  }

  return payload;
}

function normalizeDomain(value) {
  if (typeof value !== "string") {
    throw createHttpError(400, "domain must be a string");
  }

  const normalized = value.trim().toLowerCase();
  const domainPattern = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

  if (!domainPattern.test(normalized)) {
    throw createHttpError(400, "domain must be a valid hostname");
  }

  return normalized;
}

function optionalTrimmedString(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string`);
  }

  return value.trim();
}

function requiredTrimmedString(value, fieldName) {
  const normalized = optionalTrimmedString(value, fieldName);

  if (!normalized) {
    throw createHttpError(400, `${fieldName} is required`);
  }

  return normalized;
}

function optionalBoolean(value, fieldName, defaultValue = undefined) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw createHttpError(400, `${fieldName} must be a boolean`);
  }

  return value;
}

function optionalJsonObject(value, fieldName, defaultValue = undefined) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createHttpError(400, `${fieldName} must be a JSON object`);
  }

  return value;
}

function optionalEnum(value, fieldName, allowedValues, defaultValue = undefined) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!allowedValues.includes(value)) {
    throw createHttpError(
      400,
      `${fieldName} must be one of: ${allowedValues.join(", ")}`
    );
  }

  return value;
}

function parseIdParam(value, fieldName = "id") {
  if (typeof value !== "string" || !value.trim()) {
    throw createHttpError(400, `${fieldName} must be provided`);
  }

  return value.trim();
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw createHttpError(400, `${fieldName} must be an integer`);
  }

  return value;
}

function optionalTime(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string in HH:MM format`);
  }

  const normalized = value.trim();

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(normalized)) {
    throw createHttpError(400, `${fieldName} must be a valid HH:MM or HH:MM:SS value`);
  }

  return normalized.length === 5 ? `${normalized}:00` : normalized;
}

module.exports = {
  normalizeDomain,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalJsonObject,
  optionalTime,
  optionalTrimmedString,
  parseIdParam,
  requireObject,
  requiredTrimmedString
};
