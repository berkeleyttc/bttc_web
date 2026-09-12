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
  linksFor, tagClass, outcomeOf, errorOf, isTakenDown, clearsBracketsStale, bracketsNotice,
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

/**
 * **Run against every shape the server actually emits, not just the one this file used to
 * build.** `rr_publish_service.py:557-568` writes the timestamp under two different keys:
 *
 *   persisted  `events.details["rr_publish"][scope]`   -> `{ at }`            (COLD LOAD)
 *   committed  `POST /rr/publish` 200                  -> `{ at, published_at }`
 *   dry run / NO_CHANGES  (`:508`, `:534`)             -> `{ published_at }`
 *
 * This describe previously built only the third and asserted `isTakenDown` on it, which is
 * the one shape that never survives an F5 -- `finalize.js:199` and `draw.js:626` store a
 * body into `session.rrPublish` only when the tag is `Committed`. The persisted shape was
 * therefore never exercised, and `isTakenDown` read `published_at` alone, so on every cold
 * load it saw `null` and returned `false`: a live link to a deleted page.
 */
const SHAPES = {
  'persisted (cold load)': (t) => ({ published_at: undefined, at: t }),
  'committed response': (t) => ({ at: t, published_at: t }),
  'dry run / NO_CHANGES response': (t) => ({ published_at: t }),
};

for (const [shapeName, at] of Object.entries(SHAPES)) {
  describe('isTakenDown -- ' + shapeName, () => {
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
}

describe('isTakenDown -- shapes mixed, which is the real cold-load-plus-one-publish case', () => {
  it('sees a persisted sleep as later than a live committed brackets body', () => {
    // The operator published brackets this session (response shape, both keys) and the
    // sleep record came off the cold load (persisted shape, `at` only).
    assert.equal(isTakenDown({
      brackets: { at: '2026-08-29T19:42:00Z', published_at: '2026-08-29T19:42:00Z' },
      sleep: { at: '2026-08-29T22:58:00Z' },
    }), true);
  });

  it('sees a persisted brackets as later than a persisted results', () => {
    assert.equal(isTakenDown({
      brackets: { at: '2026-08-29T22:58:00Z' },
      results: { at: '2026-08-29T19:42:00Z' },
    }), false);
  });

  // The regression itself, stated as one assertion so a revert names the defect.
  it('does not report a persisted brackets record as absent', () => {
    assert.equal(isTakenDown({
      brackets: { at: '2026-08-29T19:42:00Z' },
      sleep: { at: '2026-08-29T22:58:00Z' },
    }), true, 'a cold-load record keys its timestamp `at`, not `published_at`');
  });
});

describe('clearsBracketsStale -- F40, the flag must not outlive its own remedy', () => {
  it('clears on a real committed publish', () => {
    assert.equal(clearsBracketsStale(outcomeOf({ commit_sha: 'a'.repeat(40) }, false)), true);
  });

  it('clears on NO_CHANGES, the one case where the page is provably current', () => {
    assert.equal(clearsBracketsStale(outcomeOf({ code: 'NO_CHANGES' }, false)), true);
  });

  it('does NOT clear on a dry run', () => {
    assert.equal(clearsBracketsStale(outcomeOf({ commit_sha: 'a'.repeat(40) }, true)), false);
  });

  it('does NOT clear on a dry run that happens to find an identical tree', () => {
    // `outcomeOf` lets `isNoChanges` win over `dryRun`, so this is tagged `No changes`
    // while having changed nothing. Tag-only logic would clear the flag on a rehearsal,
    // and the server does not advance the record's `at` for it either.
    const out = outcomeOf({ code: 'NO_CHANGES' }, true);
    assert.equal(out.tag, 'No changes', 'precondition: the tag really is misleading here');
    assert.equal(clearsBracketsStale(out), false);
  });

  it('clears on nothing else', () => {
    assert.equal(clearsBracketsStale(null), false);
    assert.equal(clearsBracketsStale(undefined), false);
    assert.equal(clearsBracketsStale({ tag: 'Failed', dryRun: false }), false);
    assert.equal(clearsBracketsStale({ tag: 'Sending', dryRun: false }), false);
  });
});

describe('bracketsNotice -- the two bracket-page warnings never render together', () => {
  // Publish brackets, re-commit the draw, publish sleep or results: the server's
  // `bracketsStale` and the client's `Taken down` both hold, and until this rule the panel
  // printed both sentences -- "the published brackets show the earlier draw" beside "taken
  // down since". The first premise is false when the second holds: there is no page to be
  // wrong. One sentence carries both facts.
  it('merges into one notice when the page is gone AND the draw has moved', () => {
    assert.equal(bracketsNotice(true, { tag: 'Taken down' }), 'down-and-stale');
  });

  it('is `down` alone when the page is gone and the draw has not moved', () => {
    assert.equal(bracketsNotice(false, { tag: 'Taken down' }), 'down');
  });

  it('is `stale` alone under every other row, since the page is still up', () => {
    for (const tag of ['Committed', 'No changes', 'Sending', 'Dry run', 'Failed']) {
      assert.equal(bracketsNotice(true, { tag }), 'stale', tag);
    }
  });

  it('is `stale` with no row at all, which is the flag before the cold load fills rrPublish', () => {
    assert.equal(bracketsNotice(true, null), 'stale');
    assert.equal(bracketsNotice(true, undefined), 'stale');
  });

  it('is nothing when neither holds', () => {
    assert.equal(bracketsNotice(false, null), null);
    assert.equal(bracketsNotice(false, { tag: 'Committed' }), null);
    assert.equal(bracketsNotice(undefined, { tag: 'Committed' }), null);
  });

  it('reads the flag as a boolean, the way the template does', () => {
    assert.equal(bracketsNotice(1, { tag: 'Taken down' }), 'down-and-stale');
    assert.equal(bracketsNotice(0, { tag: 'Taken down' }), 'down');
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
