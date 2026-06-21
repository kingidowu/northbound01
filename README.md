# Northbound

Landing page for **Northbound** — remote IT career development with a visa-sponsorship focus, for the US & Canada.

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
