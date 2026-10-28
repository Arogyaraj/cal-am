# Bucket List v3

An installable bucket list app. Data lives in a Neon Postgres database on Vercel, unlocked with a PIN.

## What's new in v2
- Black-and-white block design: square cards with hard shadows, patterned covers, monochrome emoji stickers, and a light/dark mode.
- Sticker emoji per dream, with quick picks.
- Star ratings and a "Mark as done" option in the editor.
- Yearly goal shown in the hero, set from your profile.
- Timeline view grouped by target month, plus grid and list views.
- Tag filters, priority filter, and an Overdue filter.
- Select mode with bulk actions: mark done, pin, delete.
- Richer stats: rating average, rating distribution, priority breakdown, and top category.

## Setup on Vercel (free tier)

1. Push this folder to GitHub with `index.html`, `app.js`, `styles.css`, `sw.js`, `api/`, `lib/`, and `package.json` at the root.
2. On vercel.com, Add New → Project, import the repo, and deploy. Framework Preset: Other.
3. In the project, open Storage (or Marketplace) and add **Neon Postgres** on the free plan, then connect it to the project. This sets `DATABASE_URL`.
4. Settings → Environment Variables, add `APP_PIN` with your PIN.
5. Redeploy. The schema is created or upgraded on the first request, so existing data keeps working.

## Layout
- `api/data.js`: load everything, update the profile, erase all data
- `api/dreams.js`: create, duplicate, update, and delete dreams
- `api/stats.js`: aggregate statistics computed in SQL
- `api/import.js`: replace the list from a backup
- `lib/db.js`: schema, validation, and queries
- `lib/api.js`: PIN check and rate limiting, applied to every endpoint

## Notes
- Each dream is a row, so saving one change only sends that change.
- Every create, edit, completion, reopen, memory, and delete is recorded in the activity log.
- The PIN is kept in session storage and cleared when the tab closes.
- Four-digit PINs are guessable. The rate limit (5 wrong tries per address per 15 minutes) slows that down, but a longer PIN is safer.

## What changed in v3
- Fixed the journal crash when writing a memory from an entry.
- Journal and stats now share one editorial layout, with summary figures and filters.
- Stats: eight headline metrics, a yearly goal bar, a twelve-month chart, and category, priority, and rating breakdowns.
- Keyboard shortcuts no longer stop working after a dialog closes.
- Every interactive control was clicked in an automated run across phone, tablet, and desktop sizes with no page errors.
