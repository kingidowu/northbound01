# The Career Architect

Career-services platform: a smart assessment, AI career snapshot, a **verified job board**, and a **recruiter portal** for posting listings. General career services — any field, any stage.

| Page | What it is |
|---|---|
| [index.html](index.html) | Landing page + AI career assessment |
| [jobs.html](jobs.html) | Public job board with search/filters |
| [agent.html](agent.html) | Recruiter portal — sign up, profile, post & manage listings |

## Database (Supabase) — required for jobs + recruiter portal

1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**, paste all of [supabase/schema.sql](supabase/schema.sql), and run it. This creates the `agent_profiles` and `jobs` tables, the `jobs_public` view, and Row Level Security policies.
3. Put your project URL + **publishable** (anon) key in [config.js](config.js). The publishable key is *meant* to be public — your data is protected by the RLS policies, not by hiding the key.
4. **Auth → Providers → Email:** for smooth testing, turn **off** "Confirm email" (Settings → Authentication) so recruiters can sign in immediately. Leave it on in production if you want email verification.
5. To mark a recruiter **verified** (the ✓ badge on listings), flip `verified = true` on their row in the `agent_profiles` table (Supabase Table Editor).

---

## AI knowledge library

Every resume (via the ATS check) and every assessment is run through Claude to extract structured knowledge (field, seniority, skills, common gaps, keywords) into the `knowledge_library` table. Recent entries are fed back as context to the ATS check and the assessment snapshot, so the tools sharpen as volume grows. Submissions are also stored in `assessments`, and the admin page surfaces both.

**Requires one server-side env var on Vercel** (in addition to `ANTHROPIC_API_KEY`):
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase → Settings → API → `service_role` secret. **Server-only — never put this in `config.js` or any page.** Writes bypass RLS; the admin reads via the `is_admin()` policy.
- `SUPABASE_URL` — same project URL as in `config.js` (set it as a Vercel env var too so the functions can reach Supabase).

If those aren't set, the AI tools still work — they just skip the library (no learning, no storage).

## AI job matching

`/api/match` ([api/match.js](api/match.js)) takes a pasted resume, scores it against every published job with Claude (adaptive thinking), and the job board (`jobs.html`) sorts roles best-match-first with a % badge and one-line reason. `jobs.html` also injects `JobPosting` structured data so listings can surface in Google Jobs.

## Rate limiting the AI endpoints

All AI endpoints (`/api/ats`, `/api/assess`, `/api/cover`, `/api/match`) are per-IP rate limited via [lib/ratelimit.js](lib/ratelimit.js) to protect your Anthropic spend. For **global** limits across all serverless instances, add an Upstash Redis (free tier) and set these Vercel env vars:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Without them it falls back to per-instance in-memory limiting. Each function also hard-caps input length and `max_tokens` regardless.

## Original brand note

Previously branded "Northbound" (remote IT + visa sponsorship). Now **The Career Architect**, general career services.

A static `index.html` (no build step) with a 6-step career assessment form, plus an optional **AI instant snapshot** powered by Claude via a serverless function.

## Run locally

The page itself is static — just open it:

```bash
open index.html        # macOS
# or serve it
python3 -m http.server 8000   # then visit http://localhost:8000
```

The AI snapshot needs the serverless function, which only runs on Vercel (or `vercel dev`). Opened as a plain file, the page works fine — the snapshot box just hides itself.

## AI instant snapshot

When someone finishes the assessment, the page POSTs their answers to `/api/assess` ([api/assess.js](api/assess.js)), which calls Claude and returns a personalized snapshot: where they stand, target roles, and a recruiter-ready sponsorship pitch.

**The Claude API key is never in the page.** It lives only in a Vercel environment variable, read server-side by the function. This is the whole reason the call goes through a backend instead of the browser.

### Deploy on Vercel

1. Push this repo to GitHub (already wired to `kingidowu/northbound01`).
2. Import the repo at https://vercel.com/new (Vercel auto-detects the static site + the `api/` function; no build settings needed).
3. In **Project → Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com/settings/keys
4. Deploy. The snapshot is now live.

To run it locally with the function: `npm i -g vercel`, then `vercel dev` (it'll prompt for the env var).

> **Model & cost:** the function uses `claude-opus-4-8`. To cut cost/latency at volume, change `model` in `api/assess.js` to `claude-sonnet-4-6`. The key never leaves the server either way.
> Disable the feature entirely by setting `AI_ENDPOINT = ""` near the top of the script in `index.html`.

## Lead capture

Submissions are sent to **both** a database and your email when configured (in parallel — the lead is saved if either succeeds). With nothing configured, the form still works and logs the payload to the browser console so you can test the flow. All config lives at the top of the `<script>` in `index.html`.

### Email — Web3Forms (fastest, ~5 min)

1. Go to https://web3forms.com, enter the email you want leads sent to, and copy the **Access Key**.
2. Paste it in `index.html`:
   ```js
   const WEB3FORMS_KEY = "your-access-key";
   ```
That's it — you'll get an email per submission. No account or keys-in-a-database needed.

### Database — Supabase (queryable, exportable)

1. Create a free project at https://supabase.com.
2. In the SQL editor, create the table:
   ```sql
   create table assessments (
     id uuid primary key default gen_random_uuid(),
     created_at timestamptz default now(),
     data jsonb
   );
   -- simplest: store everything as columns, or use a jsonb catch-all.
   ```
   (Or add a column per field — the form posts flat keys like `full_name`, `email`, `field`, etc.)
3. Enable an **insert** policy for the `anon` role so the public form can write (and only write).
4. Copy your project URL and anon public key into `index.html`:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   const SUPABASE_TABLE = "assessments";
   ```

> The Supabase **anon** key is safe to ship in client-side code — that's its purpose. Protect your data with Row Level Security policies, not by hiding the key.

## Customize

- **Brand name** — change `const BRAND` in `index.html` (also updates nav, hero, footer, title).
- **Colors** — edit the CSS `:root` variables.
