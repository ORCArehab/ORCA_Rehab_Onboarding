const { getSupabase } = require("./supabase");

const TABLE = "quickbooks_tokens";

// QuickBooks OAuth tokens used to live in server/tokens.json. They're in
// Postgres now so the backend keeps no state on disk and a redeploy doesn't
// silently disconnect QuickBooks. A single pinned row (id = 1) holds them.
const SINGLETON_ID = 1;

async function saveTokens(tokens) {
  const { error } = await getSupabase()
    .from(TABLE)
    .upsert({ id: SINGLETON_ID, tokens, updated_at: new Date().toISOString() });

  if (error) {
    throw new Error(`Failed to store QuickBooks tokens: ${error.message}`);
  }
}

async function loadTokens() {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("tokens")
    .eq("id", SINGLETON_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read QuickBooks tokens: ${error.message}`);
  }

  return data?.tokens ?? null;
}

module.exports = { saveTokens, loadTokens };
