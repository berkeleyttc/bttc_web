/**
 * The two printed artifacts: the score sheet and the floor map.
 *
 * Ticket 18 cut the print run from seven artifacts to two and dropped the other five;
 * ticket 09 decided the sheet is HTML/CSS printed from Chrome at US Letter, not the
 * legacy JPEGs. This module is the *composition* half -- what goes on the page -- and
 * `print.css` is the *geometry* half. Between them they replace `PrintHandler2.cs`,
 * `PrintHandler3.cs` and `TableMapping.cs`'s GDI+ drawing.
 *
 * **Zero declared divergences across the whole printed surface** (ticket 18). First-up
 * bolding was offered for the sheet and declined precisely to keep it at one artifact
 * and no divergence, so nothing here may add a mark the paper does not carry.
 *
 * A native ES module with no dependency on ENV, bttc-utils.js, window or fetch, so
 * `node --test` and the browser run the same bytes. It imports the constants rather
 * than restating them -- `MATCH_ORDER` and `assignTableLabels` live in `play-order.js`
 * and have a Python counterpart in `bttc_api/roundrobin/play_order.py`; a third copy
 * here is exactly the drift `verify_play_order.py` existed to catch.
 *
 * **The two run lists are deliberately unreconciled.** This file uses
 * `PRINT_FRONT_RUN_TOP_TO_BOTTOM` -- `CalculateTableLocationsInMap`, the *printed*
 * ordering, confirmed element for element against `table-map-08-18-2026.jpeg`. The
 * published brackets page uses `WEB_MAPPING_983` instead, and they transpose ordinals
 * 2 and 3 (`#55`). Ticket 18 put both unifications and declined them: the case where
 * they differ has not occurred in 37 published sessions over nine months. Do not tidy
 * them into one constant.
 */

import {
  MATCH_ORDER, PRINT_FRONT_RUN_TOP_TO_BOTTOM, TABLES_AVAILABLE, assignTableLabels,
  matchPairs,
} from './play-order.js';

/** docs/10 2.5 -- the thumbnail is 3 well / 8 front / 9 back, top to bottom. */
export const MINI_MAP_RUNS = Object.freeze(['well', 'front', 'back']);

/** TableMapping.cs:174, :177, :190-213. Hardcoded 8/9/3 and it ignores the selected
 *  configuration -- suspected bug `#10`, shipped live and now measured rather than
 *  feared: 37 of 37 published sessions ran shape (3, 8, 9). */
export const PRINT_FRONT_RUN_COUNT = 8;
export const PRINT_BACK_RUN_MAX = 9;
export const PRINT_WELL_MAX = 3;

/** Declarations.cs:332 -- OpenTableLabel. */
export const OPEN_TABLE_LABEL = 'open';

/**
 * Player.FullNameTrunc, Player.cs:1461-1471.
 *
 * Latent on every fixture the project owns: the longest real names are 17 and 18
 * characters against a threshold of 20.
 */
export function fullNameTrunc(fullName) {
  return fullName.length > 20 ? `${fullName.slice(0, 18)}..` : fullName;
}

/** Player.cs:1473-1480 -- First + " " + Last[0]. The play-order column uses this. */
export function firstNameLastInitial(player) {
  return `${player.first} ${player.last[0]}`;
}

/**
 * docs/10 2.2 -- the score grid's closed forms.
 *
 * Rows are `N-1`; row `k` has `N-1-k` cells; cell `(k, j)` is the match between
 * player `k+1` and player `k+j+2`. That staircase is what gives a player all of their
 * own matches in one row, which is why ticket 09 declined the play-order-sequence
 * variant even though it makes recording sequential.
 */
export function staircaseCells(n) {
  const rows = [];
  for (let k = 0; k < n - 1; k += 1) {
    const row = [];
    for (let j = 0; j < n - 1 - k; j += 1) row.push([k + 1, k + j + 2]);
    rows.push(row);
  }
  return rows;
}

/** Every cell in the staircase is a distinct unordered pair, `N(N-1)/2` of them. */
export function staircasePairCount(n) {
  return (n * (n - 1)) / 2;
}

