/**
 * The Printing tab -- mostly wiring, not authoring.
 *
 * `print.css` (523 lines) and `print.js` (18 exports) landed in session 3 with `#lm-app`
 * scoping and `--lm-sheet-*` prefixes already applied, `@page { size: letter; margin: 0 }`
 * and `print-color-adjust: exact` already in place, and 300 assertions behind them.
 * `print-preview.html:124-217` is the markup blueprint; this file renders the same
 * class contract from real data instead of the three synthetic groups the harness uses.
 *
 * **The tab prints two artifacts and no others** (ticket 18): the score sheet and the
 * floor map. Artifacts 3 (alphabetised roster list), 4 (unpaid + waitlist), 5 (payments
 * file), 6 (roster sheet) and 7 (announcements RTF) all left the print run. Genuine
 * capability loss is one sheet.
 *
 * **The design's approach dies with it.** `printScoreSheets`
 * (`League Manager.dc.html:977-1048`) builds a whole HTML document as a string, wraps it
 * in a `Blob` and `window.open`s it. Popup blockers break it outright; the object URL is
 * **never revoked** (unlike its sibling `exportResultsHtml`, which does revoke at
 * `:1260`); the generated markup carries hardcoded hexes and a bare `Archivo,
 * sans-serif` with no `@import`, so the print output silently diverges from the app's
 * own tokens; and player names are concatenated into HTML unescaped. Here the tab
 * renders a print region that is hidden on screen and revealed by `@media print`, and
 * the button is `window.print()`.
 *
 * **Two run lists ship unreconciled, on purpose.** The client's floor map and mini map
 * use `CalculateTableLocationsInMap`'s order; the published group page uses
 * `TableToWebPageMapping`'s. Ticket 18 put unifying them and declined, because neither
 * buys anything observable -- a sweep of all 37 published sessions found the same shape
 * and the same front run every time. **Do not tidy that into one constant**; F10 owns
 * the eventual reconciliation.
 *
 * One thing the operator has to be told once, and the runbook owns it: **Chrome's three
 * print-dialog defaults each damage a sheet** (ticket 09). Headers/footers on, "fit to
 * page" scaling, and background graphics off. The last is what
 * `print-color-adjust: exact` defends against; the other two are a one-time setup.
 */
const { computed, ref } = window.Vue;

import { session, drawCommitted, redrawBanner, ui } from '../store.js';
import {
  staircaseCells, playOrderLines, padRating, tableText, captionFor,
  miniMapForGroup, floorMapColumns, floorMapHeader,
} from '../print.js';

/** `print.js` speaks `{first, last, rating}`; the session speaks the wire shape. */
const toPrintPlayer = (p) => ({
  first: p.first_name, last: p.last_name, rating: p.rating_at_draw,
});

