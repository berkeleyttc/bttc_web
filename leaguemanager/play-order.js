/**
 * Play order and table assignment.
 *
 * MatchOrder5/6/7 and AssignTableLabels, transcribed from the C#. Ticket 05 put these
 * in the browser, against the recommendation, and named the cost: `verify_play_order.py`
 * exists precisely because these constants drifting is a real failure mode.
 *
 * What pays that cost is `test/play-order.test.js`, which replays a fixture emitted by
 * `bttc_api/tests/oracles/oracle_play_order.py`. Python is the definition of correct;
 * this file is the thing under test, and it must match with zero declared divergences
 * (ticket 07 designed nothing here -- it is all transcription, so any mismatch is a
 * port bug, never a design difference).
 *
 * A native ES module with **no** dependency on ENV, bttc-utils.js, window or fetch, so
 * `node --test` and the browser run literally the same bytes. No package.json, no
 * bundler -- modules are not a build step, so bttc_web's CLAUDE.md rule holds.
 */

/**
 * Declarations.cs:396-399. Flat pairs of 0-based seat indices, in playing order.
 *
 * These are lookup tables, **not** the circle method, and no player appears in two
 * consecutive matches -- a property of the constants that nothing in the C# enforces
 * or checks. The comment at Declarations.cs:468-471 claims these replaced an earlier
 * set; they are byte-identical to it, so the replacement never happened.
 */
export const MATCH_ORDER = Object.freeze({
  5: Object.freeze([0, 4, 1, 3, 0, 2, 1, 4, 2, 3, 0, 1, 2, 4, 0, 3, 1, 2, 3, 4]),
  6: Object.freeze([0, 5, 1, 4, 2, 3, 0, 4, 2, 5, 1, 3, 0, 2, 3, 4, 1, 5, 0, 3,
                    1, 2, 4, 5, 0, 1, 3, 5, 2, 4]),
  7: Object.freeze([0, 6, 1, 2, 4, 5, 0, 3, 2, 6, 1, 4, 3, 5, 0, 4, 1, 6, 2, 5,
                    3, 4, 0, 1, 5, 6, 2, 3, 4, 6, 0, 5, 1, 3, 2, 4, 3, 6, 0, 2, 1, 5]),
});

/**
 * TableMapping.cs:190-213 -- the printed floor map's front run, top to bottom, as
 * 0-based assignment ordinals. Confirmed element for element against the real printed
 * map photographed on Fri Aug 7 2026.
 */
export const PRINT_FRONT_RUN_TOP_TO_BOTTOM = Object.freeze([7, 6, 2, 3, 0, 1, 4, 5]);

/**
 * Form1.cs case 983 -- TableToWebPageMapping. Floor-plan shape (3, 8, 9).
 *
 * This is the print order reversed **except at two positions**: ordinals 2 and 3 are
 * transposed. That is suspected bug #55, and the port carries both run lists
 * unreconciled, as the C# does -- ticket 18 put the unification and declined it,
 * because neither buys anything observable. Measured latent: 37 published sessions
 * over nine months, all shape (3, 8, 9), all front run 3,3,1,1,2,2,4,4.
 */
export const WEB_MAPPING_983 = Object.freeze([
  Object.freeze([17, 18, 19]),
  Object.freeze([5, 4, 1, 0, 2, 3, 6, 7]),
  Object.freeze([16, 15, 14, 13, 12, 11, 10, 9, 8]),
]);

export const TABLES_AVAILABLE = 20;

/** Turn a flat MatchOrder array into `[[a, b], ...]`. */
export function matchPairs(n) {
  const arr = MATCH_ORDER[n];
  if (!arr) throw new Error(`no play order for a group of ${n}`);
  const out = [];
  for (let i = 0; i < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
  return out;
}

/**
 * TableMapping.cs:231-303, faithfully -- shares and all.
 *
 * `groupTables` is one numeric-with-halves count per group, in group order: 1.5, 2,
 * 2.5. Returns `{ myTables, labels }` where `myTables[g]` is the 0-based assignment
 * ordinals that group plays on and `labels[t]` is what the floor map prints on table
 * `t` -- a group number, `"g/g+1"` for a shared table, or `"open"`.
 *
 * The 0.5 branch is transcribed as-is: the `[0.5, 3]` guard, the unguarded branch at
 * :275 ("No safety net here") and the one-step-late check at :280. **It ships
 * unverified against real data** -- no .bttc from a night with a shared table has ever
 * been archived, and 0 of 37 published sessions had one. Registered NO_ORACLE.
 */
export function assignTableLabels(groupTables, numClubTables,
                                  tablesAvailable = TABLES_AVAILABLE) {
  const myTables = groupTables.map(() => []);
  const labels = new Array(tablesAvailable).fill('');
  let thisTable = 0;
  let thisGroup = 0;
  let numTables = 0;

  while (thisGroup < groupTables.length && numTables >= 0 && thisTable < tablesAvailable) {
    if (numTables === 0) numTables = groupTables[thisGroup];
    if (numTables < 0.5 || numTables > 3) {
      throw new Error(`unexpected table count ${numTables} in group ${thisGroup}`);
    }
    if (numTables >= 1) {
      labels[thisTable] = String(thisGroup + 1);
      myTables[thisGroup].push(thisTable);
      thisTable += 1;
      numTables -= 1;
    } else if (numTables === 0.5) {
      thisGroup += 1;                                  // ++thisgroup, TableMapping.cs:278
      labels[thisTable] = `${thisGroup}/${thisGroup + 1}`;
      myTables[thisGroup - 1].push(thisTable);
      myTables[thisGroup].push(thisTable);
      thisTable += 1;
      numTables = groupTables[thisGroup] - 0.5;
      if (numTables !== Math.trunc(numTables)) {
        throw new Error(`unknown table count ${numTables} in group ${thisGroup}`);
      }
    }
    if (numTables === 0) thisGroup += 1;
  }
  for (let i = thisTable; i < Math.min(numClubTables, tablesAvailable); i += 1) {
    labels[i] = 'open';
  }
  return { myTables, labels };
}