/**
 * docs/10 2.4 -- the play-order column, in MatchOrderN sequence.
 *
 * Returns `[{ lhs, vs, rhs }]`. Unlike the *published* bracket page this carries **no
 * bolding**: `PrintMatchPlayOrder3()` draws every pairing in the same weight
 * (`PrintHandler3.cs:224-256`), and ticket 18 Q8 dissolved `#11` by declining to add
 * it. Print and web stay deliberately different.
 */
export function playOrderLines(players) {
  const n = players.length;
  if (!MATCH_ORDER[n]) throw new Error(`no play order for a group of ${n}`);
  return matchPairs(n).map(([a, b]) => ({
    lhs: `${firstNameLastInitial(players[a])}(${a + 1})`,
    vs: 'vs',
    rhs: `(${b + 1})${firstNameLastInitial(players[b])}`,
  }));
}

/** docs/10 2.1 -- a single leading space when the rating is under 1000. */
export function padRating(rating) {
  return (rating < 1000 ? ' ' : '') + rating;
}

/** docs/10 2.1 -- "1 Table", "2 Tables", "2 Tables + 1 shared table". */
export function tableText(n) {
  const whole = Math.trunc(n);
  return `${whole} Table${whole === 1 ? '' : 's'}${n % 1 ? ' + 1 shared table' : ''}`;
}

/**
 * docs/10 2.5 -- the mini map's caption.
 *
 * The default arm carries an embedded newline that GDI+ may clip, because the layout
 * rectangle is measured as one line (`#39`). CSS renders it in full under
 * `white-space: pre-line`, verified on the prototype's page 3, so the bug is a
 * non-issue here -- ticket 18 owns the disposition and it sits inside F10.
 */
export function captionFor(n) {
  if (n === 1) return 'your group is using this table:';
  if (n === 2) return 'your group is using these two tables:';
  if (n === 3) return 'your group is using these three tables:';
  return 'your group is using these table(s):\n  shared table is in gray';
}

/**
 * The printed page: three **columns**, top to bottom, in 0-based assignment ordinals.
 *
 * docs/04 5.3. The runs differ only in x -- the well at `first_row_x / 3`, the front run
 * at `first_row_x`, the back run at `second_row_x` -- so the page is three columns of
 * 3, 8 and 9 boxes, not three rows.
 *
 * The front run is deliberately out of numeric order. Its eight y-offsets are
 * `4,5,2,3,6,7,1,0` in units of `jump` for ordinals 0..7 (TableMapping.cs:142-172), so
 * reading down the column gives `7,6,2,3,0,1,4,5` -- which is
 * `PRINT_FRONT_RUN_TOP_TO_BOTTOM`, confirmed **element for element** against
 * `table-map-08-18-2026.jpeg`. The well fills *bottom-upward*: table 18 sits at
 * `4 x jump` and each later one is a jump higher, so reading down gives 19, 18, 17.
 * The photograph confirms that too -- group 9 straddles the back run's last table and
 * the well's lowest box, which only works bottom-upward.
 */
export function printedColumns(tablesAvailable = TABLES_AVAILABLE) {
  const front = PRINT_FRONT_RUN_TOP_TO_BOTTOM.slice();
  const backCount = Math.min(PRINT_BACK_RUN_MAX,
                             Math.max(0, tablesAvailable - PRINT_FRONT_RUN_COUNT));
  const back = [];
  for (let i = 0; i < backCount; i += 1) back.push(PRINT_FRONT_RUN_COUNT + i);
  const firstWell = PRINT_FRONT_RUN_COUNT + backCount;
  const wellCount = Math.min(PRINT_WELL_MAX, Math.max(0, tablesAvailable - firstWell));
  const well = [];
  for (let i = wellCount - 1; i >= 0; i -= 1) well.push(firstWell + i);
  return [
    { name: 'well', order: well },
    { name: 'front', order: front },
    { name: 'back', order: back },
  ];
}

