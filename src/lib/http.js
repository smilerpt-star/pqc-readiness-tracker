function createHttpError(statusCode, message, name = "Bad Request") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.name = name;
  return error;
}

module.exports = {
  createHttpError
};
