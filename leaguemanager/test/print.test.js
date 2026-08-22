/**
 * `print.js` — the two printed artifacts' composition.
 *
 * No new oracle is needed here. Everything this file depends on is already bound by
 * `fixtures/play-order.json`, emitted by `bttc_api/tests/oracles/oracle_play_order.py`:
 * `MATCH_ORDER`, `PRINT_FRONT_RUN_TOP_TO_BOTTOM`, `WEB_MAPPING_983` and
 * `assignTableLabels`. What is left to check is the *geometry that hangs off them* — the
 * staircase's closed forms, the rotation that turns the printed page into the thumbnail,
 * and the three caption strings.
 *
 * The one piece of real evidence the project owns for the sheet is
 * `printed-scoresheet-2026Jul31-group6.jpeg`, a 7-player group. Its 21 play-order lines
 * are checked element for element below.
 *
 * Run: `node --test 'leaguemanager/test/*.test.js'`
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { PRINT_FRONT_RUN_TOP_TO_BOTTOM, WEB_MAPPING_983 } from '../play-order.js';
import {
  captionFor, firstNameLastInitial, floorMapColumns, floorMapHeader, fullNameTrunc,
  miniMapForGroup, miniMapRuns, padRating, playOrderLines, printedColumns,
  staircaseCells, staircasePairCount, tableText,
} from '../print.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fx = JSON.parse(readFileSync(here('./fixtures/play-order.json'), 'utf8'));

/** Ten groups of two whole tables — the shape all 37 published sessions ran. */
const WHOLE = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2];

/** docs/04 2.2's worked example: 71 players, four shared tables, two left open. */
const SHARED = [2.5, 2.5, 2, 2, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];

/**
 * A 7-player group in the Jul 31 Group #6 shape. The **seat count and the ratings**
 * come from the photograph; the names are synthetic, in `tests/oracles/anonymize.py`'s
 * rank-assigned shape, because this repo is public and the real seats are club
 * members. Nothing checked below depends on the names: the play-order assertion reads
 * seed numbers, which is what the photograph actually pins.
 */
const JUL31_G6 = [
  { rating: 853, first: 'Given A', last: 'Surname A' },
  { rating: 795, first: 'Given B', last: 'Surname B' },
  { rating: 792, first: 'Given C', last: 'Surname C' },
  { rating: 766, first: 'Given D', last: 'Surname D' },
  { rating: 739, first: 'Given E', last: 'Surname E' },
  { rating: 716, first: 'Given F', last: 'Surname F' },
  { rating: 696, first: 'Given G', last: 'Surname G' },
];

describe('the score grid — docs/10 2.2 closed forms', () => {
  it('is a staircase: N-1 rows, row k holding N-1-k cells', () => {
    for (const n of [5, 6, 7]) {
      const rows = staircaseCells(n);
      assert.equal(rows.length, n - 1);
      rows.forEach((row, k) => assert.equal(row.length, n - 1 - k));
    }
  });

  it('emits every unordered pair exactly once, N(N-1)/2 of them', () => {
    for (const n of [5, 6, 7]) {
      const cells = staircaseCells(n).flat();
      const keys = cells.map(([i, j]) => `${i}-${j}`);
      assert.equal(keys.length, staircasePairCount(n));
      assert.equal(new Set(keys).size, keys.length);
      assert.ok(cells.every(([i, j]) => i >= 1 && j <= n && i < j));
    }
  });

  it('gives each player all of their own matches in one row', () => {
    // The reason ticket 09 Q3a declined the play-order-sequence variant: numbering the
    // cells makes recording sequential but scatters a player's matches across the block.
    const rows = staircaseCells(7);
    rows.forEach((row, k) => {
      assert.ok(row.every(([i]) => i === k + 1), `row ${k} is not player ${k + 1}'s`);
    });
  });

  it('matches the photograph: 21 cells for a 7-player group', () => {
    assert.equal(staircaseCells(7).flat().length, 21);
    assert.equal(staircaseCells(6).flat().length, 15);
    assert.equal(staircaseCells(5).flat().length, 10);
  });
});

describe('the play-order column — docs/10 2.4', () => {
  it('matches the Jul 31 photograph element for element', () => {
    // The photograph's 21 lines, read off the paper. MatchOrder7 reproduces them exactly.
    const photo = '1-7 2-3 5-6 1-4 3-7 2-5 4-6 1-5 2-7 3-6 4-5 1-2 6-7 3-4 5-7 1-6 2-4 '
      + '3-5 4-7 1-3 2-6';
    const built = playOrderLines(JUL31_G6)
      .map(({ lhs, rhs }) => `${lhs.match(/\((\d)\)$/)[1]}-${rhs.match(/^\((\d)\)/)[1]}`)
      .join(' ');
    assert.equal(built, photo);
  });

  it('is exactly the fixture\'s MatchOrder, in order', () => {
    const flat = playOrderLines(JUL31_G6).flatMap(({ lhs, rhs }) => [
      Number(lhs.match(/\((\d)\)$/)[1]) - 1,
      Number(rhs.match(/^\((\d)\)/)[1]) - 1,
    ]);
    assert.deepEqual(flat, fx.match_order['7']);
  });

  it('names each side First + last initial, seed-numbered', () => {
    const [first] = playOrderLines(JUL31_G6);
    assert.equal(first.lhs, 'Given A S(1)');
    assert.equal(first.vs, 'vs');
    assert.equal(first.rhs, '(7)Given G S');
  });

  it('carries no bolding — ticket 18 Q8 declined it to keep the surface at zero '
     + 'declared divergences', () => {
    for (const line of playOrderLines(JUL31_G6)) {
      assert.deepEqual(Object.keys(line).sort(), ['lhs', 'rhs', 'vs']);
    }
  });

  it('refuses a group size with no MatchOrder', () => {
    assert.throws(() => playOrderLines(new Array(8).fill(JUL31_G6[0])), /group of 8/);
  });
});

