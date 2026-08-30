/**
 * `publish.js` -- the half of publishing that is a decision rather than a request.
 *
 * These four rules were unreachable by `node --test` until `Publish brackets` moved to the
 * Draw List tab. They lived inside `tabs/finalize.js`, which imports `store.js`, which
 * reaches `window.Vue` -- the line `test/README.md` draws. Two tabs now depend on them
 * agreeing, so they were extracted to a pure module, and extracting them is what made them
 * testable. The tests exist for that reason and not for coverage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api.js';
import {
  SCOPE_LABEL, BUTTON_LABEL, SCOPE_NAME,
  linksFor, tagClass, outcomeOf, errorOf, isTakenDown,
} from '../publish.js';

describe('outcomeOf -- NO_CHANGES at 200 is a success, not a failure', () => {
  it('tags a NO_CHANGES body `No changes`, never `Failed`', () => {
    const out = outcomeOf({ code: 'NO_CHANGES', published_at: '2026-08-29T19:42:00Z' }, false);
    assert.equal(out.tag, 'No changes');
  });

  it('still says `No changes` under a dry run -- nothing differed either way', () => {
    assert.equal(outcomeOf({ code: 'NO_CHANGES' }, true).tag, 'No changes');
  });

  it('tags a real publish `Committed`', () => {
    const out = outcomeOf({ code: null, commit_sha: 'a1b2c3d4e5f6' }, false);
    assert.equal(out.tag, 'Committed');
    assert.equal(out.dryRun, false);
  });

  it('tags a withheld ref update `Dry run`', () => {
    const out = outcomeOf({ code: null, commit_sha: 'a1b2c3d4e5f6' }, true);
    assert.equal(out.tag, 'Dry run');
    assert.equal(out.dryRun, true);
  });

  it('carries the body through untouched, since the row reads sha and times off it', () => {
    const body = { code: null, commit_sha: 'abc', files_written: ['x'] };
    assert.equal(outcomeOf(body, false).record, body);
  });
});

describe('linksFor -- emitted in the SERVED form, so the operator does not eat a 301', () => {
  it('lowercases and strips .html from the session page', () => {
    const links = linksFor('results', {
      files_written: ['results/RR_Results_2026May29.html', 'results/index.json'],
    });
    const page = links.find((l) => l.label === 'session page');
    assert.equal(page.href, '/results/rr_results_2026may29');
  });

  it('emits three links for results, because one commit has three visible outcomes', () => {
    const links = linksFor('results', { files_written: ['results/RR_Results_2026May29.html'] });
    assert.deepEqual(links.map((l) => l.label), ['session page', 'index', 'brackets']);
  });

  it('omits the session page when the commit wrote none, keeping index and brackets', () => {
    const links = linksFor('results', { files_written: ['draw-brackets/index.html'] });
    assert.deepEqual(links.map((l) => l.label), ['index', 'brackets']);
  });

  it('gives brackets and sleep the one link they share', () => {
    for (const scope of ['brackets', 'sleep']) {
      assert.deepEqual(linksFor(scope, {}), [{ href: '/draw-brackets/', label: 'brackets' }]);
    }
  });

  it('survives a record with no files_written at all', () => {
    assert.deepEqual(linksFor('results', {}).map((l) => l.label), ['index', 'brackets']);
    assert.deepEqual(linksFor('results', null).map((l) => l.label), ['index', 'brackets']);
  });

  it('returns nothing for a scope it does not know', () => {
    assert.deepEqual(linksFor('nonsense', {}), []);
  });
});

describe('errorOf -- a Failed row says what the screen and the runbook both say', () => {
  it('carries detail, remedy and code off an ApiError', () => {
    const err = new ApiError({ status: 409, code: 'DRAW_MISSING', detail: 'No draw yet.' });
    const out = errorOf(err);
    assert.equal(out.text, 'No draw yet.');
    assert.equal(out.code, 'DRAW_MISSING');
    assert.ok(out.remedy, 'DRAW_MISSING has a remedy in the registry');
  });

  it('surfaces GitHub own words on REF_CONFLICT -- the only place that failure speaks', () => {
    const err = new ApiError({
      status: 409, code: 'REF_CONFLICT', detail: 'refused',
      extras: { github_message: 'required status check is expected' },
    });
    assert.equal(errorOf(err).github, 'required status check is expected');
  });

  it('degrades a non-ApiError throw to its string, with nothing invented around it', () => {
    const out = errorOf(new TypeError('fetch failed'));
    assert.match(out.text, /fetch failed/);
    assert.equal(out.code, null);
    assert.equal(out.remedy, null);
    assert.equal(out.github, null);
  });
});

describe('isTakenDown -- both sleep and results delete /draw-brackets/', () => {
  const at = (t) => ({ published_at: t });

  it('is false when brackets was never published', () => {
    assert.equal(isTakenDown({}), false);
    assert.equal(isTakenDown({ sleep: at('2026-08-29T22:58:00Z') }), false);
    assert.equal(isTakenDown(null), false);
  });

  it('is false when brackets is the most recent write to the page', () => {
    assert.equal(isTakenDown({
      brackets: at('2026-08-29T19:42:00Z'),
      sleep: at('2026-08-28T22:58:00Z'),
    }), false);
  });

  it('is true when a later sleep took the page down', () => {
    assert.equal(isTakenDown({
      brackets: at('2026-08-29T19:42:00Z'),
      sleep: at('2026-08-29T22:58:00Z'),
    }), true);
  });

  it('is true when a later results publish took the brackets down with it', () => {
    assert.equal(isTakenDown({
      brackets: at('2026-08-29T19:42:00Z'),
      results: at('2026-08-29T22:10:00Z'),
    }), true);
  });

  it('ignores a record with no timestamp rather than treating it as newest', () => {
    assert.equal(isTakenDown({
      brackets: at('2026-08-29T19:42:00Z'),
      sleep: { commit_sha: 'abc' },
    }), false);
  });
});

describe('the labels are one set, so the button and its log row use one word', () => {
  it('names every scope in all three maps', () => {
    for (const scope of ['brackets', 'results', 'sleep']) {
      assert.ok(SCOPE_LABEL[scope], scope + ' has no descriptive label');
      assert.ok(BUTTON_LABEL[scope], scope + ' has no button label');
      assert.ok(SCOPE_NAME[scope], scope + ' has no log-column name');
    }
  });

  it('never shows the operator the word `sleep`', () => {
    assert.equal(BUTTON_LABEL.sleep, 'Take down brackets');
    assert.doesNotMatch(SCOPE_LABEL.sleep, /sleep/i);
    assert.doesNotMatch(SCOPE_NAME.sleep, /sleep/i);
  });
});

describe('tagClass', () => {
  it('maps every tag the two tabs can produce', () => {
    for (const tag of ['Sending', 'Committed', 'No changes', 'Dry run', 'Taken down', 'Failed']) {
      assert.notEqual(tagClass(tag), 'tag', tag + ' fell through to the bare class');
    }
  });

  it('falls back rather than throwing on an unknown tag', () => {
    assert.equal(tagClass('whatever'), 'tag');
  });
});
