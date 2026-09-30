# ORCA Rehab Onboarding

New employee onboarding portal for ORCA Rehab.

## What it does

Collects a new hire's **employee information** — name, date of birth, phone, degree, home address, SSN, driver's license photo, resume — and saves it for HR/Payroll to review. Policy agreement signing now happens through a separate tool, not this portal.

## Getting started (frontend)

```bash
npm install
npm run dev
```

Built with Vite, React, and TypeScript.

## Backend

The frontend can't safely hold the encryption key or admin credentials, so an Express server in [server/](server/) handles submission storage and the HR/Payroll admin login. It shares the root `package.json` — there's a single `npm install` for the whole project. (`server/package.json` exists only to mark that directory as CommonJS, since the root is an ES module package.)

```bash
cp server/.env.example server/.env
```

Start the server (from the repo root, in a second terminal):

```bash
npm run dev:server
```

## Data storage and HR/Payroll dashboard

Every submission is saved to **Supabase** (Postgres + Storage). Sensitive fields (SSN) are encrypted with AES-256-GCM *by the app, before they're sent to Supabase*, so the database only ever holds ciphertext for those. Uploaded files (driver's license photo, resume) go to a private Storage bucket.

### Supabase setup

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. Open the **SQL Editor** and run [server/supabase/schema.sql](server/supabase/schema.sql). This creates the `submissions` and `session` tables, creates the private `onboarding-uploads` bucket, and enables Row Level Security on everything.
3. Copy three values into `server/.env`:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → **API**
   - `DATABASE_URL` — Project Settings → **Database** → Connection string → URI (swap in your database password)

The **service role key bypasses Row Level Security**. It belongs only in the backend's environment — never in the frontend, and never committed. The tables have RLS on with no policies, so the `anon` key (which *is* public) can't read anything even if it leaks.

`DATABASE_URL` is used for one thing: storing admin login sessions in Postgres so an HR/Payroll user stays logged in across a restart or redeploy. Leave it blank and sessions fall back to in-memory — fine locally, but every deploy logs everyone out, and on serverless logins never persist at all.

### How file uploads work

Uploaded files never pass through the backend. The browser asks `POST /api/onboarding/upload-url` for a short-lived signed URL, `PUT`s the file straight to Supabase Storage, and sends only the resulting path along with the submission.

This is what keeps large driver's license photos working: a request routed through the backend would hit the host's request body limit (4.5 MB on Vercel), and phone photos routinely exceed that.

The path is generated server-side, so a client can't pick where its file lands. It does have to hand that path back at submit time though — and nothing would stop it returning *someone else's* path — so each issued path comes with an HMAC that the submit handler verifies before saving. It also confirms the object actually exists, so a submission can never reference a file that was never uploaded.

One consequence worth knowing: a new hire who uploads a file and then abandons the form leaves an orphaned object in the bucket. Nothing breaks, but it's worth periodically removing bucket objects not referenced by any row in `submissions`.

### Migrating off the old local SQLite database

Earlier versions stored submissions in `server/data.db` and files in `server/uploads/`. To carry existing data over:

```bash
npm install --no-save better-sqlite3                         # only needed for this
node server/scripts/migrate-sqlite-to-supabase.js            # dry run — prints what it would do
node server/scripts/migrate-sqlite-to-supabase.js --commit   # actually migrates
```

`better-sqlite3` isn't a project dependency on purpose — it's a native addon needed only by this script, and leaving it out means nothing has to compile during a deployment build.

Keep `ENCRYPTION_KEY` unchanged — the script copies the encrypted blobs verbatim without opening them, so a different key makes migrated rows unreadable. Postgres assigns fresh ids rather than reusing the SQLite ones, which means the script is **not** idempotent: running it twice with `--commit` imports everything twice. Once the dashboard looks right, delete `server/data.db` and `server/uploads/`.

### Other environment variables

Set these in `server/.env` too (see `.env.example` for the full list):

- `ENCRYPTION_KEY` — 64-character hex string. Generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `SESSION_SECRET` — any long random string, for signing the admin login session.

### HR/Payroll admin login (Google Workspace SSO)

HR/Payroll signs in with their company Google account — there's no separate username/password to create or rotate.

