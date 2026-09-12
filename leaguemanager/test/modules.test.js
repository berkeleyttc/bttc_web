/**
 * Every shipped module parses as an ES module.
 *
 * **This exists because of a measured failure, not as hygiene.** The seven tab modules
 * carry their markup in a template literal, and a stray backtick inside one -- in an
 * HTML comment quoting a filename, `<!-- ... \`print.css:520\` ... -->` -- **terminates
 * the string**. What follows is parsed as code and the module throws
 * `SyntaxError: Unexpected identifier` at load. The app then mounts nothing at all: a
 * blank `#lm-app` and one line in a console nobody has open.
 *
 * The trap is that **`node --check somefile.js` does not catch it.** With no
 * `package.json`, Node treats a bare `.js` as CommonJS and its module-syntax detection
 * is lenient enough to accept the file, so the check passes on all seven while four of
 * them are unloadable in a browser. Four files shipped that way for the length of one
 * session before a headless run found it. Copying to `.mjs` first is what makes the
 * parse the same one the browser performs.
 *
 * `test/README.md` draws the line at "the seven tab modules import `window.Vue`, so they
 * are not testable this way". That is true of their BEHAVIOUR and not of their SYNTAX --
 * this checks only that the file is a well-formed module, which needs no browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every `.js` this app ships, excluding the tests themselves. */
function shippedModules() {
  const out = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(join(ROOT, entry.name));
    if (entry.isDirectory() && entry.name === 'tabs') {
      for (const f of readdirSync(join(ROOT, 'tabs'))) {
        if (f.endsWith('.js')) out.push(join(ROOT, 'tabs', f));
      }
    }
  }
  return out.sort();
}

describe('every shipped module is a well-formed ES module', () => {
  const files = shippedModules();

  it('finds the modules at all, so the check is not vacuous', () => {
    assert.ok(files.length >= 8, 'expected the app plus its seven tabs, found ' + files.length);
    for (const name of ['api.js', 'app.js', 'store.js', 'persist.js', 'client.js',
                        'search.js', 'draw.js', 'play-order.js', 'print.js',
                        'member-form.js', 'score-entry.js']) {
      assert.ok(files.some((f) => basename(f) === name), name + ' is missing');
    }
    for (const tab of ['roster', 'draw', 'printing', 'scores', 'finalize', 'results', 'settings']) {
      assert.ok(files.some((f) => f.endsWith(join('tabs', tab + '.js'))), 'tabs/' + tab + '.js is missing');
    }
  });

  const dir = mkdtempSync(join(tmpdir(), 'lm-esm-'));

  for (const file of files) {
    it(basename(file) + ' parses as ESM, not merely as a script', () => {
      // The .mjs extension is the whole point: it forces the same parse the browser
      // does for <script type="module">, rather than Node's lenient .js detection.
      const copy = join(dir, basename(file, '.js') + '.mjs');
      copyFileSync(file, copy);
      try {
        execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
      } catch (err) {
        assert.fail(basename(file) + ' does not parse:\n' + String(err.stderr || err.message));
      }
    });
  }

  it('cleans up after itself', () => {
    rmSync(dir, { recursive: true, force: true });
    assert.ok(true);
  });
});

describe('the tab templates carry no backtick', () => {
  // The specific failure above, asserted directly rather than only through the parse --
  // because a future backtick that happens to land in a balanced pair would parse fine
  // and silently swallow the markup between them.
  for (const file of shippedModules()) {
    it(basename(file) + ': no backtick inside its template literal', async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(file, 'utf8');
      const start = src.indexOf('template: `');
      if (start < 0) return;                       // not a component module
      const end = src.lastIndexOf('`,\n};');
      assert.ok(end > start, basename(file) + ': could not find the template’s end');
      const body = src.slice(start + 'template: `'.length, end);
      assert.equal(body.includes('`'), false,
        'a backtick in the template terminates it — quote filenames with \' instead');
    });
  }
});
