/**
 * draw.js against the Python oracle.
 *
 * Ticket 05: *"Python stays the definition of correct; JS is the thing under test."*
 * The fixtures here are emitted by `bttc_api/tests/oracles/oracle_solutions.py` and
 * `oracle_partition.py`, which run against the real Jul 17 session and refuse to emit
 * unless their own redaction is proven faithful.
 *
 * Ticket 07 designed nothing on this surface -- it is all transcription of the C# --
 * so the required standard is **zero declared divergences**. A mismatch here is a port
 * bug, never a design difference.
 *
 * Run: `node --test leaguemanager/test/`
 * No package.json, no node_modules, no bundler. Native ES modules import the shipping
 * files unchanged, so the harness tests the same bytes the browser runs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DISTRIBUTIONS, MAX_SOLUTIONS_LISTED, QUICK_SOLUTIONS, compareNameKeys, drawRoster,
  enumerateSolutions, hasQuickSolutionOption, nameKey, parseSpec, quickTablesUsed,
  sliceInto, draw, validateSpec,
  promoteAllGroups, adjustLowestRankings, assignSeeds,
  REJECT_PROMOTION_MAX_GAP, MAX_PROMOTION_CANDIDATES,
} from '../draw.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const load = (n) => JSON.parse(readFileSync(here(`./fixtures/${n}.json`), 'utf8'));

const solutions = load('solutions');
const partition = load('partition');

describe('solutions -- the curated table and the FSM parser', () => {
  it('gates on exactly 20 tables and the curated span', () => {
    for (const c of solutions.gate) {
      assert.equal(hasQuickSolutionOption(c.roster, c.tables), c.expected,
        `roster ${c.roster} at ${c.tables} tables`);
    }
  });

  it('parses every curated entry exactly as the oracle does', () => {
    const rosters = Object.keys(solutions.parsed);
    assert.equal(rosters.length, 31, 'the curated table has 31 entries');
    for (const n of rosters) {
      const want = solutions.parsed[n];
      const strings = QUICK_SOLUTIONS[n];
      assert.equal(strings.length, want.length, `roster ${n}: solution count`);
      strings.forEach((s, i) => {
        const got = parseSpec(s);
        assert.notEqual(got, null, `roster ${n} entry ${i} failed to parse`);
        assert.deepEqual(got.map((p) => [p[0], p[1]]), want[i],
          `roster ${n} entry ${i}: ${s}`);
      });
    }
  });

  it('counts tables the way GetQuickSolution scans them, divider bug included', () => {
    for (const n of Object.keys(solutions.tables_used)) {
      QUICK_SOLUTIONS[n].forEach((s, i) => {
        assert.equal(quickTablesUsed(s), solutions.tables_used[n][i],
          `roster ${n} entry ${i}`);
      });
    }
  });

  it('reproduces the Jul 17 group headers from the curated entry', () => {
    const { roster, headers, spec } = solutions.jul17;
    assert.equal(spec, QUICK_SOLUTIONS[roster][0]);
    assert.deepEqual(parseSpec(spec), headers);
  });

  it('runs the enumerator identically for a table count the table does not cover', () => {
    const got = enumerateSolutions(40, 20).slice(0, MAX_SOLUTIONS_LISTED);
    const want = solutions.enumerated_40_20;
    assert.equal(got.length, want.length);
    got.forEach((s, i) => {
      assert.equal(s.free, want[i].free, `solution ${i} tables free`);
      assert.equal(s.rating, want[i].rating, `solution ${i} rating`);
      assert.equal(s.eff, want[i].eff, `solution ${i} efficiency (integer division)`);
      assert.equal(s.shares, want[i].shares, `solution ${i} shares`);
      assert.equal(s.cfg, want[i].cfg, `solution ${i} configuration`);
    });
  });

  it('carries the deliberate idling the curated table prefers', () => {
    // ADR 0001's worked example: at these seven rosters the curated table leaves
    // tables idle rather than take the enumerator's fewest-idle-first answer. Both
    // rankings ship, unreconciled, exactly as the C# has them.
    const idle = [];
    for (const n of Object.keys(QUICK_SOLUTIONS).map(Number).sort((a, b) => a - b)) {
      for (const s of QUICK_SOLUTIONS[n]) {
        const used = parseSpec(s).reduce((a, p) => a + p[1], 0);
        if (used < 20) idle.push(n);
      }
    }
    assert.deepEqual([...new Set(idle)], [47, 48, 49, 50, 51, 54, 55]);
  });

  it('has no catalogue form giving a 5-player group one table (why F9 is deferred)', () => {
    assert.equal(DISTRIBUTIONS.some(([, p, t]) => p === 5 && t === 1), false);
  });
});

describe('partition -- seeding, the slice, and promotion', () => {
  const seats = Object.entries(partition.labels).map(([id, [last, first]]) => ({
    userId: Number(id), lastName: last, firstName: first, rating: null,
  }));

  it('slices the seed order into the solution sizes exactly as the oracle does', () => {
    // The oracle's seed_order already encodes rating-desc then name_key, so slicing it
    // is the assertion; drawRoster is checked separately below on synthetic ratings.
    const roster = partition.seed_order.map((id) => ({ userId: id }));
    assert.deepEqual(sliceInto(roster, partition.sizes), partition.pre_promotion);
  });

  /**
   * Session 6 turned this from a CHARACTERISATION into a CONFORMANCE test.
   *
   * It used to assert only that `actual` differed from `pre_promotion` by four moved
   * seats -- true of the recorded data whether or not any code existed, and it stayed
   * true for three sessions while `draw.js` had no promotion algorithm at all. Now
   * `promoteAllGroups` is run and its output is compared with the oracle's.
   *
   * **The ratings here are synthetic and that is sound, with one stated limit.** The
   * fixture carries `seed_order` (the real rating-descending order), `labels`, the two
   * `promoted` ids and the resulting `actual` -- but no ratings, because the anonymiser
   * emits only what it can prove faithful. A strictly descending sequence over
   * `seed_order` reproduces every ORDERING decision the real ratings make, because
   * groups are contiguous slices of that order: the lowest-rated member of a group is
   * its last seed under both. What it cannot exercise is the GAP ARITHMETIC, since no
   * two synthetic ratings are 150 apart. That branch never fired in the real session
   * either -- both flagged players were promoted, which is why `promoted` has exactly
   * two entries and four seats moved -- so it has **no oracle**, and it is covered by
   * the synthetic cases below instead.
   */
  it('reproduces the oracle’s promotion exactly, not just its shape', () => {
    const players = partition.seed_order.map((id, i) => {
      const [last, first] = partition.labels[String(id)];
      return {
        userId: id, lastName: last, firstName: first,
        rating: 2400 - i,                        // strictly descending; see above
        toBePromoted: partition.promoted.includes(id),
      };
    });

    const result = promoteAllGroups(partition.pre_promotion, players,
      partition.promotion_gap);

    assert.deepEqual(result.groups, partition.actual,
      'the promoted groups must equal the session the club actually played');
    assert.deepEqual(result.promoted.slice().sort(), partition.promoted.slice().sort());
  });

  it('never changes a group size — promotion is strictly one-in-one-out', () => {
    const pre = partition.pre_promotion;
    const actual = partition.actual;
    assert.equal(pre.flat().length, actual.flat().length);
    assert.deepEqual(pre.map((g) => g.length), actual.map((g) => g.length));
  });

  it('moves four seats in the reference session: two up and two down', () => {
    const moved = [];
    partition.actual.forEach((g, gi) => {
      const before = new Set(partition.pre_promotion[gi]);
      for (const id of g) if (!before.has(id)) moved.push([id, gi]);
    });
    assert.equal(moved.length, 4);
  });

  it('orders the seed list by rating then the one collation rule', () => {
    // Synthetic names only, on the same Surname/Given shape the anonymiser emits.
    // This repo is public; no real member name belongs in a hand-written test either.
    const players = [
      { userId: 3, lastName: 'surnameBB', firstName: 'GivenAA', rating: 1500 },
      { userId: 1, lastName: 'SurnameBB', firstName: 'GivenAA', rating: 1500 },
      { userId: 2, lastName: 'SurnameAA', firstName: 'GivenZZ', rating: 1500 },
      { userId: 4, lastName: 'SurnameZZ', firstName: 'GivenAA', rating: 1900 },
    ];
    // rating first; then case-INSENSITIVE surname, so 'surnameBB' and 'SurnameBB'
    // collate together rather than splitting on the capital; then users.id.
    assert.deepEqual(drawRoster(players).map((p) => p.userId), [4, 2, 1, 3]);
  });

  it('is a total order -- identical names still order deterministically', () => {
    // The port permits two members with identical names: a duplicate warns, never
    // blocks. Without users.id they would reintroduce exactly the non-determinism
    // ticket 08's comparator exists to remove. The reference roster carries a real
    // near-duplicate pair that motivates this; it is not named here.
    const a = nameKey('SurnameQQ', 'GivenQQ', 101104);
    const b = nameKey('SurnameQQ', 'GivenQQ', 100123);
    assert.notEqual(compareNameKeys(a, b), 0);
    assert.equal(compareNameKeys(b, a) < 0, true, 'lowest users.id first');
  });

  it('the synthetic labels reproduce the real ordering by construction', () => {
    // Ticket 24 Q5: labels are rank-assigned in real name_key order, so sorting them
    // lexicographically must give the oracle's seed order for any rating tie.
    const labelled = partition.seed_order.map((id) => ({
      userId: id, label: partition.labels[String(id)],
    }));
    assert.equal(labelled.every((p) => Array.isArray(p.label)), true,
      'every seat drawn this session has a label');
  });
});

