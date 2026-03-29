const { env } = require("../config/env");
const { createHttpError } = require("../lib/http");

function requireAuth(req, res, next) {
  if (!env.adminToken) {
    // No token configured — auth disabled (dev mode)
    return next();
  }

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || token !== env.adminToken) {
    return next(createHttpError(401, "Unauthorized"));
  }

  next();
}

module.exports = { requireAuth };
