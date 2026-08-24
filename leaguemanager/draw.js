/**
 * The draw: solution selection, the FSM parser, the enumerator, partition and seeding.
 *
 * Ticket 05 put the whole draw in the browser -- deliberately, and against the
 * recommendation. The reasoning: the roster arrives from `/rr/roster`, at which point
 * the client knows the player count, the table count and the max per group, so it can
 * compute the groups; the operator tweaks until satisfied; the finished groups are
 * POSTed. The server does **structural validation only**, never re-derivation.
 *
 * Ticket 07 then designed nothing here -- the whole tables/solutions surface is a
 * transcription of the C#. That gives this file the strongest oracle relationship in
 * the port: it must reproduce `oracle_solutions.py` and `oracle_partition.py` on the
 * Jul 17 session with **zero declared divergences**. Any mismatch is a port bug.
 *
 * Two rankings ship, unreconciled, exactly as the C# has them. The enumerator ranks
 * fewest-idle-tables-first; the curated table deliberately idles 1-4 tables at seven
 * roster sizes (47-51, 54, 55), preferring eight groups of six to seven of seven. ADR
 * 0001 names that curation as its worked example of behaviour that reads like a bug
 * and is a real club preference.
 *
 * A native ES module with no dependency on ENV, bttc-utils.js, window or fetch, so
 * `node --test` and the browser run literally the same bytes.
 */

export const NUM_TABLES = 20;
export const MAX_PLAYERS_PER_GROUP = 7;   // Form1.cs:54
export const MAX_SOLUTIONS_LISTED = 35;   // Declarations.cs:137

/**
 * TableDistribution.cs:83-100 -- `[moniker, players, tables, efficiency%]`.
 *
 * An array, not an object: the enumerator walks these in source order and the order is
 * load-bearing, so it should not depend on a language's property-ordering rules.
 *
 * Four forms are commented out in the live source and are absent here: `(7, 7)³`,
 * bare `5`, `8²` and `8³`. Bare `5` is why **F9 (1-table groups) is deferred** -- no
 * catalogue shape produces one, so adding it would diverge from the oracle by
 * construction.
 */
export const DISTRIBUTIONS = Object.freeze([
  Object.freeze(['6³', 6, 3, 100]),
  Object.freeze(['6²', 6, 2, 66]),
  Object.freeze(['7³', 7, 3, 85]),
  Object.freeze(['5²', 5, 2, 80]),
  Object.freeze(['(6, 6)⁵', 12, 5, 83]),
  Object.freeze(['(7, 7)⁵', 14, 5, 71]),
  Object.freeze(['(6, 5)⁴', 11, 4, 71]),
  Object.freeze(['(5, 5)³', 10, 3, 60]),
  Object.freeze(['7²', 7, 2, 57]),
  Object.freeze(['(6, 7)⁴', 13, 4, 50]),
  Object.freeze(['(6, 6)³', 12, 3, 50]),
]);

const SUPERSCRIPTS = '²³⁴⁵';   // 2 3 4 5

/** GenerateTPListFromText2's state machine, TableDistribution.cs:535-675. */
const FSM = [
  { '567': [1, 1], '(': [0, 2] },                             // 0
  { ',': [2, 0], '/': [0, 7], [SUPERSCRIPTS]: [3, 8] },       // 1
  { '567': [1, 3] },                                          // 2
  { ',': [0, 4] },                                            // 3
  { '567': [1, 5] },                                          // 4
  { ')': [0, 6] },                                            // 5
  { '/': [0, 7], [SUPERSCRIPTS]: [3, 8] },                    // 6
  { '12345': [1, 8] },                                        // 7
  { ',': [2, 0] },                                            // 8
];

class Stacklet {
  constructor() { this.clear(); }
  clear() { this.s1 = 0; this.s2 = 0; this.s3 = 0; }
  push(x) { this.s3 = this.s2; this.s2 = this.s1; this.s1 = x; return true; }
  status() {
    if (this.s3 > 0) return 3;
    if (this.s2 > 0) return 2;
    if (this.s1 > 0) return 1;
    return 0;
  }
}