describe('draw() end to end', () => {
  it('produces the Jul 17 partition from a roster and a table count', () => {
    const roster = partition.seed_order.map((id, i) => ({
      userId: id, lastName: partition.labels[String(id)][0],
      firstName: partition.labels[String(id)][1], rating: 10000 - i,
    }));
    const result = draw(roster, 20);
    assert.equal(result.spec, solutions.jul17.spec);
    assert.deepEqual(result.sizes, partition.sizes);
    assert.deepEqual(result.groups, partition.pre_promotion);
  });

  it('falls back to the enumerator when the table count is not 20', () => {
    const roster = partition.seed_order.map((id, i) => ({
      userId: id, lastName: 'X', firstName: 'Y', rating: 10000 - i,
    }));
    const result = draw(roster, 19);
    assert.notEqual(result, null, '65 players is solvable at 19 tables');
    assert.equal(result.sizes.reduce((a, b) => a + b, 0), 65);
  });

  /**
   * The operator-typed solution, `DrawListCode.cs:157-176`. `specOverride` is what makes
   * it reachable: it goes in at index 0 of the tab's list, so from that point on the
   * index no longer means to the tab what it means to the enumerator.
   */
  it('draws from a typed spec, bypassing both ranked lists', () => {
    const roster = partition.seed_order.map((id, i) => ({
      userId: id, lastName: 'X', firstName: 'Y', rating: 10000 - i,
    }));
    // Ten groups of five plus three of five... 65 as 13 fives, which the curated table
    // for 65 does not offer and the enumerator does not rank first.
    const spec = Array(13).fill('5').join(', ');
    const result = draw(roster, 20, 0, spec);
    assert.deepEqual(result.sizes, Array(13).fill(5));
    assert.notEqual(result.spec, solutions.jul17.spec,
      'the override must beat the curated table, not agree with it by accident');
    assert.equal(result.groups.flat().length, 65, 'every player is still seated once');
  });

  it('ignores solutionIndex entirely when a spec is given', () => {
    const roster = partition.seed_order.map((id, i) => ({
      userId: id, lastName: 'X', firstName: 'Y', rating: 10000 - i,
    }));
    const spec = Array(13).fill('5').join(', ');
    assert.deepEqual(draw(roster, 20, 0, spec).groups,
                     draw(roster, 20, 7, spec).groups);
  });

  it('leaves the index path untouched — the oracle still runs through it', () => {
    const roster = partition.seed_order.map((id, i) => ({
      userId: id, lastName: partition.labels[String(id)][0],
      firstName: partition.labels[String(id)][1], rating: 10000 - i,
    }));
    assert.equal(draw(roster, 20, 0, null).spec, solutions.jul17.spec);
  });
});

