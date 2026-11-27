const crypto = require("crypto");
const { env } = require("../config/env");
const { createHttpError } = require("../lib/http");

// Length-aware constant-time comparison to avoid leaking the token via timing.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Non-throwing check: true only for a request carrying the valid admin token.
function isAdmin(req) {
  if (!env.adminToken) return false;
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return Boolean(token) && safeEqual(token, env.adminToken);
}

function requireAuth(req, res, next) {
  if (!env.adminToken) {
    // Fail closed: never leave admin routes open if the token is misconfigured.
    return next(createHttpError(503, "Admin authentication is not configured"));
  }

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || !safeEqual(token, env.adminToken)) {
    return next(createHttpError(401, "Unauthorized"));
  }

  next();
}

module.exports = { requireAuth, isAdmin };