/**
 * Parse a solution string into `{ pairs, error }`.
 *
 * `tables` may be fractional: `(a, b)⁴` gives the two groups 1.5 and 2.5, and
 * `(a, b)³` / `(a, b)⁵` split evenly. Those are **shares** -- one physical table
 * carrying two groups -- and ticket 07 kept them exactly as the C# has them.
 *
 * Split out of `parseSpec()` so the operator-typed path can say WHERE the string went
 * wrong. Legacy shows a message box naming the position and the character
 * (`TableDistribution.cs:663`); `parseSpec()` returning a bare `null` cannot, and a
 * `Console.Beep()` is not a port target. The public `parseSpec()` contract is unchanged.
 */
function parseSpecDetailed(text) {
  const seq = String(text).split('»')[0].replace(/\s+/g, '');
  // `TableDistribution.cs:628-632` -- "Blank specification line not allowed."
  if (!seq) return { pairs: null, error: 'Blank specification line not allowed.' };
  const pairs = [];
  const stack = new Stacklet();
  let state = 0;

  function record() {                              // DoFunc func 2, :545-590
    const st = stack.status();
    if (st === 1) {                                // bare 5/6/7 -> 1/2/3 tables
      const i = stack.s1 - 5;
      if (i < 0 || i > 2) return false;
      pairs.push([stack.s1, [1, 2, 3][i]]);
    } else if (st === 2) {                         // 'np' + tables
      pairs.push([stack.s2, stack.s1]);
    } else if (st === 3) {                         // '(np,np)' + tables -- the SHARE
      const t = stack.s1;
      if (t === 4) {
        pairs.push([stack.s3, 1.5], [stack.s2, 2.5]);
      } else if (t === 3 || t === 5) {
        pairs.push([stack.s3, t / 2], [stack.s2, t / 2]);
      } else {
        return false;
      }
    } else {
      return false;
    }
    stack.clear();
    return true;
  }

  const bad = (pos, ch) => ({
    pairs: null,
    // `TableDistribution.cs:663`, 1-based as the C# reports it.
    error: 'Bad entry or syntax at position ' + (pos + 1) + ' (‘' + ch + '’) in “' + seq + '”.',
  });

  let ok = false;
  for (let pos = 0; pos < seq.length; pos += 1) {
    if (pos > 100) {                               // runaway guard, :642-646
      return { pairs: null, error: 'Runaway condition in sequence parse. Discard and recalculate.' };
    }
    const ch = seq[pos];
    let hit = null;
    for (const keys of Object.keys(FSM[state])) {
      if (keys.includes(ch)) { hit = FSM[state][keys]; break; }
    }
    if (hit === null) return bad(pos, ch);
    const fn = hit[0];
    state = hit[1];
    if (fn === 0) ok = true;
    else if (fn === 1) ok = stack.push(Number(ch));
    else if (fn === 2) ok = record();
    else if (fn === 3) ok = stack.push(SUPERSCRIPTS.indexOf(ch) + 2);
    if (!ok) return bad(pos, ch);
  }
  if (state === 1 || state === 8) ok = record();   // :667-668
  // States other than 1 and 8 are a truncated string -- `6²,` or `(5,`.
  return ok ? { pairs, error: null }
            : { pairs: null, error: '“' + seq + '” is not a complete solution.' };
}

/**
 * Parse a solution string into `[[players, tables], ...]`, or `null` on failure.
 *
 * The shape every existing caller and the oracle fixtures expect.
 */
export function parseSpec(text) {
  return parseSpecDetailed(text).pairs;
}

/**
 * The operator-typed solution, validated the way legacy validates it.
 *
 * `TableAssignment.cs:485-497`: a spec that parses is still rejected when its players do
 * not total the roster, and the message says so in the club's own words -- the
 * parenthetical exists because the mistake it names is the one operators actually make.
 *
 * Returns `{ pairs, error }`. `pairs` is `null` whenever `error` is set.
 */
export function validateSpec(text, rosterCount) {
  const { pairs, error } = parseSpecDetailed(text);
  if (!pairs) return { pairs: null, error };
  const total = pairs.reduce((n, p) => n + p[0], 0);
  if (total !== rosterCount) {
    return {
      pairs: null,
      error: 'Number of players specified (' + total + ') does not match the number in the '
        + 'roster (' + rosterCount + '). If you increased the players at one table, did you '
        + 'reduce the players at another?',
    };
  }
  return { pairs, error: null };
}