/**
 * `validateSpec` — the parse plus the roster check legacy applies on top of it
 * (`TableAssignment.cs:485-497`). A spec that parses is still refused when its players do
 * not total the roster, and the port must refuse it for the same reason.
 */
describe('validateSpec — the operator typed it', () => {
  it('accepts a spec whose players total the roster', () => {
    const { pairs, error } = validateSpec('6², (5, 5)³, 7²', 23);
    assert.equal(error, null);
    assert.deepEqual(pairs, parseSpec('6², (5, 5)³, 7²'));
  });

  it('refuses a spec that parses but does not total the roster', () => {
    const { pairs, error } = validateSpec('6², (5, 5)³, 7²', 65);
    assert.equal(pairs, null);
    assert.match(error, /\(23\)/, 'names what was specified');
    assert.match(error, /\(65\)/, 'and what the roster holds');
  });

  it('refuses a blank line, as the C# does by name', () => {
    assert.match(validateSpec('   ', 10).error, /Blank specification/);
  });

  it('reports WHERE a bad string went wrong, 1-based as the C# reports it', () => {
    const { pairs, error } = validateSpec('6², ))(', 10);
    assert.equal(pairs, null);
    assert.match(error, /position 4/, 'whitespace is stripped before positions are counted');
  });

  it('accepts the trailing comma the C# accepts', () => {
    // State 8 at end-of-string records and stops; `TableDistribution.cs:667` only fires
    // for states 1 and 8, and `success` is already true from the last record.
    assert.deepEqual(parseSpec('6²,'), [[6, 2]]);
  });

  it('parseSpec keeps its bare pairs-or-null contract', () => {
    assert.equal(parseSpec('))('), null);
    assert.deepEqual(parseSpec('6²'), [[6, 2]]);
  });
});

