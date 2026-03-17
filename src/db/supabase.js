const { createClient } = require("@supabase/supabase-js");
const { env } = require("../config/env");

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

module.exports = { supabase };