/**
 * GetQuickSolution's character scan, TableDistribution.cs:336-358.
 *
 * `divider` carries between solution strings in the C# -- suspected bug #16,
 * transcribed rather than fixed (ticket 07).
 */
export function quickTablesUsed(solution) {
  let count = 0;
  let divider = false;
  for (const ch of String(solution)) {
    if (ch === '²') count += 2;
    else if (ch === '³') count += 3;
    else if (ch === '⁴') count += 4;
    else if (ch === '⁵') count += 5;
    else if ('2345'.includes(ch)) count += divider ? Number(ch) : 0;
    divider = (ch === '|' || ch === '/');
  }
  return count;
}

/**
 * RecursDistribute + RecordDist, TableDistribution.cs:248-321.
 *
 * Used for **any table count other than 20**, where the curated table does not apply.
 * Ranks fewest idle tables first, then by the composite `rating`. Note the integer
 * division on the efficiency average -- `long / int` in C# -- and the truncating cast
 * on `rating`; both are load-bearing.
 */
export function enumerateSolutions(numPlayers, numTables) {
  const out = [];

  function record(distrib, runningSum, tablesFree) {
    const avg = Math.floor(runningSum / distrib.length);   // C# long/int
    const variety = new Set();
    let shares = 0;
    let tot2 = 0;
    const cfg = [];
    for (const idx of distrib) {
      const [name, p, , e] = DISTRIBUTIONS[idx];
      variety.add(idx);
      cfg.push(name);
      if (p > MAX_PLAYERS_PER_GROUP) shares += 1;
      tot2 += (e - avg) ** 2;
    }
    const sd = Math.sqrt(tot2 / (distrib.length - 1));
    const rating = Math.trunc((100 - avg) + sd + 2 * shares);   // C# (int) cast
    out.push({ eff: avg, spread: sd, free: tablesFree, variety: variety.size,
               rating, cfg: cfg.join(', '), shares });
  }

  function rec(start, playersLeft, tablesLeft, effSum, distrib) {
    if (tablesLeft < 0 || playersLeft < 0 || (playersLeft > 0 && playersLeft < 5)) return;
    if (playersLeft === 0) {
      if (distrib.length <= 1) return;
      record(distrib, effSum, tablesLeft);
      return;
    }
    for (let idx = start; idx < DISTRIBUTIONS.length; idx += 1) {
      const [, p, t, e] = DISTRIBUTIONS[idx];
      rec(idx, playersLeft - p, tablesLeft - t, effSum + e, distrib.concat(idx));
    }
  }

  rec(0, numPlayers, numTables, 0, []);
  // Array.prototype.sort is stable (ES2019), as Python's sorted is.
  out.sort((a, b) => (a.free - b.free) || (a.rating - b.rating));
  return out;
}

/**
 * The curated table, transcribed verbatim from TableDistribution.cs QuickSolutionsList.
 * 31 entries, 42 to 72 players inclusive, and it applies at **exactly 20 tables**.
 */
