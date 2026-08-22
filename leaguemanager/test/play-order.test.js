/**
 * play-order.js against the Python oracle.
 *
 * The fixture is emitted by `bttc_api/tests/oracles/oracle_play_order.py`, whose
 * constants were **transcribed from the C# once** and frozen (ticket 24 Q9). The
 * original script parsed them out of `Declarations.cs`, `TableMapping.cs`, `Form1.cs`
 * and `TableDistribution.cs` so it would fail on drift; that trick retires here,
 * because the C# is now dead code in a repo nobody commits to and the direction it
 * watched no longer moves.
 *
 * Run: `node --test leaguemanager/test/`
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  MATCH_ORDER, PRINT_FRONT_RUN_TOP_TO_BOTTOM, WEB_MAPPING_983, assignTableLabels,
  matchPairs,
} from '../play-order.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fx = JSON.parse(readFileSync(here('./fixtures/play-order.json'), 'utf8'));

describe('play order -- the three lookup tables', () => {
  it('matches the transcribed constants exactly', () => {
    for (const n of ['5', '6', '7']) {
      assert.deepEqual([...MATCH_ORDER[n]], fx.match_order[n], `MatchOrder${n}`);
    }
  });

  it('is every unordered pair exactly once', () => {
    for (const n of [5, 6, 7]) {
      const seen = matchPairs(n).map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`));
      assert.equal(seen.length, (n * (n - 1)) / 2);
      assert.equal(new Set(seen).size, seen.length, `MatchOrder${n} repeats a pair`);
      assert.equal(matchPairs(n).flat().every((v) => v >= 0 && v < n), true);
    }
  });

  it('never puts a player in two consecutive matches', () => {
    // A property of the constants. Nothing in the C# enforces or checks it, which is
    // exactly why it is asserted here.
    for (const n of [5, 6, 7]) {
      const ms = matchPairs(n);
      for (let i = 0; i < ms.length - 1; i += 1) {
        const overlap = ms[i].filter((p) => ms[i + 1].includes(p));
        assert.deepEqual(overlap, [], `MatchOrder${n} match ${i}/${i + 1}`);
      }
    }
  });

  it('gives every seat at least two matches of rest', () => {
    for (const n of [5, 6, 7]) {
      const ms = matchPairs(n);
      for (let p = 0; p < n; p += 1) {
        const idx = ms.map((m, i) => (m.includes(p) ? i : -1)).filter((i) => i >= 0);
        for (let k = 0; k < idx.length - 1; k += 1) {
          assert.equal(idx[k + 1] - idx[k] >= 2, true,
            `MatchOrder${n} seat ${p + 1} plays back to back`);
        }
      }
    }
  });
});

describe('the two floor-map run lists, deliberately unreconciled', () => {
  it('carries both, and they disagree at exactly two positions', () => {
    assert.deepEqual([...PRINT_FRONT_RUN_TOP_TO_BOTTOM], fx.print_front_run);
    assert.deepEqual(WEB_MAPPING_983.map((r) => [...r]), fx.web_mapping_983);

    const reversed = [...PRINT_FRONT_RUN_TOP_TO_BOTTOM].reverse();
    const webFront = fx.web_mapping_983.find((r) => r.includes(0));
    const diff = reversed
      .map((v, i) => (v !== webFront[i] ? i : -1)).filter((i) => i >= 0);
    // #55: ordinals 2 and 3 are transposed between the printed map and the web page.
    // Ticket 18 put the unification and declined it -- neither buys anything
    // observable, and 37 published sessions over nine months all look like this.
    assert.deepEqual(diff, [4, 5]);
    assert.deepEqual(reversed.slice(4, 6), [3, 2]);
    assert.deepEqual(webFront.slice(4, 6), [2, 3]);
  });

  it('has floor-plan shape (3, 8, 9)', () => {
    assert.deepEqual(WEB_MAPPING_983.map((r) => r.length), [3, 8, 9]);
  });
});

describe('AssignTableLabels', () => {
  it('reproduces the Jul 17 assignment exactly', () => {
    const { group_tables: tables, my_tables: wantTables, labels: wantLabels } = fx.jul17;
    const got = assignTableLabels(tables, 20);
    assert.deepEqual(got.myTables, wantTables);
    assert.deepEqual(got.labels, wantLabels);
    assert.equal(got.labels.includes('open'), false, 'all 20 tables consumed');
    assert.equal(got.labels.some((l) => l.includes('/')), false, 'no shares this night');
  });

  it('handles the shared-table arm -- NO_ORACLE, never observed in a real session', () => {
    // 0 shared tables in 37 published sessions over nine months. This proves the port
    // is self-consistent here, not that it is correct: no .bttc from a night with a
    // share has ever been archived, and a synthetic fixture would only test the port
    // against itself.
    const { group_tables: tables, my_tables: wantTables, labels: wantLabels } =
      fx.shared_no_oracle;
    const got = assignTableLabels(tables, 20);
    assert.deepEqual(got.myTables, wantTables);
    assert.deepEqual(got.labels, wantLabels);
    assert.equal(got.labels.filter((l) => l === 'open').length, 2);
    assert.deepEqual(
      got.labels.map((l, i) => (l.includes('/') ? i : -1)).filter((i) => i >= 0),
      [2, 10, 13, 16]);
  });

  it('refuses a table count outside [0.5, 3]', () => {
    assert.throws(() => assignTableLabels([4], 20), /unexpected table count/);
    assert.throws(() => assignTableLabels([0.25], 20), /unexpected table count/);
  });
});
