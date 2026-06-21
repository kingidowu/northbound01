# Northbound

Landing page for **Northbound** — remote IT career development with a visa-sponsorship focus, for the US & Canada.

A single static `index.html` (no build step) with a 6-step career assessment form.

## Run locally

Just open the file:

```bash
open index.html        # macOS
# or serve it
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Assessment submissions

The form works out of the box (logs the payload to the console). To persist submissions, fill in the Supabase config near the top of the `<script>` in `index.html`:

```js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-public-key";
const SUPABASE_TABLE = "assessments";
```

## Customize

- **Brand name** — change `const BRAND` in `index.html` (also updates nav, hero, footer, title).
- **Colors** — edit the CSS `:root` variables.
