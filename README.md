# Bucket List

A installable bucket list app. Data is stored in a Postgres database on Vercel and unlocked with a PIN.

## Setup on Vercel (free tier)

1. Push this folder to GitHub, with `index.html`, `api/`, and `package.json` at the root.
2. On vercel.com, click Add New → Project, import the repo, and deploy. Framework Preset: Other.
3. In the project, open Storage (or Marketplace) and add **Neon Postgres** on the free plan. Connect it to the project. This sets `DATABASE_URL` automatically.
4. Open Settings → Environment Variables and add:
   - `APP_PIN` = your PIN
5. Redeploy (Deployments → Redeploy). The database tables are created on the first request.

## How it works
- `index.html`, `app.js`, `styles.css`: the app. Everything is saved through `/api/state`.
- `api/state.js`: a serverless function. It checks the PIN on every request, stores the list as one JSON document, and limits failed PIN attempts to 5 per IP per 15 minutes.
- The PIN is kept in the browser's session storage, so it's forgotten when the tab closes.

## Notes
- Use a PIN you won't guess easily. Four digits is quick to brute-force; the rate limit slows this down, but a longer PIN is safer.
- Changes save automatically a moment after each edit. The app shows "Saved" when the server confirms.
- Writes are last-one-wins. Use one device at a time, or reload before editing on a second device.
- Vercel limits request size to about 4.5 MB, so keep the number of photos moderate.
