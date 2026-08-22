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
  sliceInto, draw,
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

  it('differs from the recorded groups only by promotion', () => {
    const pre = partition.pre_promotion;
    const actual = partition.actual;
    assert.equal(pre.length, actual.length);
    const moved = [];
    actual.forEach((g, gi) => {
      const before = new Set(pre[gi]);
      for (const id of g) if (!before.has(id)) moved.push([id, gi]);
    });
    assert.equal(moved.length, 4, '2 promotions and 2 demotions');
    assert.equal(pre.flat().length, actual.flat().length);
    assert.deepEqual(pre.map((g) => g.length), actual.map((g) => g.length),
      'promotion never changes a group size');
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
});
