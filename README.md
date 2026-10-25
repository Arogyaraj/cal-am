# Bucket List PWA

A static, installable bucket list app. No build step.

## Deploy on Vercel (free tier)
1. Push the contents of this folder to a GitHub repo, with `index.html` at the root.
2. On vercel.com: Add New → Project → import the repo.
3. Framework Preset: Other. Leave Build and Output settings empty. Click Deploy.

## Regenerate icons
    python3 scripts/make-icons.py

## Notes
- Data lives in each browser's localStorage. Use Menu → Export backup to move it between devices.
- After changing files, bump `VERSION` in `sw.js` so installed copies refresh.
