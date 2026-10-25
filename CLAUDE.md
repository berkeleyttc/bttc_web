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


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