describe('the text fragments — docs/10 2.1 and 2.5', () => {
  it('pads a sub-1000 rating with one leading space', () => {
    assert.equal(padRating(853), ' 853');
    assert.equal(padRating(1204), '1204');
    assert.equal(padRating(999), ' 999');
    assert.equal(padRating(1000), '1000');
  });

  it('writes the table count the way the sheet does', () => {
    assert.equal(tableText(1), '1 Table');
    assert.equal(tableText(2), '2 Tables');
    assert.equal(tableText(3), '3 Tables');
    assert.equal(tableText(1.5), '1 Table + 1 shared table');
    assert.equal(tableText(2.5), '2 Tables + 1 shared table');
  });

  it('captions the mini map, and the shared arm keeps its embedded newline', () => {
    assert.equal(captionFor(1), 'your group is using this table:');
    assert.equal(captionFor(2), 'your group is using these two tables:');
    assert.equal(captionFor(3), 'your group is using these three tables:');
    // `#39`: GDI+ may clip this because the layout rectangle is measured as one line.
    // CSS renders it in full under `white-space: pre-line`, so it is a non-issue here.
    assert.ok(captionFor(1.5).includes('\n'));
    assert.match(captionFor(1.5), /shared table is in gray/);
  });

  it('truncates a name past 20 characters, at 18 plus two dots', () => {
    assert.equal(fullNameTrunc('Given A Surname A'), 'Given A Surname A');
    assert.equal(fullNameTrunc('Twentycharacters Xyz'), 'Twentycharacters Xyz');
    assert.equal(fullNameTrunc('Twentycharacters Xyzw'), 'Twentycharacters X..');
    assert.equal(fullNameTrunc('Twentycharacters Xyzw').length, 20);
  });

  it('builds the printed map header, dropping tables-used with no solution', () => {
    const withSolution = floorMapHeader({
      dateStr: 'Friday, Aug 7, 2026', groups: 10, players: 64,
      tablesUsed: 20, clubTables: 20, solution: '6², 6² » something',
    });
    assert.deepEqual(withSolution, [
      'Berkeley Table Tennis Club', 'Friday, Aug 7, 2026', '10 groups, 64 players',
      '20/20 tables', 'selected solution =', '  - 6² 6²',
    ]);
    const without = floorMapHeader({
      dateStr: 'Friday, Aug 7, 2026', groups: 10, players: 64, clubTables: 20,
    });
    assert.equal(without.length, 4);
    assert.equal(without[3], '20 tables');
  });
});

