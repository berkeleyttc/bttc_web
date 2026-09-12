/**
 * `score-entry.js` -- the score-pair rule against the Python oracle, and the group rules
 * the Scores tab decides with.
 *
 * **Why this file exists (F41).** `3`/`3` was asserted twice, in two languages, and
 * neither copy was pinned: on 2026-09-11 the remedy sweep deleted `!hasInvalid(...)`
 * from BOTH write paths of `tabs/scores.js` -- auto-submit and the button -- and
 * `node --test` stayed at 294 green. It could not have gone red: `hasInvalid` lived
 * inside `setup()`, and `test/README.md` draws its line at the tab modules, which read
 * `window.Vue` at module top. The rules were lifted out so that this file can reach
 * them, the same move `member-form.js` made for the PIN rule.
 *
 * The fixture is emitted by `bttc_api/tests/oracles/oracle_pairs.py` from
 * `roundrobin.scores.is_valid_pair` -- ticket 05: *"Python stays the definition of
 * correct; JS is the thing under test."* Every row is asserted, the 25 alphabet pairs and
 * the probes outside the alphabet alike. A mismatch here is a port bug, never a design
 * difference.
 *
 * Cells below are the tab's own shape: `{ '1_2': { a, b }, ... }`, keyed by seed pair.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ALPHABET, pairProblem, isEntered, entered, invalidKeys, hasInvalid, groupState,
  dirty, savedComplete, submitProblem, autoSubmitDue,
  pairsIn, totalPairs, clearGroupPrompt, clearAllPrompt,
} from '../score-entry.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = JSON.parse(readFileSync(here('./fixtures/pairs.json'), 'utf8'));

const live = { readOnly: false, busy: false };

/** A full three-player group: three pairs, every one entered and valid. */
const complete = () => ({ '1_2': { a: '3', b: '1' }, '1_3': { a: '0', b: '3' }, '2_3': { a: 'D', b: '2' } });

describe('pairProblem -- the oracle, every row', () => {
  it('replays every pair the oracle emitted', () => {
    assert.equal(fixture.symbols.length, 12, 'five alphabet symbols and seven probes');
    assert.equal(fixture.pairs.length, 144, 'twelve symbols squared');
    for (const { a, b, valid } of fixture.pairs) {
      assert.equal(pairProblem(a, b) === null, valid,
        JSON.stringify(a) + ' / ' + JSON.stringify(b) + ' must be ' + (valid ? 'accepted' : 'refused'));
    }
  });

  it('carries the alphabet the oracle carries, in order', () => {
    assert.deepEqual(fixture.symbols.slice(0, 5), ALPHABET);
  });

  it('refuses exactly one pair inside the alphabet, and says which', () => {
    const refused = [];
    for (const a of ALPHABET) for (const b of ALPHABET) if (pairProblem(a, b)) refused.push(a + '/' + b);
    assert.deepEqual(refused, ['3/3']);
    // The sentence is the one the tab used to keep in `submitReason`; it renders under
    // the Submit button, so it names the rule the operator can act on.
    assert.match(pairProblem('3', '3'), /3 \/ 3/);
  });

  it('reports the alphabet before the pair, so a bad symbol is named as such', () => {
    assert.match(pairProblem('4', '3'), /0 1 2 3 D/);
    assert.doesNotMatch(pairProblem('', ''), /3 \/ 3/);
  });
});

