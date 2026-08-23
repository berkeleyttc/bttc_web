# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the main website for the Berkeley Table Tennis Club (BTTC). It is a static HTML/CSS/JS site with Vue.js 3 apps (loaded via CDN, no build step) hosted on Netlify, with a Netlify Functions proxy that hides backend credentials.

## League Manager port — read this before writing code

A port of the club's WinForms round-robin manager adds a fifth Vue app here, at `/leaguemanager/`.
The whole plan lives outside this repo, at `port-planner/.scratch/league-manager-port/map.md` in the
`bttc_rr` repo — start there for any question about what the port does or why.

**Work on `feature/league-manager`.** It is pushed and tracking. Do not commit port work to `main`.

**Never `git add -A` in this repo.** The working copy's `env.js` differs from `origin/main`: it
hardcodes the backend host, a **live `API_KEY` and an `ADMIN_PASSWORD`**, none of which are on
`origin/main`, where `API_URL` is the Netlify proxy. This repo is **public** and the branch has an
upstream, so one careless stage-and-push publishes both credentials. Stage by path, every time.

**`main` requires a pull request** — classic branch protection. Two things follow:

- The port lands on `main` through a PR, not a push.
- **Do not touch that protection rule.** The `BTTC Publisher` GitHub App sits on its *Allow specified
  actors to bypass required pull requests* list, and that bypass is the only reason the API can
  publish results and brackets into this repo. Remove it — during a settings tidy-up, or by
  rebuilding the rule — and every publish fails with *"Changes must be made through a pull request"*,
  a message that never mentions the port and that nothing detects.

**At cutover, this repo is pushed first**, then `bttc_api` — three apps here (`registration/`,
`signup/`, `roster/`) switch to reading status codes instead of `success: false`, and the public
signup form is broken in the minutes between the two pushes.

**The `staging` branch is a different thing** and is not the port branch: it is a one-line flip of
`netlify/functions/api.js`'s `USE_DEV_API` so the browser reaches `bttc-api-dev`. Rebase it on `main`
before each rehearsal. Netlify branch deploys must be enabled in the dashboard — `netlify.toml` has
no `[context.branch-deploy]`.

**`/leaguemanager/` uses native ES modules**, the first in this repo. Modules are not a build step, so
the no-bundler constraint below still holds — but **Local Development Option 1 will not work for this
app**, because `file://` cannot load modules. Use `netlify dev`.


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
- **`leaguemanager/`** — the Friday-night round-robin operator console. **The odd one out, deliberately:** native ES modules (`app.js` + `store.js` + `api.js` + seven `tabs/`), a `store.js` of named reactive exports rather than props-and-emits, its own error vocabulary in `api.js`, and its own design tokens in `ds.css` scoped to `#lm-app`. It loads **neither `env.js` nor `js/bttc-utils.js`** — see below.

### Shared utilities
**`js/bttc-utils.js`** — Used across Vue apps: `getErrorMessage()`, `getFetchOptions()`, `handleApiResponse()`, `validatePhone()`, `formatPhoneNumber()`, `validateToken()`, `getSupportContact()`.

**`leaguemanager/` uses none of them, and that is a decision rather than an oversight.** `getErrorMessage()` appends *"contact BTTC support at 510-926-6913 (TEXT ONLY)"* to every branch, which is right for a player stuck on a registration form and wrong for the operator, who **is** the person you would be calling. `leaguemanager/api.js` carries an operator vocabulary instead — thirty codes mirroring `bttc_api/helpers/errors.py`, each naming what to do. The cost is named rather than hidden: **two error-mapping functions on one origin.** There is also a mechanical reason: a module cannot `import` a bare top-level `const` from a classic script, so the dependency would be invisible to `node --test` and to any reader.

`env.js` gains nothing for the same kind of reason: every setting that app needs comes from `GET /rr/session`, and declaring them a second time in a hand-edited file checked into git is drift with nothing to catch it.

### Two login systems on one origin
`admin/` and `leaguemanager/` authenticate differently and **neither is wrong**. `netlify/functions/admin-login.js` mints a random hex token that nothing anywhere verifies, with hardcoded fallbacks, and `admin/shell.js` only ever checks its expiry client-side. `POST /rr/login` is HMAC-signed with a Fly secret and verified on every request. `admin/` is not migrated, by decision. Their `sessionStorage` keys are namespaced apart (`bttc_admin_*` against `bttc_lm_*`) so one app's stale session can never appear to authenticate the other — **do not share them.**

### Static content
- `draw-brackets/` — Tournament bracket pages (generated externally and pasted in)
- `results/` — Historical results (900+ subdirectories, not programmatically generated)
- Navigation is duplicated across HTML files — there is no templating system

## Key Constraints

- **Do not introduce a build system, bundler, or server-side templating** — the site is intentionally flat and static
- **Do not refactor navigation into shared includes** — duplication is intentional
- **Do not modify `old/` or `results/`** — legacy/archival content
- For new tournaments, copy templates from `draw-brackets-templates/`
