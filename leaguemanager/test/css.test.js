/**
 * Ticket 23 Q10's three scoping rules, as ticket 24 Q19 asked: greppable, and therefore
 * cheap enough to have.
 *
 * **The failure they prevent is measured, not hypothetical.** Tickets 09 and 20 both
 * define `--cell-w`, `--cell-half`, `--label-band`, `--box-band`, `--row-gap` and `--rule`
 * — six names, all six shared, all six at *different units*: `0.95833in` in the printed
 * sheet against `84px` in the screen entry grid. They also both declare `* { box-sizing }`,
 * `html`, `body`, `#controls`, `.cell` and `.banner`, where `.banner` is an error strip in
 * one file and an absolutely-positioned printed group header in the other. Load both into
 * one document without these rules and one of the two grids is silently rescaled by
 * whichever stylesheet happens to load last. Nothing else in the repo would notice.
 *
 * Run: `node --test 'leaguemanager/test/*.test.js'`  — quote the glob. Node 24 resolves a
 * bare directory argument as a module path and fails with `Cannot find module`.
 *
 * The parser here is deliberately crude: strip comments and strings, then walk brace
 * depth. It has to understand `@media` and `@supports` nesting and nothing else, and a
 * real CSS parser would be a dependency, which `bttc_web`'s CLAUDE.md forbids.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const APP_ROOT_ID = '#lm-app';

/**
 * The ONE exception to rule 3, and it is narrow by construction.
 *
 * The site chrome is a **sibling** of `#lm-app`, not a descendant -- `index.html` renders
 * `#header` and `#footer` inline because `bttc_web/CLAUDE.md` forbids refactoring
 * navigation into shared includes. So no selector under the app root can reach it, and
 * `print.css:519`'s *"Everything that is not the print region stays off the paper"* was
 * aspirational: its rule is `#lm-app .lm-screen-only`, which cannot see outside the root.
 *
 * The failure that opened this hole is MEASURED, not hypothetical. `print.css:493` takes
 * `#lm-app` out of flow so it escapes `body`'s 8px UA margin without the bare `body` rule
 * ticket 23 Q10 forbids -- which leaves the chrome in flow at the top of page 1, printing
 * the club's logo and nav bar across the first score sheet. Ten sheets and the floor map
 * were correct; sheet one was not.
 *
 * **Permitted only inside `@media print`.** On screen these two ids stay unreachable, so
 * the guarantee that matters -- no League Manager token or layout rule escapes `#lm-app`
 * and reaches the other four apps -- is intact. What is given up is one `display: none`
 * on the site's own chrome, on a stylesheet only `/leaguemanager/` loads.
 */
const PRINT_CHROME = new Set(['#header', '#footer']);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const LM = here('../');

/** Every stylesheet under `leaguemanager/`, plus every `<style>` block in its HTML. */
function styleSources(dir = LM, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      styleSources(path, out);
    } else if (name.endsWith('.css')) {
      out.push({ path, css: readFileSync(path, 'utf8') });
    } else if (name.endsWith('.html')) {
      const html = readFileSync(path, 'utf8');
      for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
        out.push({ path: `${path} <style>`, css: m[1] });
      }
    }
  }
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * `[{ selector, body, nesting }]` for every rule, where `nesting` is the chain of at-rule
 * preludes it sits inside. At-rules are not themselves rules and are not returned.
 */
function rules(css) {
  const src = stripComments(css);
  const out = [];
  const stack = [];
  let head = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      const prelude = head.trim();
      head = '';
      if (prelude.startsWith('@')) {
        // `@page` and `@font-face` hold declarations, not nested rules: skip their
        // bodies outright rather than pushing them as a nesting context.
        if (/^@(page|font-face|counter-style|property)\b/.test(prelude)) {
          i = matchBrace(src, i);
        } else {
          stack.push({ at: prelude, start: i + 1 });
        }
      } else {
        const close = matchBrace(src, i);
        out.push({
          selector: prelude,
          body: src.slice(i + 1, close),
          nesting: stack.map((s) => s.at),
        });
        i = close;
      }
    } else if (ch === '}') {
      stack.pop();
      head = '';
    } else {
      head += ch;
    }
  }
  return out;
}

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('unbalanced braces');
}

const sources = styleSources();