1. Create an OAuth client at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) (type: **Web application**). On the OAuth consent screen, set the user type to **Internal** — this restricts sign-in to accounts in your Workspace org at the Google level, before this app's own checks ever run.
2. Add an Authorized redirect URI of `{APP_URL}/api/admin/login/google/callback` — e.g. `http://localhost:5173/api/admin/login/google/callback` for local dev, or your production domain's equivalent.
3. Copy the client ID and secret into `server/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Set `GOOGLE_WORKSPACE_DOMAIN` to your company's domain (e.g. `orcarehab.com`).
5. **Recommended:** set `ORCA_API_URL` and `ORCA_API_KEY` to use the roles shared across ORCA apps. Anyone with the `HR` or `ADMIN` role (granted in the employee portal at `/admin/people`) can sign in, and access is re-checked against the API every minute, so revoking a role or deactivating someone locks them out within a minute. If the API can't be reached, the dashboard refuses access rather than assuming. With these set, `ADMIN_ALLOWED_EMAILS` is ignored.
6. Otherwise (e.g. local dev), set `ADMIN_ALLOWED_EMAILS` to a comma-separated list of the specific people who should have access (e.g. `hr@orcarehab.com,payroll@orcarehab.com`). This dashboard holds SSNs and other PII, and an "Internal" consent screen admits your *whole* Workspace org — leaving this blank falls back to allowing anyone on `GOOGLE_WORKSPACE_DOMAIN`, which is broader than most companies want for this page.

Optionally, fill in the `SMTP_*` and `NOTIFY_EMAIL_TO` variables to get an email notification whenever a new submission comes in. Leave them blank to skip notifications entirely (nothing breaks — it just logs a warning and moves on).

Optionally, set `OPENAI_API_KEY` to turn on AI document verification: at submit time, the backend downloads each credentialing document (board certificate, DEA certificate, professional liability, state medical license, BLS/ACLS certificates) and asks an OpenAI vision model whether it actually looks like that kind of document, rejecting the submission with a specific error if one doesn't (e.g. a driver's license photo uploaded where a DEA certificate was expected). Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). `OPENAI_MODEL` defaults to `gpt-5.4-mini` if unset. Leave `OPENAI_API_KEY` blank to skip this check entirely — uploads still work, they just aren't verified.

With both the frontend (`npm run dev`) and backend (`npm run dev:server`) running, HR/Payroll can log in at:

```
http://localhost:5173/admin
```

This is part of the React app (not the backend), reusing the onboarding portal's own styling, to see every submission (name, date), view full details with inline document previews and AI verification badges, download the full credentialing document package as a ZIP (formatted to match ORCA's existing manual folder structure — see `server/src/credentialingPackage.js`), and remove a submission once it's been processed.

In local dev, the Vite dev server proxies `/api` requests to the backend on port 4000, so everything is same-origin and the session cookie just works. In production on Vercel it is genuinely same-origin, so no proxy is involved.

## Deploying

Frontend and backend deploy together as a **single Vercel project**. The Express app becomes one Vercel Function serving `/api/*`, and the Vite build is served as static files from the same domain. Because they share an origin there is no CORS and no cross-site cookie handling — which is why `FRONTEND_ORIGIN` should stay unset in production.

This only works because the backend keeps **no state on disk**: database, uploaded files, and login sessions all live in Supabase.

How it fits together:

| File | Role |
|---|---|
| [api/index.js](api/index.js) | Vercel Function entrypoint — re-exports the Express app |
| [server/src/app.js](server/src/app.js) | The app itself; no `listen()`, so it works in both places |
| [server/src/index.js](server/src/index.js) | Local dev only — loads `.env` and calls `listen()` |
| [vercel.json](vercel.json) | Routes `/api/*` to the function, everything else to `index.html` |

### 1. Set environment variables

In the Vercel project settings, add every variable from `server/.env` — Supabase credentials, `ENCRYPTION_KEY`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_WORKSPACE_DOMAIN`/`ADMIN_ALLOWED_EMAILS` — with these differences:

- `NODE_ENV=production` — makes the login cookie `Secure`.
- `DATABASE_URL` — **must** be Supabase's pooled connection string (Project Settings → Database → **Connection pooling**, port `6543`), not the direct `:5432` one. Every function invocation opens its own connection and direct Postgres runs out of slots fast.
- `FRONTEND_ORIGIN` — leave **unset**. Setting it turns on CORS and switches the cookie to `SameSite=None`, which you only want if you later split the frontend onto its own domain.
- `VITE_API_URL` — leave **unset**. The frontend falls back to relative `/api` paths, which is exactly right when both halves share a domain.
- `APP_URL` — set to your production domain (e.g. `https://onboarding.orcarehab.com`). It's used both for the applicant password-reset email link and to build the Google OAuth redirect URI, which must also be added as an Authorized redirect URI on the OAuth client in Google Cloud Console.

Don't set `PORT`; Vercel manages that.

### 2. Deploy and verify

Import the repo at [vercel.com/new](https://vercel.com/new) and deploy. Then check the function is wired up correctly:

```bash
curl https://your-app.vercel.app/api/health
```

Expect `{"ok":true,"path":"/api/health","supabaseConfigured":true,"sessionStore":"postgres","crossSite":false}`.

The `path` field is the thing to look at. It confirms the platform forwarded the **full** request path to Express rather than a truncated one — every other route depends on that. If you get a 404 here, or `path` comes back as just `/api`, the rewrite in `vercel.json` isn't doing what it should; see [Express on Vercel](https://vercel.com/docs/frameworks/backend/express).

### Deploying the backend elsewhere instead

Nothing forces the single-project layout. To run the backend on Render, Railway, Fly.io, or a VPS instead, point the host at the repo root with `npm start` (which runs `server/src/index.js`), then set `FRONTEND_ORIGIN` to your frontend's URL and `VITE_API_URL` to the backend's. That re-enables CORS and `SameSite=None` cookies for the cross-domain setup.