export const QUICK_SOLUTIONS = Object.freeze({
  42: ['6³, 6³, 6³, 6³, 6³, 6³, 6²'],
  43: ['6³, 6³, 6³, 6³, 6³, 6², 7³'],
  44: ['6³, 6³, 6³, 6³, 6², 7³, 7³'],
  45: ['6³, 6³, 6³, 6², 7³, 7³, 7³',
       '6³, 6³, 6³, 6³, 7³, (7, 7)⁵'],
  46: ['6³, 6³, 6², 7³, 7³, 7³, 7³',
       '6³, 6³, 6³, 7³, 7³, (7, 7)⁵'],
  47: ['6², 6², 7³, 7³, 7³, 7³, 7³',
       '7³, 7³, 7³, 7³, 7³, (6, 6)⁵'],
  48: ['6², 6², 6², 6², 6², 6², 6², 6²',
       '6³, 7³, 7³, 7³, 7³, (7, 7)⁵'],
  49: ['6², 6², 6², 6², 6², 6², 6², 7³',
       '7³, 7³, 7³, 7³, 7³, (7, 7)⁵'],
  50: ['6², 6², 6², 6², 6², 6², 7³, 7³'],
  51: ['6², 6², 6², 6², 6², 7³, 7³, 7³'],
  52: ['6², 6², 6², 6², 7³, 7³, 7³, 7³'],
  53: ['6², 6², 6², 7³, 7³, 7³, 7³, 7²'],
  54: ['6², 6², 6², 6², 6², 6², 6², 6², 6²',
       '6³, 6³, 6², 6², 6², 6², 6², 6², 6²'],
  55: ['6², 6², 6², 6², 6², 6², 6², 6², 7³',
       '6³, 6², 6², 6², 6², 6², 6², 6², 7³'],
  56: ['6², 6², 6², 6², 6², 6², 6², 7³, 7³'],
  57: ['6², 6², 6², 6², 6², 6², 7³, 7³, 7²'],
  58: ['6², 6², 6², 6², 6², (7, 7)⁵, (7, 7)⁵',
       '6², 6², 6², 6², 6², 7³, 7³, 7², 7²'],
  59: ['6², 6², 6², 6², 6², 6², 6², 6², 6², 5²',
       '6², 6², 6², 6², 7³, 7³, 7², 7², 7²'],
  60: ['6², 6², 6², 6², 6², 6², 6², 6², 6², 6²'],
  61: ['6², 6², 6², 6², 6², 6², 6², 6², 6², 7²',
       '6², 6², 6², 6², 6², 6², 6², 7³, (6, 6)³'],
  62: ['6², 6², 6², 6², 6², 6², 6², 6², 7², 7²'],
  63: ['6², 6², 6², 6², 6², 6², 6², 7², 7², 7²'],
  64: ['6², 6², 6², 6², 6², 6², 7², 7², 7², 7²'],
  65: ['6², 6², 6², 6², 6², 7², 7², 7², 7², 7²'],
  66: ['6², 6², 6², 6², 7², 7², 7², 7², 7², 7²'],
  67: ['6², 6², 6², 7², 7², 7², 7², 7², 7², 7²'],
  68: ['6², 6², 7², 7², 7², 7², 7², 7², 7², 7²'],
  69: ['6², 7², 7², 7², 7², 7², 7², 7², 7², 7²'],
  70: ['7², 7², 7², 7², 7², 7², 7², 7², 7², 7²'],
  71: ['(7, 7)⁵, 7², 7², 7², (6, 6)³, (6, 6)³, (6, 6)³',
       '6², 6², 7², 7², 7², 7², 7², (6, 6)³, (6, 6)³'],
  72: ['6², 7², 7², 7², 7², 7², 7², (6, 6)³, (6, 6)³'],
});

/**
 * TableDistribution.cs:152-156.
 *
 * Exactly 20 tables, and a roster inside the curated table's span. **Any other table
 * count abandons the curated table, runs the enumerator, and disables auto-select**, so
 * the operator picks from the dropdown every time. Making 17/18/19 first-class is F7;
 * counts above 20 are F8. Go-live ships legacy behaviour.
 */
export function hasQuickSolutionOption(rosterCount, numTables) {
  const sizes = Object.keys(QUICK_SOLUTIONS).map(Number);
  return numTables === 20
    && rosterCount >= Math.min(...sizes)
    && rosterCount <= Math.max(...sizes);
}

/**
 * Ticket 21 Q2: ordinal, case-insensitive, on `(last, first)`, then `users.id`.
 *
 * **One rule replacing legacy's four.** The id is what makes it a total order: the port
 * permits two members with identical names -- a duplicate warns, never blocks -- and
 * without it two identically-named tied players would reintroduce exactly the
 * non-determinism ticket 08's comparator exists to remove.
 *
 * The same rule lives server-side in `roundrobin/placement.py`. Two implementations of
 * one rule across the client/server seam, bound by `oracle_partition.py`.
 */
export function nameKey(lastName, firstName, userId) {
  return [String(lastName).toLowerCase(), String(firstName).toLowerCase(), userId];
}