describe('the floor map — the printed page is three columns', () => {
  it('is 3 well / 8 front / 9 back, the shape all 37 published sessions ran', () => {
    assert.deepEqual(printedColumns().map((c) => c.order.length), [3, 8, 9]);
    assert.deepEqual(WEB_MAPPING_983.map((r) => r.length), [3, 8, 9]);
  });

  it('reads the front run in the order the photograph confirmed', () => {
    const front = printedColumns().find((c) => c.name === 'front');
    assert.deepEqual(front.order, [...PRINT_FRONT_RUN_TOP_TO_BOTTOM]);
    assert.deepEqual(front.order, [7, 6, 2, 3, 0, 1, 4, 5]);
  });

  it('fills the well bottom-upward', () => {
    // Table 18 sits at 4 x jump and each later one is a jump higher, so reading down
    // gives 19, 18, 17. The photograph confirms it: group 9 straddles the back run's
    // last table and the well's lowest box, which only works bottom-upward.
    assert.deepEqual(printedColumns().find((c) => c.name === 'well').order, [19, 18, 17]);
  });

  it('runs the back column 8..16 ascending', () => {
    assert.deepEqual(printedColumns().find((c) => c.name === 'back').order,
      [8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('labels every box with a GROUP number, and the leftovers "open"', () => {
    const cols = floorMapColumns(WHOLE);
    const labels = cols.flatMap((c) => c.tables.map((t) => t.label));
    assert.equal(labels.length, 20);
    assert.equal(new Set(labels).size, 10, 'ten groups, two tables each');
    assert.ok(!labels.includes('open'), '20 tables for 10 groups of 2 leaves none open');

    const shared = floorMapColumns(SHARED);
    const flat = shared.flatMap((c) => c.tables);
    assert.equal(flat.filter((t) => t.label === 'open').length, 2);
    assert.deepEqual(flat.filter((t) => t.shared).map((t) => t.label).sort(),
      ['1/2', '5/6', '7/8', '9/10']);
    // TableMapping.cs:566-567 — the label drops from 28pt to 23pt only once the string
    // exceeds FOUR characters. "9/10" and "open" are exactly four, so this solution
    // triggers it nowhere; it takes a share numbered 10 or higher.
    assert.deepEqual(flat.filter((t) => t.long), []);
  });

  it('drops the label to 23pt only past four characters — TableMapping.cs:566-567', () => {
    // Eleven groups, the last two sharing, so the label reads "10/11" at five characters.
    const eleven = [2, 2, 2, 2, 2, 2, 2, 2, 2, 1.5, 1.5];
    const flat = floorMapColumns(eleven).flatMap((c) => c.tables);
    const long = flat.filter((t) => t.long).map((t) => t.label);
    assert.deepEqual(long, ['10/11']);
    assert.ok(flat.filter((t) => t.label === '9').every((t) => !t.long));
    assert.ok(flat.filter((t) => t.label === 'open').every((t) => !t.long),
      '"open" is exactly four characters, so it stays at 28pt');
  });
});

describe('the thumbnail — the printed page rotated 90 degrees clockwise', () => {
  it('is every printed column reversed', () => {
    const printed = printedColumns();
    miniMapRuns().forEach((run, i) => {
      assert.equal(run.name, printed[i].name);
      assert.deepEqual(run.order, [...printed[i].order].reverse());
    });
  });

  it('disagrees with the published page at exactly two positions — `#55`', () => {
    // Ticket 18 put both unifications and declined them. Unifying on the printed order
    // would move a conditional divergence onto ticket 16's byte-exact published page;
    // unifying on the web order would contradict the one printed map the project owns.
    // Neither buys anything observable: the case has not occurred in nine months.
    const front = miniMapRuns().find((r) => r.name === 'front').order;
    const web = WEB_MAPPING_983[1];
    const differ = front.map((v, i) => (v === web[i] ? null : i)).filter((v) => v !== null);
    assert.deepEqual(differ, [4, 5]);
    assert.deepEqual(front.slice(4, 6), [3, 2]);
    assert.deepEqual(web.slice(4, 6), [2, 3]);
  });

  it('marks group 6 on tables 11 and 12, where the photograph\'s black boxes sit', () => {
    // Derived, not chosen: AssignTableLabels walks TablesList from index 0, so at two
    // tables per group, group 6 (index 5) takes ordinals 10 and 11 — tables 11 and 12.
    // Under the rotation those land 6th and 7th of nine in the back run.
    const runs = miniMapForGroup(5, WHOLE);
    const back = runs.find((r) => r.name === 'back');
    const mineAt = back.tables.map((t, i) => (t.mine ? i : null)).filter((v) => v !== null);
    assert.deepEqual(mineAt, [5, 6]);
    assert.deepEqual(back.tables.filter((t) => t.mine).map((t) => t.index), [11, 10]);

    const marked = runs.flatMap((r) => r.tables).filter((t) => t.mine || t.shared);
    assert.equal(marked.length, 2, 'a group on two whole tables marks exactly two boxes');
  });

  it('shows blank labels except on open tables — docs/04 5.5', () => {
    // The embedded bitmap the score sheets clone labels ONLY the open tables. A player
    // reading a sheet sees the room shape and which tables are theirs, not the whole
    // assignment.
    const flat = miniMapForGroup(0, SHARED).flatMap((r) => r.tables);
    assert.equal(flat.filter((t) => t.label === 'open').length, 2);
    assert.ok(flat.filter((t) => t.label !== 'open').every((t) => t.label === ''));
  });

  it('marks a shared table grey and an owned one black', () => {
    // Group 1 takes ordinals 0 and 1 outright then shares ordinal 2 with group 2.
    const flat = miniMapForGroup(0, SHARED).flatMap((r) => r.tables);
    assert.deepEqual(flat.filter((t) => t.mine).map((t) => t.index).sort((a, b) => a - b),
      [0, 1]);
    assert.deepEqual(flat.filter((t) => t.shared).map((t) => t.index), [2]);
  });

  it('agrees with the oracle fixture on the whole Jul 17 assignment', () => {
    const flat = miniMapForGroup(0, fx.jul17.group_tables).flatMap((r) => r.tables);
    assert.equal(flat.length, 20);
    assert.deepEqual(flat.filter((t) => t.mine).map((t) => t.index).sort((a, b) => a - b),
      fx.jul17.my_tables[0]);
  });
});

describe('names', () => {
  it('is First + last initial — Player.cs:1473-1480', () => {
    assert.equal(firstNameLastInitial({ first: 'Given A', last: 'Surname A' }), 'Given A S');
    // A two-word given name keeps both words -- the split is on the LAST name only.
    assert.equal(firstNameLastInitial({ first: 'Given Bb', last: 'Surname B' }),
      'Given Bb S');
  });
});