describe('the group rules -- what the tab decides with', () => {
  it('a half-entered cell is not yet entered and never invalid', () => {
    // Blank means NOT YET ENTERED (ticket 19 Q4). A `3` typed into one box while the
    // other is still empty must not light the halo, or every cell would flash red for a
    // keystroke. Only a PAIR can be wrong.
    const cells = { '1_2': { a: '3', b: '' }, '1_3': { a: '3', b: '3' } };
    assert.equal(isEntered(cells['1_2']), false);
    assert.equal(entered(cells), 1);
    assert.deepEqual(invalidKeys(cells), ['1_3']);
    assert.equal(hasInvalid(cells), true);
    assert.equal(hasInvalid({ '1_2': { a: '3', b: '' } }), false);
    assert.equal(hasInvalid(undefined), false);
  });

  it('groupState is none / partial / done against the pair count', () => {
    assert.equal(groupState({}, 3), 'none');
    assert.equal(groupState(undefined, 3), 'none');
    assert.equal(groupState({ '1_2': { a: '3', b: '1' } }, 3), 'partial');
    assert.equal(groupState(complete(), 3), 'done');
  });

  it('dirty is a structural diff against the server shadow, not a flag', () => {
    const a = complete();
    const b = { '2_3': { a: 'D', b: '2' }, '1_2': { a: '3', b: '1' }, '1_3': { a: '0', b: '3' } };
    assert.equal(dirty(a, b), false, 'key order is not a difference');
    assert.equal(dirty(a, undefined), true);
    assert.equal(dirty(undefined, undefined), false);
    b['1_2'].b = '2';
    assert.equal(dirty(a, b), true);
  });

  it('savedComplete is the latch: the SERVER holds every pair', () => {
    assert.equal(savedComplete(complete(), 3), true);
    assert.equal(savedComplete({ '1_2': { a: '3', b: '1' } }, 3), false);
    assert.equal(savedComplete(undefined, 3), false);
  });

  it('submitProblem gives the reasons in the order the operator needs to hear them', () => {
    const cells = complete();
    assert.equal(submitProblem(cells, undefined, live), null, 'a dirty, valid group can be sent');
    assert.match(submitProblem(cells, undefined, { readOnly: true, busy: true }), /lease/);
    assert.match(submitProblem(cells, undefined, { readOnly: false, busy: true }), /saving/);
    const bad = complete(); bad['2_3'] = { a: '3', b: '3' };
    assert.match(submitProblem(bad, undefined, live), /3 \/ 3/);
    assert.match(submitProblem({}, undefined, live), /nothing entered/);
    assert.match(submitProblem(undefined, undefined, live), /nothing entered/);
    assert.match(submitProblem(cells, complete(), live), /nothing to save/);
  });

  it('a partial group can be sent by the button, though never by auto-submit', () => {
    // canSubmit needs entered > 0; auto-submit needs entered === pairs.
    const partial = { '1_2': { a: '3', b: '1' } };
    assert.equal(submitProblem(partial, undefined, live), null);
    assert.equal(autoSubmitDue(partial, undefined, 3), false);
  });
});

describe('autoSubmitDue -- the incomplete → complete edge, and the test that was missing', () => {
  it('fires for a complete, valid group the server does not hold', () => {
    assert.equal(autoSubmitDue(complete(), undefined, 3), true);
    assert.equal(autoSubmitDue(complete(), { '1_2': { a: '3', b: '1' } }, 3), true,
      'a partial server copy is still short of the latch');
  });

  it('does NOT fire when a cell reads 3 / 3', () => {
    // THE MUTATION THIS PINS. On 2026-09-11 the `!hasInvalid(g)` term was deleted from
    // maybeAuto and canSubmit both, and the suite stayed green at 294. Delete the
    // hasInvalid term from autoSubmitDue now and this goes red.
    const bad = complete(); bad['1_3'] = { a: '3', b: '3' };
    assert.equal(entered(bad), 3, 'the group is complete -- only validity should stop it');
    assert.equal(autoSubmitDue(bad, undefined, 3), false);
  });

  it('does NOT fire once the server holds a full group (every later edit is a correction)', () => {
    const edited = complete(); edited['1_2'].b = '2';
    assert.equal(dirty(edited, complete()), true);
    assert.equal(autoSubmitDue(edited, complete(), 3), false);
  });

  it('does NOT fire when nothing differs from the shadow, or while a pair is still blank', () => {
    const partial = complete(); partial['2_3'] = { a: 'D', b: '' };
    assert.equal(autoSubmitDue(complete(), complete(), 3), false);
    assert.equal(autoSubmitDue(partial, undefined, 3), false);
  });
});

describe('the Clear controls -- ticket 19 Q11, the count is computed, never transcribed', () => {
  // The reference session: ten groups, `[6,6,6,6,6,7,7,7,7,7]`. Legacy's confirm said
  // "335 matches", a number that is none of its measures (180 pairs, 178 played, 360
  // cells, 356 deltas) and divides into none of them. These are the sentences the tab
  // puts in `window.confirm`; the confirm and the POST that follows stay I/O in the tab.
  const reference = [6, 6, 6, 6, 6, 7, 7, 7, 7, 7]
    .map((n, i) => ({ ordinal: i + 1, players: Array.from({ length: n }, (_, k) => ({ seed: k + 1 })) }));

  it('counts the pairs in a group by the closed form, and never below zero', () => {
    assert.equal(pairsIn(0), 0);
    assert.equal(pairsIn(1), 0);
    assert.equal(pairsIn(2), 1);
    assert.equal(pairsIn(6), 15);
    assert.equal(pairsIn(7), 21);
  });

  it('sums the evening to 180 for the reference session, and 0 for none', () => {
    assert.equal(totalPairs(reference), 180);
    assert.equal(totalPairs([]), 0);
  });

  it('words the per-group confirm with its own pair count', () => {
    assert.equal(clearGroupPrompt(3, 15), 'Clear all 15 results for group 3?');
    assert.equal(clearGroupPrompt(10, 21), 'Clear all 21 results for group 10?');
  });

  it('words the all-groups confirm from the computed total, not from docs/00:34', () => {
    const text = clearAllPrompt(reference);
    assert.equal(text, 'Clear results for ALL 10 groups? 180 matches.');
    assert.doesNotMatch(text, /335/);
  });
});