/** Compare two `nameKey` triples. Ordinal on the strings, numeric on the id. */
export function compareNameKeys(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return a[2] - b[2];
}

/**
 * The seeding order: rating descending, then the collation above.
 *
 * `players` carry `{ userId, lastName, firstName, rating }`. Returns a new array.
 */
export function drawRoster(players) {
  return players.slice().sort((p, q) => {
    if (p.rating !== q.rating) return q.rating - p.rating;
    return compareNameKeys(nameKey(p.lastName, p.firstName, p.userId),
                           nameKey(q.lastName, q.firstName, q.userId));
  });
}

/**
 * DrawListCode.cs:260-315 -- a pure slice into the solution's group sizes, before any
 * promotion. Returns arrays of `userId`.
 */
export function sliceInto(roster, sizes) {
  const out = [];
  let i = 0;
  for (const n of sizes) {
    out.push(roster.slice(i, i + n).map((p) => p.userId));
    i += n;
  }
  return out;
}

/**
 * The whole pre-promotion draw for a roster at a table count.
 *
 * Returns `{ spec, sizes, groups }`, or `null` if no solution exists -- which is a real
 * outcome: a roster whose every partition strands 1-4 players yields an empty solution
 * list, and legacy's DistributeTables2() still returns true.
 *
 * **`specOverride` bypasses the two ranked lists entirely**, which is what legacy's
 * `CheckForUserAddedDraw()` needs (`DrawListCode.cs:157-176`): the operator types a
 * solution, it goes in at index 0 of `SortedSolutions`, and from then on the index no
 * longer means what it meant to the enumerator. A caller that maintains its own list --
 * `tabs/draw.js` does -- should pass the spec and ignore `solutionIndex`, because the
 * two orderings cannot be kept in step and a desync here silently draws a DIFFERENT
 * partition from the one named in the picker.
 *
 * `solutionIndex` is untouched for callers that do not, which is the oracle path
 * `test/draw.test.js` and `oracle_solutions.py` pin.
 */
export function draw(players, numTables = NUM_TABLES, solutionIndex = 0, specOverride = null) {
  const roster = drawRoster(players);
  let spec = null;
  if (specOverride) {
    spec = specOverride;
  } else if (hasQuickSolutionOption(roster.length, numTables)) {
    spec = QUICK_SOLUTIONS[roster.length][solutionIndex];
  } else {
    const sols = enumerateSolutions(roster.length, numTables);
    if (!sols.length) return null;
    spec = sols[Math.min(solutionIndex, sols.length - 1)].cfg;
  }
  const pairs = parseSpec(spec);
  if (!pairs) return null;
  const sizes = pairs.map((p) => p[0]);
  return { spec, sizes, tables: pairs.map((p) => p[1]), groups: sliceInto(roster, sizes) };
}

/* ══════════════════════════════════════════════════════════ promotion and seeding ══
 *
 * `docs/03` sections 5.2, 5.3 and 7.3. Session 6 wrote these; the file shipped in
 * session 3 with the PRE-promotion draw only, and `test/draw.test.js` characterised the
 * gap ("differs from the recorded groups only by promotion") rather than closing it --
 * which was correct while nothing called the algorithm and wrong once `POST /rr/draw`
 * needed a `promoted` flag per player.
 *
 * Promotion is **strictly one-in-one-out**, so it can never change a group's size. That
 * is worth stating up front because it is the invariant every branch below preserves,
 * and it is what `test/draw.test.js` asserts against the recorded session.
 *
 * Nothing here depends on `ENV`, `bttc-utils.js`, `window` or `fetch`, exactly as the
 * rest of the file does not.
 */

/** `Form1.cs:57`, read from the file at `FileIO.cs:599`, used at `Group.cs:262` alone. */
export const REJECT_PROMOTION_MAX_GAP = 150;

/**
 * `DrawListCode.cs:325`. The cap exists because more candidates would "wreak havoc with
 * the sorting conditions" (`Group.cs:209-227`).
 *
 * **Players beyond the cap stay put.** `FindPlayersToPromote` counts every flagged
 * player (`++numpromoted`) but only adds the first three to the list, so a fourth is
 * neither promoted nor demoted -- it simply never leaves its group.
 */
