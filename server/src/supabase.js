const { createClient } = require("@supabase/supabase-js");

const UPLOADS_BUCKET = process.env.SUPABASE_UPLOADS_BUCKET || "onboarding-uploads";

let client = null;

// Built lazily so that requiring this module doesn't throw at startup — the
// error surfaces on the first request that actually needs Supabase, which
// keeps the failure message next to the operation that failed.
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the server's .env file. Find both under Project Settings → API in the Supabase dashboard.",
    );
  }

  // The service role key bypasses Row Level Security, which is what we want
  // for a trusted backend — but it means this key must never be exposed to
  // the frontend. persistSession/autoRefreshToken are off because there is no
  // end user session here; the key itself is the credential.
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

module.exports = { getSupabase, UPLOADS_BUCKET };
