# Copilot Instructions for BTTC Web Codebase

## Overview
This is the main website for the Berkeley Table Tennis Club (BTTC). The site is a static HTML/CSS/JS project, with some legacy PHP and historical/archival content. It is organized for easy manual editing and static hosting.

## Key Structure
- **Top-level HTML files**: Each page (e.g., `index.html`, `about.html`, `results.html`) is a standalone HTML file.
- **`css/`**: All main stylesheets. `style.css` is the global style, `bracket-styles.css` and `_results-rr.css` are for specific features.
- **`draw-brackets/` and `draw-brackets-templates/`**: Templates and pages for round robin tournament brackets and group assignments. These are updated for each event.
- **`results/`**: Contains historical results, often as exported HTML from Excel or similar tools. Not programmatically generated.
- **`old/`**: Legacy and archival files, not actively maintained.
- **`assets/`, `images/`, `photogallery/`, `videos/`**: Static assets for the site.

## Patterns & Conventions
- **No build step**: All files are edited and deployed as-is. There is no build, test, or package process.
- **Navigation**: Most pages use similar navigation markup, but there is no templating system—navigation is duplicated across files.
- **CSS**: Uses a custom grid system in `style.css` (inspired by 960.gs). Responsive tweaks are present for mobile.
- **Brackets/Results**: Tournament bracket and results pages are often generated externally (e.g., Excel) and pasted in as HTML.
- **No JavaScript frameworks**: Only vanilla JS, if any. Most interactivity is minimal.
- **PHP**: Only used for a few utility scripts (e.g., `lwHostsCheck.php`). Not required for main site operation.

## How to Add or Update Content
- Edit the relevant HTML file directly for content changes.
- For new tournaments, copy and adapt templates in `draw-brackets-templates/`.
- Add new results as HTML files in `results/`.
- Update navigation in each HTML file as needed (no shared include).

## External Dependencies
- Google Fonts (see `<link>` tags in HTML)
- Google Analytics (inline JS in some templates)

## Examples
- See `draw-brackets-templates/index.html` for navigation and layout patterns.
- See `css/style.css` for grid and responsive design conventions.

## What Not to Do
- Do not introduce a build system or JS framework.
- Do not refactor navigation into includes or templates (site is intentionally flat/static).
- Do not remove or rewrite legacy/archival files in `old/` or `results/`.

---
For questions, see the README or contact the site maintainer.