export const MAX_PROMOTION_CANDIDATES = 3;

/**
 * `ReSortPlayersInDraw`, `Group.cs:117-122`: rating descending, then the name key.
 *
 * The C# sorts by `LNFFullName` under `CurrentCulture`; ticket 21 Q2 replaced that with
 * the one collation rule -- ordinal, case-insensitive, `(last, first, users.id)` --
 * and **verified it leaves the Jul 17 slice byte-identical**, which is what keeps ticket
 * 07's zero declared divergences true. Everything `ReSortPlayersInDraw` once did for
 * "delayed status" players has been short-circuited (see `appendix-b-dead-code.md`).
 */
function resortGroup(ids, byId) {
  ids.sort((x, y) => {
    const p = byId[x];
    const q = byId[y];
    if (p.rating !== q.rating) return q.rating - p.rating;
    return compareNameKeys(nameKey(p.lastName, p.firstName, p.userId),
                           nameKey(q.lastName, q.firstName, q.userId));
  });
  return ids;
}

/**
 * `AdjustLowestRankings(ignorepromotedplayers: true)`, `Group.cs:169-207`.
 *
 * Returns the group's lowest and second-lowest **eligible** members, skipping anyone
 * still flagged for promotion.
 *
 * Two things are load-bearing and neither is obvious:
 *
 * 1. **The comparison is a strict `<`** (`:195`), so on a rating tie **the earlier index
 *    keeps the "lowest" slot**. Because the list is sorted rating-descending with names
 *    ascending, the earlier index is the alphabetically earlier name -- so of two
 *    equally-rated players at the bottom of a group, the one whose `(last, first)` sorts
 *    first is the one a promotion ejects.
 * 2. **`secondLowest` can hold the SAME rating as `lowest`**, in which case the gap test
 *    in `promoteInto` measures against that equal value.
 *
 * The C# is written confusingly -- its first loop sets `lowestindex` to the *first
 * eligible* player, which in a descending list is the *highest*-rated eligible one, and
 * the second loop then cascades both down to their true values. The result is correct;
 * the intermediate state is misleading. This reproduces the cascade rather than a
 * tidier two-minimum scan, because the tidier version disagrees on ties.
 */
export function adjustLowestRankings(ids, byId) {
  const eligible = (id) => !byId[id].toBePromoted;

  let lowest = -1;
  for (let i = 0; i < ids.length; i += 1) {
    if (!eligible(ids[i])) continue;
    lowest = i;
    break;
  }
  let second = -1;
  if (lowest !== -1) {
    for (let i = lowest + 1; i < ids.length; i += 1) {
      if (!eligible(ids[i])) continue;
      if (byId[ids[i]].rating < byId[ids[lowest]].rating) {
        second = lowest;
        lowest = i;
      } else if (second === -1 || byId[ids[i]].rating < byId[ids[second]].rating) {
        second = i;
      }
    }
  }
  return {
    lowest: lowest === -1 ? null : ids[lowest],
    secondLowest: second === -1 ? null : ids[second],
  };
}

/**
 * `FindPlayersToPromote(max)`, `Group.cs:227-243`. **Removes** the candidates from the
 * group it is called on and returns them, in list order.
 */
function findPlayersToPromote(ids, byId, max = MAX_PROMOTION_CANDIDATES) {
  const out = [];
  let counted = 0;
  for (const id of ids) {
    if (!byId[id].toBePromoted) continue;
    counted += 1;
    if (counted <= max) out.push(id);        // a fourth is counted and left in place
  }
  for (const id of out) ids.splice(ids.indexOf(id), 1);
  return out;
}

/**
 * `PromotePlayers(promolist)`, `Group.cs:245-311`, running on the **receiving** (higher)
 * group. Returns the list to be merged back down into the group below.
 *
 * **The gap is measured against the SECOND-lowest, not the lowest** (`:262`), because
 * the lowest is the one about to be ejected. So the test is *"would this player be more
 * than `RejectPromotionMaxGap` below the group as it will be AFTER the swap"*. Getting
 * that wrong by one rank is the single easiest mistake here and it would look entirely
 * plausible in every group.
 *
 * The `AddPlayer` failure arm and its *"Player promotion glitch"* message are
 * transcribed but unreachable: `AddPlayer` refuses only when the group is at
 * `MaxPlayers`, and a slot was just freed by the eject. It is kept because the trailing
 * drain below depends on the `break` existing.
 */
