/**
 * `score-entry.js` -- the score-pair rule and the per-group rules the Scores tab
 * decides with. Pure functions over the two objects the tab keeps per group.
 *
 * **Why this is not inside `tabs/scores.js`.** The same reason `member-form.js` is not
 * inside `tabs/roster.js`: the tab reads `window.Vue` at module top, which puts it on
 * the far side of `test/README.md`'s line, and a rule that cannot be imported cannot be
 * tested. This one was *measured* untested (F41, 2026-09-11): deleting `!hasInvalid(...)`
 * from both of the tab's write paths left `node --test` green at 294. Everything here
 * is reached by `test/score-entry.test.js`, and the pair rule is held to a fixture the
 * Python emits.
 *
 * **Two objects per group**, both keyed by seed pair `'<lo>_<hi>'` with `{ a, b }` cells:
 * `cells` is the operator's draft, `saved` is the shadow of what the server holds. A
 * blank half means NOT YET ENTERED (ticket 19 Q4); a match that did not happen is typed
 * `0/0` or `D`. Only a fully entered pair can be wrong.
 */

/** Ticket 19 Q5. `D` is a real forfeit; the `-99` sentinel died with ticket 11. */
export const ALPHABET = ['0', '1', '2', '3', 'D'];

/**
 * What is wrong with a pair of game counts, or `null` if nothing is.
 *
 * **Mirrors `bttc_api` `roundrobin/scores.py` `is_valid_pair` exactly**, and
 * `test/fixtures/pairs.json` is that function's answer for every pair over the alphabet
 * and seven symbols outside it. Two halves, in the Python's order:
 *
 * - **outside the alphabet.** Upper-cased first, as the Python is, so a lowercase `d`
 *   passes here as it does there. The tab's keystroke filter upper-cases before a value
 *   is stored, so no box can hold one; the half exists so that this rule stands alone
 *   and the fixture can be exhaustive rather than trusting the filter.
 * - **`3`/`3`**, the one impossible result. `2/1 1/2 2/2 D/1 D/0 0/0` are all accepted
 *   *and rated* -- the narrow-validation trap ticket 19 Q6 named.
 *
 * Returns a sentence rather than a code: it renders under the Submit button.
 */
export function pairProblem(a, b) {
  const A = String(a ?? '').toUpperCase();
  const B = String(b ?? '').toUpperCase();
  if (!ALPHABET.includes(A) || !ALPHABET.includes(B)) {
    return 'a score is one of 0 1 2 3 D';
  }
  if (A === '3' && B === '3') {
    return 'a cell reads 3 / 3 — one side wins 3';
  }
  return null;
}

/** Both halves typed. Blank is NOT YET ENTERED, never a value. */
export function isEntered(c) {
  return !!c && c.a !== '' && c.b !== '' && c.a != null && c.b != null;
}

export function entered(cells) {
  return Object.values(cells || {}).filter(isEntered).length;
}

/** The keys whose ENTERED pair is wrong -- the halo and the message under the grid. */
export function invalidKeys(cells) {
  return Object.keys(cells || {})
    .filter((k) => isEntered(cells[k]) && pairProblem(cells[k].a, cells[k].b) !== null);
}

export function hasInvalid(cells) {
  return invalidKeys(cells).length > 0;
}

/** The pill's fill channel: nothing, some, or every pair entered. */
export function groupState(cells, pairs) {
  const e = entered(cells);
  if (e === 0) return 'none';
  return e === pairs ? 'done' : 'partial';
}

const normalise = (o) => JSON.stringify(
  Object.keys(o || {}).sort().map((k) => [k, o[k].a, o[k].b]));

/** The pill's corner dot: the draft differs from the server shadow. A diff, not a flag. */
export function dirty(cells, saved) {
  return normalise(cells) !== normalise(saved);
}

/** The latch: once the SERVER holds a full group, every later edit is a correction. */
export function savedComplete(saved, pairs) {
  return Object.values(saved || {}).filter((c) => c.a && c.b).length === pairs;
}

/**
 * Why the Submit button is disabled, or `null` if it is not. `canSubmit` is `=== null`.
 *
 * The reasons in the order the operator needs to hear them: the lease, a save in
 * flight, a wrong cell (its own sentence), an empty grid, nothing changed. A PARTIAL
 * group can be sent this way -- the button needs one entered pair, where auto-submit
 * needs all of them.
 */
export function submitProblem(cells, saved, { readOnly, busy }) {
  if (readOnly) return 'another operator holds the editor lease';
  if (busy) return 'saving…';
  const bad = invalidKeys(cells);
  if (bad.length) return pairProblem(cells[bad[0]].a, cells[bad[0]].b);
  if (entered(cells) === 0) return 'nothing entered yet';
  if (!dirty(cells, saved)) return 'nothing to save';
  return null;
}

/**
 * Auto-submit is the incomplete → complete **EDGE**, not the standing predicate
 * (ticket 19 Q6, forced by ticket 20 Q1): every pair entered, every pair valid, the
 * draft differing from the shadow, and the server NOT already holding a full group.
 * The lease and the in-flight POST are the tab's to check; they are I/O state, not a
 * rule about the group.
 */
export function autoSubmitDue(cells, saved, pairs) {
  if (savedComplete(saved, pairs)) return false;
  return entered(cells) === pairs && !hasInvalid(cells) && dirty(cells, saved);
}