/**
 * The promotion branches the reference session never exercised.
 *
 * `verify_edge_cases.py`'s disclaimer applies: no real session has produced these, so
 * there is **no oracle** and the expectations below are read off the C# rather than off
 * a recorded outcome. They are here because the alternative -- testing only the path the
 * club happened to walk -- is what let `draw.js` ship for three sessions with no
 * promotion algorithm and a green suite.
 */
describe('promotion, the branches with no oracle', () => {
  // Rating-descending within each group, as `draw()` returns them.
  const person = (id, rating, flag = false) => ({
    userId: id, lastName: 'S' + id, firstName: 'G' + id, rating, toBePromoted: flag,
  });

  it('promotes nobody out of group 1 — it has no group above it', () => {
    const players = [person(1, 2000, true), person(2, 1900), person(3, 1800), person(4, 1700)];
    const { groups, promoted } = promoteAllGroups([[1, 2], [3, 4]], players);
    assert.deepEqual(promoted, []);
    assert.deepEqual(groups, [[1, 2], [3, 4]]);
  });

  it('measures the gap against the SECOND-lowest, because the lowest is about to leave', () => {
    // Group.cs:262. The receiving group is 2000 / 1900; the candidate is 1780.
    // Against the LOWEST (1900) the gap is 120 and the promotion would stand.
    // Against the SECOND-lowest (2000) it is 220 and the promotion is refused.
    // Getting this wrong by one rank looks entirely plausible in every group.
    const players = [person(1, 2000), person(2, 1900), person(3, 1780, true), person(4, 1700)];
    const { groups, promoted } = promoteAllGroups([[1, 2], [3, 4]], players, 150);
    assert.deepEqual(promoted, [], 'refused: 1780 < 2000 - 150');
    assert.deepEqual(groups, [[1, 2], [3, 4]], 'a refused candidate goes straight back down');
  });

  it('promotes when the gap allows it, ejecting the lowest', () => {
    const players = [person(1, 2000), person(2, 1900), person(3, 1880, true), person(4, 1700)];
    const { groups, promoted } = promoteAllGroups([[1, 2], [3, 4]], players, 150);
    assert.deepEqual(promoted, [3]);
    assert.deepEqual(groups, [[1, 3], [2, 4]], 'one in, one out, sizes unchanged');
  });

  /**
   * **Two promotions into the SAME group.** The regression that four archived nights
   * could not see and the fifth could.
   *
   * `promoteInto` walks its queue, and `adjustLowestRankings` skips a player only while
   * `toBePromoted` is set. The code used to clear that flag on promotion, citing
   * `Group.cs` Note 3 -- which says the opposite: the earlier `&& !player.NowPromoted`
   * was removed *because* "Now-Promoted players are a subset of players ToBePromoted
   * (this logic must be changed if ever that condition is not fulfilled)". Clearing it
   * broke the subset, so the second candidate's `adjustLowestRankings` found the player
   * the first candidate had just promoted sitting at the bottom of the group, and
   * ejected them.
   *
   * The outcome was worse than a swap: `promoted` still reported BOTH ids while one of
   * them was seated in the lower group, so `rr_group_players.promoted` would have
   * disagreed with the seating it was written beside.
   *
   * `Jul 17` sends its two promotions to groups 1 and 8, `Aug 07` to 8 and 9, `Nov 21`
   * to 2, 4 and 5, and `Nov 14` promotes nobody -- so none of them collide, and 258
   * tests plus a full session replay all passed. `2025Mar21` sends both to group 1.
   */
  it('promotes two candidates into one group without ejecting the first', () => {
    const players = [
      person(1, 2000), person(2, 1990), person(3, 1980),
      person(4, 1970), person(5, 1960), person(6, 1950),
      person(7, 1940, true), person(8, 1930, true), person(9, 1920),
      person(10, 1910), person(11, 1900), person(12, 1890),
    ];
    const { groups, promoted } = promoteAllGroups(
      [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]], players, 150,
    );
    assert.deepEqual(promoted, [7, 8]);
    assert.deepEqual(groups, [[1, 2, 3, 4, 7, 8], [5, 6, 9, 10, 11, 12]],
      'both promoted seats stay up; the two ejected seats go down');
    // The invariant the bug violated: every id `promoted` reports is seated in a group
    // strictly above the one it was drawn into.
    for (const id of promoted) {
      assert.ok(groups[0].includes(id), `${id} is reported promoted and must be seated up`);
    }
  });

  it('caps candidates at three, and a fourth simply stays put', () => {
    // DrawListCode.cs:325. FindPlayersToPromote counts every flagged player but adds
    // only the first three to the list, so the fourth is neither promoted nor demoted.
    const players = [
      person(1, 2000), person(2, 1990), person(3, 1980), person(4, 1970),
      person(5, 1960, true), person(6, 1950, true), person(7, 1940, true), person(8, 1930, true),
    ];
    const { groups, promoted } = promoteAllGroups([[1, 2, 3, 4], [5, 6, 7, 8]], players, 150);
    assert.equal(promoted.length, MAX_PROMOTION_CANDIDATES);
    assert.ok(!promoted.includes(8), 'the fourth flagged player is never offered');
    assert.deepEqual(groups.map((g) => g.length), [4, 4]);
  });

  it('leaves the eight untouched when nobody is flagged', () => {
    const players = [person(1, 2000), person(2, 1900), person(3, 1800), person(4, 1700)];
    const { groups, promoted } = promoteAllGroups([[1, 2], [3, 4]], players);
    assert.deepEqual(promoted, []);
    assert.deepEqual(groups, [[1, 2], [3, 4]]);
  });

  it('uses the constant the file says the file uses', () => {
    assert.equal(REJECT_PROMOTION_MAX_GAP, 150);   // Form1.cs:57, read at FileIO.cs:599
  });
});