export const PrintingTab = {
  setup() {
    const selected = ref(null);          // null means "everything"

    const groupTables = computed(() => (session.settings
      ? (session.settings.group_table_counts || []) : []));

    const clubTables = computed(() => (session.settings
      ? session.settings.table_count : 20));

    const dateStr = computed(() => (session.event ? session.event.event_date : ''));

    const included = (key) => selected.value === null || selected.value.includes(key);

    function toggle(key) {
      if (selected.value === null) {
        // The first click means "only this one", which is what the design's tri-state
        // sentinel expresses. Building the list lazily keeps "all" honest when a new
        // group appears after a re-draw.
        selected.value = [key];
        return;
      }
      const i = selected.value.indexOf(key);
      if (i >= 0) selected.value.splice(i, 1);
      else selected.value.push(key);
    }

    const selectAll = () => { selected.value = null; };
    const selectNone = () => { selected.value = []; };

    /** Everything one printed sheet needs, computed once per render rather than ~6×. */
    const sheets = computed(() => session.groups
      .filter((g) => included('g' + g.ordinal))
      .map((g) => {
        const players = g.players.slice()
          .sort((a, b) => a.seed - b.seed)
          .map(toPrintPlayer);
        const idx = g.ordinal - 1;
        const tables = groupTables.value[idx];
        return {
          ordinal: g.ordinal,
          players,
          tables,
          tableText: tableText(tables),
          rows: staircaseCells(players.length),
          playOrder: playOrderLines(players),
          caption: captionFor(tables),
          map: miniMapForGroup(idx, groupTables.value, clubTables.value),
        };
      }));

    const mapHeader = computed(() => floorMapHeader({
      dateStr: dateStr.value,
      groups: session.groups.length,
      players: session.groups.reduce((n, g) => n + g.players.length, 0),
      tablesUsed: groupTables.value.reduce((n, t) => n + Math.ceil(t), 0),
      clubTables: clubTables.value,
      solution: null,
    }).join('\n'));

    const mapColumns = computed(() => floorMapColumns(groupTables.value, clubTables.value));

    const canPrint = computed(() => drawCommitted.value && !redrawBanner.value
      && sheets.value.length + (included('tablemap') ? 1 : 0) > 0);

    const printReason = computed(() => {
      if (!drawCommitted.value) return 'Commit the draw on the Draw List tab first.';
      // `#45` one level up: the disabled button says WHY.
      if (redrawBanner.value) return 'The draw is out of date. Re-run it before printing.';
      return 'Nothing is selected.';
    });


    return {
      session, sheets, mapHeader, mapColumns, dateStr, padRating,
      selected, included, toggle, selectAll, selectNone,
      canPrint, printReason, ui,
      print: () => window.print(),
    };
  },

  template: `
  <div>
    <!-- Screen chrome. 'print.css:520' hides .lm-screen-only inside @media print. -->
    <div class="lm-screen-only">
      <div class="card" style="margin-bottom:24px">
        <div class="card-kicker">Choose what to print</div>
        <div class="lm-row2" style="flex-wrap:wrap;margin:12px 0">
          <label><input type="checkbox" :checked="included('tablemap')"
                        @change="toggle('tablemap')" /> Floor map</label>
          <label v-for="g in session.groups" :key="g.ordinal">
            <input type="checkbox" :checked="included('g' + g.ordinal)"
                   @change="toggle('g' + g.ordinal)" /> Group {{ g.ordinal }}
          </label>
        </div>
        <div class="lm-actions">
          <button class="btn btn-primary" type="button" :disabled="!canPrint" @click="print">
            Print
          </button>
          <span class="lm-reason" v-if="!canPrint">{{ printReason }}</span>
          <span class="lm-sp"></span>
          <button class="btn btn-ghost" type="button" @click="selectAll">All</button>
          <button class="btn btn-ghost" type="button" @click="selectNone">None</button>
          <label style="font-size:12px">
            <input type="checkbox" v-model="ui.printPreview" /> show a screen preview
          </label>
        </div>
        <p class="text-muted" style="font-size:12px;margin-top:12px">
          US Letter, margins zero, background graphics on. In Chrome's print dialog turn
          <b>Headers and footers</b> off and set <b>Scale</b> to 100% — each of the three
          defaults damages a sheet.
        </p>
      </div>
    </div>

    <!-- The print region. Hidden on screen by 'print.css:127-130' and revealed by
         @media print; the preview toggle opts in through the same
         '.lm-print-preview' class the harness page uses, which is why css.test.js
         requires every preview rule to be reset at its own specificity inside
         @media print. -->
    <div class="lm-print" id="lm-print-region">
      <div class="lm-sheet" v-for="s in sheets" :key="s.ordinal">
        <div class="lm-sheet-column">
          <div class="lm-sheet-headerline">
            <div>Berkeley Table Tennis Club</div>
            <div class="lm-sheet-date">Date: {{ dateStr }}</div>
          </div>
          <div>Round Robin Draw Sheet</div>

          <div class="lm-sheet-grid">
            <div class="lm-sheet-row" v-for="(row, ri) in s.rows" :key="ri">
              <div class="lm-sheet-cell" v-for="(pair, ci) in row" :key="ci">
                <div class="lm-sheet-cell-label">{{ pair[0] }} vs {{ pair[1] }}</div>
                <div class="lm-sheet-cell-boxes"><span></span><span></span></div>
              </div>
            </div>
          </div>

          <div class="lm-sheet-groupline">
            Group #{{ s.ordinal }} : {{ s.players.length }} Players, {{ s.tableText }}
          </div>

          <div class="lm-sheet-roster">
            <div v-for="(p, i) in s.players" :key="i">
              {{ i + 1 }}.  ({{ padRating(p.rating) }})  {{ p.first }} {{ p.last }}
            </div>
          </div>

          <div class="lm-sheet-footer">
            <div>  »    If you are the last pair(s) of players at the end,</div>
            <div>  »    please fold up your table when done.</div>
          </div>
        </div>

        <div class="lm-sheet-playorder">
          <div class="lm-sheet-heading">Play Order</div>
          <!-- No bolding: PrintMatchPlayOrder3() draws every pairing in the same
               weight, and ticket 18 Q8 dissolved '#11' by declining to add it. Print
               and web stay deliberately different. -->
          <div class="lm-sheet-match" v-for="(m, i) in s.playOrder" :key="i">
            <div class="lm-sheet-lhs">{{ m.lhs }}</div>
            <div class="lm-sheet-vs">{{ m.vs }}</div>
            <div class="lm-sheet-rhs">{{ m.rhs }}</div>
          </div>
        </div>

        <div class="lm-sheet-banner">
          <span class="lm-sheet-banner-label">Group #</span>
          <span class="lm-sheet-banner-num">{{ s.ordinal }}</span>
        </div>

        <!-- The mini map. Its black and grey fills are the ONLY thing telling a player
             which tables are theirs, which is why print.css:389 declares
             print-color-adjust: exact on .lm-t and .lm-desk -- Chrome drops background
             colours in print by default, a failure the image-based C# never had. -->
        <div class="lm-minimap">
          <div class="lm-minimap-caption">{{ s.caption }}</div>
          <div class="lm-desk">Desk</div>
          <div class="lm-minimap-run" v-for="run in s.map" :key="run.name" :data-run="run.name">
            <div v-for="t in run.tables" :key="t.index"
                 class="lm-t" :class="{ 'lm-mine': t.mine, 'lm-shared': t.shared }"
                 :title="'table ' + (t.index + 1)"></div>
          </div>
        </div>
      </div>

      <div class="lm-map" v-if="included('tablemap')">
        <div class="lm-map-header">{{ mapHeader }}</div>
        <div class="lm-map-column" v-for="run in mapColumns" :key="run.name" :data-run="run.name">
          <div v-for="(t, i) in run.tables" :key="i"
               class="lm-map-table" :class="{ 'lm-map-shared': t.shared, 'lm-map-long': t.long }"
               :data-content="t.label"></div>
        </div>
        <div class="lm-map-desk">[DESK]</div>
        <div class="lm-map-youarehere">X «-you are here</div>
      </div>
    </div>
  </div>
  `,
};