function promoteInto(receiving, candidates, byId, gap, promoted, maxPlayers) {
  const demoted = [];
  const queue = candidates.slice();

  while (queue.length) {
    const cand = queue[0];
    const { lowest, secondLowest } = adjustLowestRankings(receiving, byId);

    if (secondLowest != null
        && byId[cand].rating < byId[secondLowest].rating - gap) {
      byId[cand].note = 'gap/not promoted';
      demoted.push(cand);
      queue.shift();
      continue;
    }

    if (lowest == null) break;                    // EjectLowestPlayer returned null
    receiving.splice(receiving.indexOf(lowest), 1);

    if (maxPlayers > 0 && receiving.length >= maxPlayers) {
      // AddPlayer refused. Roll the eject back and demote the candidate instead.
      receiving.push(lowest);
      resortGroup(receiving, byId);
      demoted.push(cand);
      queue.shift();
      continue;
    }

    receiving.push(cand);
    byId[cand].toBePromoted = false;              // NowPromoted is a subset of ToBePromoted
    byId[cand].nowPromoted = true;
    resortGroup(receiving, byId);
    promoted.push(cand);
    demoted.push(lowest);
    queue.shift();
  }

  // "if anything went wrong" (:305-309): whatever is left in the queue goes down.
  while (queue.length) demoted.push(queue.shift());
  return demoted;
}

/**
 * `PromotePlayersAllGroups()`, `DrawListCode.cs:317-332`.
 *
 *     previous := null
 *     FOR EACH group g IN groups (index order, strongest first):
 *         IF previous ≠ null:
 *             candidates := g.find_players_to_promote(max = 3)   # REMOVES them from g
 *             demoted    := previous.promote_players(candidates)
 *             g.merge(demoted)
 *         previous := g
 *
 * **Group 0 promotes nobody** -- it has no group above it.
 *
 * `players` carry `{userId, lastName, firstName, rating, toBePromoted}`. `groups` are
 * arrays of `userId`, rating-sorted, as `draw()` returns them. Neither input is
 * mutated; the returned `promoted` list is in promotion order.
 */
export function promoteAllGroups(groups, players, gap = REJECT_PROMOTION_MAX_GAP) {
  const byId = {};
  for (const p of players) {
    byId[p.userId] = {
      userId: p.userId, lastName: p.lastName, firstName: p.firstName,
      rating: p.rating, toBePromoted: !!p.toBePromoted, nowPromoted: false, note: '',
    };
  }

  const out = groups.map((g) => g.slice());
  const promoted = [];

  for (let i = 1; i < out.length; i += 1) {
    const receiving = out[i - 1];
    const source = out[i];
    const maxPlayers = groups[i - 1].length;      // the solution fixes each group's size

    const candidates = findPlayersToPromote(source, byId);
    if (!candidates.length) continue;

    const demoted = promoteInto(receiving, candidates, byId, gap, promoted, maxPlayers);
    // MergePlayersList -> AddPlayer for each, which re-sorts.
    for (const id of demoted) source.push(id);
    resortGroup(source, byId);
  }

  return { groups: out, promoted, notes: byId };
}

/**
 * `UpdatePlayersGroupOrdinal()`, `DrawListCode.cs:342-372` -- the seeds.
 *
 * The ordinal is simply the player's index in the already-rating-sorted group. The
 * `switch` on group size that follows it in the C# sets `PlaysFirst`, which is play
 * order's business (`play-order.js`) and not the seed's.
 *
 * **1-based**, because `POST /rr/draw` validates that a group's seeds are exactly
 * `1..n` and every ordinal in the port's UI, on paper and in the DB is 1-based. The
 * 0-based convention of the `.bttc` file never reaches the port.
 */
export function assignSeeds(group) {
  return group.map((userId, i) => ({ userId, seed: i + 1 }));
}