describe('ticket 23 Q10 rule 3 — every rule is written under the app root', () => {
  it('finds stylesheets to check at all', () => {
    assert.ok(sources.length > 0, 'no CSS found under leaguemanager/ — the check is vacuous');
  });

  for (const { path, css } of sources) {
    it(`${path.replace(LM, '')}: no selector escapes the app root`, () => {
      const offenders = [];
      for (const { selector, nesting } of rules(css)) {
        // `@keyframes` stops carry percentages and `from`/`to`, not selectors.
        if (nesting.some((a) => a.startsWith('@keyframes'))) continue;
        for (const one of selector.split(',').map((s) => s.trim()).filter(Boolean)) {
          // The app root itself is the one permitted top-level selector: ticket 23 Q9
          // puts the `_ds` tokens on it precisely so they cannot reach the other four
          // apps. `#lm-app.something` and `#lm-app ...` are the same rule, scoped.
          if (one === APP_ROOT_ID || one.startsWith(`${APP_ROOT_ID} `)
              || one.startsWith(`${APP_ROOT_ID}.`) || one.startsWith(`${APP_ROOT_ID}:`)
              || one.startsWith(`${APP_ROOT_ID}[`) || one.startsWith(`${APP_ROOT_ID}>`)) {
            continue;
          }
          // The site chrome, and only when printing. See PRINT_CHROME above.
          if (PRINT_CHROME.has(one)
              && nesting.some((a) => a.replace(/\s+/g, ' ').trim() === '@media print')) {
            continue;
          }
          offenders.push(one);
        }
      }
      assert.deepEqual(offenders, [], `these rules escape ${APP_ROOT_ID}`);
    });
  }
});

