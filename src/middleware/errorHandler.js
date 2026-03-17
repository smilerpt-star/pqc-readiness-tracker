function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.originalUrl} does not exist`
  });
}

function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: err.name || "Internal Server Error",
    message: err.message || "An unexpected error occurred"
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
