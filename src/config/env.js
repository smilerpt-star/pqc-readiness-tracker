const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

if (!process.env.ADMIN_TOKEN) {
  console.warn("[auth] ADMIN_TOKEN not set — admin routes are unprotected");
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  adminToken: process.env.ADMIN_TOKEN || null,
};

module.exports = { env };
