const { createHttpError } = require("../lib/http");

function unwrapResult(result, options = {}) {
  const { notFoundMessage } = options;

  if (result.error) {
    if (result.error.code === "23505") {
      throw createHttpError(409, result.error.message, "Conflict");
    }

    throw createHttpError(500, result.error.message, "Database Error");
  }

  if (!result.data && notFoundMessage) {
    throw createHttpError(404, notFoundMessage, "Not Found");
  }

  return result.data;
}

module.exports = {
  unwrapResult
};