describe('adjustLowestRankings — Group.cs:169-207', () => {
  const person = (id, rating, last, flag = false) => ({
    userId: id, lastName: last, firstName: 'G', rating, toBePromoted: flag,
  });
  const index = (list) => Object.fromEntries(list.map((p) => [p.userId, { ...p }]));

  it('on a rating tie the EARLIER index keeps the lowest slot', () => {
    // The comparison at :195 is a strict `<`. The list is rating-descending with names
    // ascending, so the earlier index is the alphabetically earlier name -- and of two
    // equally-rated players at the bottom, that is the one a promotion ejects.
    const byId = index([person(1, 2000, 'A'), person(2, 1500, 'B'), person(3, 1500, 'C')]);
    const { lowest, secondLowest } = adjustLowestRankings([1, 2, 3], byId);
    assert.equal(lowest, 2, 'the earlier of the two 1500s');
    assert.equal(secondLowest, 3);
  });

  it('lets secondLowest hold the SAME rating as lowest', () => {
    // Which means the gap test measures against that equal value -- docs/03 7.3.
    const byId = index([person(1, 2000, 'A'), person(2, 1500, 'B'), person(3, 1500, 'C')]);
    const { lowest, secondLowest } = adjustLowestRankings([1, 2, 3], byId);
    assert.equal(byId[lowest].rating, byId[secondLowest].rating);
  });

  it('skips anyone still flagged for promotion', () => {
    const byId = index([person(1, 2000, 'A'), person(2, 1600, 'B'), person(3, 1200, 'C', true)]);
    const { lowest } = adjustLowestRankings([1, 2, 3], byId);
    assert.equal(lowest, 2, 'the flagged 1200 is not ejectable');
  });

  it('returns nulls when nothing is eligible', () => {
    const byId = index([person(1, 2000, 'A', true)]);
    assert.deepEqual(adjustLowestRankings([1], byId), { lowest: null, secondLowest: null });
  });

  it('returns a null secondLowest for a single eligible player', () => {
    const byId = index([person(1, 2000, 'A')]);
    assert.deepEqual(adjustLowestRankings([1], byId), { lowest: 1, secondLowest: null });
  });
});

describe('assignSeeds — DrawListCode.cs:342-372', () => {
  it('is the 1-based index in the already rating-sorted group', () => {
    assert.deepEqual(assignSeeds([90, 42, 7]), [
      { userId: 90, seed: 1 }, { userId: 42, seed: 2 }, { userId: 7, seed: 3 },
    ]);
  });

  it('produces exactly 1..n, which is what POST /rr/draw validates', () => {
    const seeds = assignSeeds(partition.actual[0]).map((s) => s.seed);
    assert.deepEqual(seeds, partition.actual[0].map((_, i) => i + 1));
  });
});