describe('ticket 23 Q10 rule 1 — the _ds tokens are on the app root, never :root', () => {
  for (const { path, css } of sources) {
    it(`${path.replace(LM, '')}: defines no custom property on :root or html`, () => {
      for (const { selector, body } of rules(css)) {
        const declaresToken = /(^|[;{\s])--[\w-]+\s*:/.test(body);
        const bare = selector.split(',').map((s) => s.trim())
          .some((s) => s === ':root' || s === 'html' || s === 'body');
        assert.ok(!(declaresToken && bare),
          `${selector} declares a custom property outside ${APP_ROOT_ID}`);
      }
    });
  }
});

describe('ticket 23 Q10 rule 2 — the two grid token sets are prefixed apart', () => {
  /**
   * The six names tickets 09 and 20 collide on. Neither may appear unprefixed anywhere
   * under `leaguemanager/`; each must carry `--lm-sheet-` (the printed sheet) or
   * `--lm-grid-` (the screen entry grid).
   */
  const COLLIDING = ['cell-w', 'cell-half', 'label-band', 'box-band', 'row-gap', 'rule'];

  it('no colliding name is defined unprefixed', () => {
    const bad = [];
    for (const { path, css } of sources) {
      for (const name of COLLIDING) {
        const re = new RegExp(`--${name}\\s*:`, 'g');
        if (re.test(stripComments(css))) bad.push(`${path.replace(LM, '')}: --${name}`);
      }
    }
    assert.deepEqual(bad, [],
      'tickets 09 and 20 define these six at different units (0.95833in against 84px); '
      + 'unprefixed, whichever stylesheet loads last silently rescales the other grid');
  });

  it('no colliding name is defined both ways in one file', () => {
    const bad = [];
    for (const { path, css } of sources) {
      for (const name of COLLIDING) {
        const sheet = new RegExp(`--lm-sheet-${name}\\s*:`).test(stripComments(css));
        const grid = new RegExp(`--lm-grid-${name}\\s*:`).test(stripComments(css));
        if (sheet && grid) bad.push(`${path.replace(LM, '')}: --${name} both ways`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it('no custom property is defined at two different values', () => {
    const seen = new Map();
    for (const { path, css } of sources) {
      for (const m of stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
        const name = m[1];
        const value = m[2].trim();
        const prior = seen.get(name);
        if (prior && prior.value !== value) {
          assert.fail(`${name} is ${prior.value} in ${prior.path} and ${value} in `
            + `${path.replace(LM, '')} — this is exactly the 0.95833in-against-84px `
            + 'collision rule 2 exists to prevent');
        }
        seen.set(name, { value, path: path.replace(LM, '') });
      }
    }
  });
});

describe('the two required print properties — ticket 18 via ticket 23 Q11', () => {
  const css = sources.filter((s) => s.path.endsWith('print.css'))
    .map((s) => stripComments(s.css)).join('\n');

  it('print.css exists', () => {
    assert.ok(css.length > 0, 'no print.css under leaguemanager/');
  });

  it('@page is US Letter with a zero margin', () => {
    const page = css.match(/@page\s*\{([^}]*)\}/);
    assert.ok(page, 'no @page rule');
    assert.match(page[1], /size\s*:\s*letter/,
      'US Letter is hardcoded — A4 was built, verified at 595x842pt, and dropped');
    assert.match(page[1], /margin\s*:\s*0\b/,
      "ticket 09's coordinates are measured from the PAPER corner, because the C# never "
      + 'sets OriginAtMargins; a non-zero page margin shifts every one of them');
  });

  it('print-color-adjust: exact reaches every fill that carries meaning', () => {
    const blocks = rules(css)
      .filter((r) => /print-color-adjust\s*:\s*exact/.test(r.body))
      .map((r) => r.selector);
    assert.ok(blocks.length > 0, 'Chrome drops background colours in print by default');
    const covered = blocks.join(' ');
    for (const needed of ['.lm-t', '.lm-desk']) {
      assert.ok(covered.includes(needed),
        `${needed} carries a fill that tells a player which tables are theirs`);
    }
    assert.ok(!/^\s*(\*|html|body)\s*[,{]/m.test(covered),
      'ticket 09 scopes this tightly rather than document-wide');
  });

  /**
   * The site's own print reset, and why this is a test rather than a comment.
   *
   * `index.html` loads `../css/style.css`, whose `@media print` block opens with the
   * HTML5 Boilerplate line `* { background: transparent !important; color: #444
   * !important }`. Nothing under `#lm-app` can outrank it -- specificity does not beat
   * `!important`, only `!important` does -- so it erased every mini-map fill and printed
   * the whole surface in #444 grey instead of black ink.
   *
   * **Measured by bisection, not reasoned about.** The same markup emits 2 filled
   * rectangles under `print.css` alone and 0 under both stylesheets; with the
   * restorations below it emits 3, in `0 0 0`, `.502 .502 .502` and `1 1 1`.
   *
   * `print-color-adjust: exact` is not a defence and the assertion above must not be
   * read as one: it decides whether Chrome HONOURS a background, not what the background
   * is. Both tests are needed and they guard different failures.
   *
   * This is the one place the League Manager's CSS is allowed `!important`, and it is
   * allowed because it is a counter-reset rather than a preference.
   */
  it('the site\'s !important print reset is undone for the printed surface', () => {
    const site = readFileSync(join(LM, '..', 'css', 'style.css'), 'utf8');
    const sitePrint = site.match(/@media\s+print\s*\{([\s\S]*)/);
    assert.ok(sitePrint, 'css/style.css has no @media print block');

    const resets = /\*\s*\{[^}]*!important/.test(sitePrint[1]);
    if (!resets) return;   // the site dropped the reset; nothing to undo

    const print = css.match(/@media\s+print\s*\{([\s\S]*)\}/);
    assert.ok(print, 'print.css has no @media print block');
    const body = print[1];

    assert.match(body, /#lm-app \.lm-print \*[^{]*\{[^}]*color:[^;]*!important/,
      'the site reset paints every glyph #444; the print region must claim its ink back');

    for (const [sel, what] of [
      ['\\.lm-t\\.lm-mine', 'the black fill marking a table as this group\'s'],
      ['\\.lm-t\\.lm-shared', 'the grey fill marking a shared table'],
      ['\\.lm-minimap \\.lm-desk', 'the desk block a player orients from'],
    ]) {
      const re = new RegExp(sel + '[^{]*\\{[^}]*background:[^;]*!important');
      assert.match(body, re, `${what} is erased by the site reset unless restored`);
    }
  });

  it('every preview rule is reset at its own specificity inside @media print', () => {
    // Measured, not hypothetical. `#lm-app.lm-print-preview .lm-print` is an id plus two
    // classes; a plain `#lm-app .lm-print` reset inside @media print LOSES to it, so the
    // preview's 1.5rem of padding survived onto the paper and pushed every artifact a
    // fraction past 11in — 6 printed pages for 4 artifacts, one blank after each.
    // Chrome reports MediaBox 612x792 either way, so the page count is the only signal.
    const print = css.match(/@media\s+print\s*\{([\s\S]*)\}/);
    assert.ok(print, 'no @media print block');
    const inPrint = new Set(rules(print[1]).flatMap(
      (r) => r.selector.split(',').map((x) => x.trim())));
    const previewOnly = rules(css.replace(print[0], ''))
      .flatMap((r) => r.selector.split(',').map((x) => x.trim()))
      .filter((sel) => sel.includes('.lm-print-preview'));
    assert.ok(previewOnly.length > 0, 'no preview rules found — the check is vacuous');
    for (const sel of previewOnly) {
      assert.ok(inPrint.has(sel),
        `${sel} is never reset inside @media print, and it out-specifies any rule that `
        + 'does not name .lm-print-preview');
    }
  });

  it('the app root escapes body\'s UA margin without a bare body rule', () => {
    const print = css.match(/@media\s+print\s*\{([\s\S]*)\}/);
    assert.ok(print, 'no @media print block');
    const root = rules(print[1]).find((r) => r.selector === APP_ROOT_ID);
    assert.ok(root, `${APP_ROOT_ID} is not repositioned for print`);
    assert.match(root.body, /position\s*:\s*absolute/);
    assert.match(root.body, /left\s*:\s*0/);
    assert.match(root.body, /top\s*:\s*0/);
  });
});