/**
 * The thumbnail: the same three runs as **rows**, left to right.
 *
 * `DrawMiniTableMap` clones the floor-map bitmap and applies
 * `RotateFlip(Rotate90FlipNone)`, a 90-degree clockwise turn. That maps original-left to
 * new-top, so the leftmost column (the well) becomes the top row; and it maps
 * original-top to new-**right**, so each column read top-to-bottom becomes a row read
 * right-to-left. Every run is therefore the printed column reversed, and the rows stack
 * well / front / back -- the 3 / 8 / 9 the Jul 31 photograph shows.
 *
 * The front row comes out `5,4,1,0,3,2,6,7`, which is **not** `WEB_MAPPING_983`'s
 * `5,4,1,0,2,3,6,7`. That single transposition at positions 4 and 5 is `#55`, and it is
 * the whole of the printed-versus-web disagreement. Ticket 18 measured it latent across
 * 37 sessions and declined to unify. Leave it.
 */
export function miniMapRuns(tablesAvailable = TABLES_AVAILABLE) {
  return printedColumns(tablesAvailable).map(({ name, order }) => (
    { name, order: order.slice().reverse() }));
}

/**
 * One group's mini map: every table, marked black if the group owns it and grey if it
 * shares it.
 *
 * docs/10 4 and docs/04 5.5: the embedded bitmap the score sheets clone shows group
 * numbers **blank** and labels only the `"open"` tables. A player reading a score sheet
 * sees the room shape and which tables are theirs, not the full assignment.
 */
export function miniMapForGroup(groupIndex, groupTables, numClubTables = TABLES_AVAILABLE,
                                tablesAvailable = TABLES_AVAILABLE) {
  const { myTables, labels } = assignTableLabels(groupTables, numClubTables,
                                                 tablesAvailable);
  const mine = new Set(myTables[groupIndex] ?? []);
  return miniMapRuns(tablesAvailable).map(({ name, order }) => ({
    name,
    tables: order.map((idx) => ({
      index: idx,
      label: labels[idx] === OPEN_TABLE_LABEL ? OPEN_TABLE_LABEL : '',
      mine: mine.has(idx) && !labels[idx].includes('/'),
      shared: mine.has(idx) && labels[idx].includes('/'),
    })),
  }));
}

/**
 * The full-page printed floor map: three columns, every table labelled with its
 * **group** number.
 *
 * docs/10 4.2: a share prints as one ordinary white rectangle labelled `"g1/g2"` -- no
 * shading, no split line -- and the only visual consequence is the label font dropping
 * from 28pt to 23pt past 4 characters, which is exactly why that branch exists. An open
 * table is the same white rectangle labelled `"open"`, and it is the one label **never
 * rotated** even when the operator ticks the rotate box (TableMapping.cs:562-563).
 */
export function floorMapColumns(groupTables, numClubTables = TABLES_AVAILABLE,
                                tablesAvailable = TABLES_AVAILABLE) {
  const { labels } = assignTableLabels(groupTables, numClubTables, tablesAvailable);
  return printedColumns(tablesAvailable).map(({ name, order }) => ({
    name,
    tables: order.map((idx) => ({
      index: idx,
      label: labels[idx] || OPEN_TABLE_LABEL,
      shared: labels[idx].includes('/'),
      long: (labels[idx] || OPEN_TABLE_LABEL).length > 4,
    })),
  }));
}

/**
 * `LayoutTableMapHeader()`, TableMapping.cs:373-410 -- the printed map's header block.
 *
 * `tables_used/` is omitted when no solution is selected (Note 1 at :370-372), and the
 * solution string has all commas stripped (:379-381).
 */
export function floorMapHeader({ dateStr, groups, players, tablesUsed, clubTables,
                                solution }) {
  const lines = [
    'Berkeley Table Tennis Club',
    dateStr,
    `${groups} groups, ${players} players`,
  ];
  lines.push(solution ? `${tablesUsed}/${clubTables} tables` : `${clubTables} tables`);
  if (solution) {
    lines.push('selected solution =');
    lines.push(`  - ${solution.split('»')[0].replace(/,/g, '').trim()}`);
  }
  return lines;
}

/** Everything one printed score sheet needs, from a group and the night's allocation. */
export function scoreSheet({ groupIndex, date, players, groupTables,
                            numClubTables = TABLES_AVAILABLE }) {
  const tables = groupTables[groupIndex];
  return {
    group: groupIndex + 1,
    date,
    players,
    tables,
    tableText: tableText(tables),
    grid: staircaseCells(players.length),
    playOrder: playOrderLines(players),
    caption: captionFor(tables),
    map: miniMapForGroup(groupIndex, groupTables, numClubTables),
  };
}
