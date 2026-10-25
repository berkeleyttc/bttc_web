# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the main website for the Berkeley Table Tennis Club (BTTC). It is a static HTML/CSS/JS site with Vue.js 3 apps (loaded via CDN, no build step) hosted on Netlify, with a Netlify Functions proxy that hides backend credentials.

## Local Development

There is no build system. Files are edited and deployed as-is.

**Option 1 — Direct backend connection (simpler):**
1. Set `API_URL: 'http://0.0.0.0:8080'` in `env.js`
2. Start the backend API on port 8080
3. Open HTML files directly in the browser

**Option 2 — With Netlify function proxy (production-like):**
1. Create `.env` with `BTTC_API_URL` and `BTTC_API_KEY`
2. Set `API_URL: '/.netlify/functions/api'` in `env.js`
3. Run `netlify dev` — serves the site at `http://localhost:8888`

**Test the proxy:**
```bash
curl http://localhost:8888/.netlify/functions/api/rr/roster
```

## Architecture

### Two config files
- **`env.js`** — Frontend config, checked into git. Controls `API_URL`, registration schedule, player cap, cache TTL, etc.
- **`.env`** — Backend secrets (not in git). Used only by the Netlify function: `BTTC_API_URL`, `BTTC_API_KEY`.

### API proxy pattern
Frontend → `/.netlify/functions/api` → Netlify function adds auth headers → hidden backend API. This keeps the backend URL and API key out of frontend code.

### Vue.js apps (loaded via CDN)
Each app is a self-contained directory with its own `index.html`, JS, and CSS:
- **`registration/`** — Weekly round-robin registration
- **`roster/`** — Player roster display
- **`signup/`** — New player profile creation
- **`admin/`** — Admin dashboard with approval workflow and audit log (multi-component: `shell.js` handles auth/nav, `admin.js` handles approvals, `audit.js` handles audit log)

### Shared utilities
**`js/bttc-utils.js`** — Used across Vue apps: `getErrorMessage()`, `getFetchOptions()`, `handleApiResponse()`, `validatePhone()`, `formatPhoneNumber()`, `validateToken()`, `getSupportContact()`.

### Static content
- `draw-brackets/` — Tournament bracket pages (generated externally and pasted in)
- `results/` — Historical results (900+ subdirectories, not programmatically generated)
- Navigation is duplicated across HTML files — there is no templating system

## Key Constraints

- **Do not introduce a build system, bundler, or server-side templating** — the site is intentionally flat and static
- **Do not refactor navigation into shared includes** — duplication is intentional
- **Do not modify `old/` or `results/`** — legacy/archival content
- For new tournaments, copy templates from `draw-brackets-templates/`
