/**
 * The Scores tab -- `prototypes/20-match-entry.html`, transplanted with its three
 * couplings broken.
 *
 * The prototype is working code. Group 6 of the reference session was entered box by
 * box against a real endpoint and the panel came back matching `verify_ratings.py` and
 * `standings.py` exactly: **620 rating assertions and 26 in-page assertions, 0
 * failures.** Ticket 23 says transplant it rather than rewrite it, and this file does.
 *
 * ── THE THREE COUPLINGS, AND WHAT REPLACED THEM ────────────────────────────────────
 *
 * **1. `post()` read `cur.value`** (`:393-394`) instead of taking a group argument, so
 * every caller had to drive the global selection to reach a group. It takes one now.
 * That also fixes a second bug the first one hid: `bannerAction('Retry')` called
 * `post(false)`, which read `cur.value` -- so retrying a banner belonging to a group
 * other than the selected one POSTed **the wrong group**. `clearAll` (`:477-481`) and
 * `seedStrip` (`:496-505`) did the same keep-and-restore dance and go with it.
 *
 * **2. `refresh()` set `cur.value` transiently as a side channel** (`:423-425`) to
 * repaint one group's panel from the server -- which becomes *visible navigation* the
 * moment the selected group is anything but view-local, and flickered the whole UI once
 * per already-scored group on load. **It is deleted, not rewritten.** It only existed
 * because the prototype's stub returned standings from the POST alone;
 * `GET /rr/session` carries `matches` and `standings` for the whole evening, so the
 * saved shadow and the panel are seeded from the cold load with no POST at all.
 *
 * **3. `bannerAction` fell through to `location.reload()`** (`:419-422`) for every
 * action string. Under ticket 23 Q17 that now discards nothing -- both drafts survive
 * an F5 -- but it is still the wrong verb, and it would have thrown away the member
 * list, the lease and the other nine groups' drafts to repaint one banner. The actions
 * are explicit calls now.
 *
 * And `document.querySelector('[data-k=…]')` (`:518`) was document-wide rather than
 * scoped to the app root. It was the self-test's only hook and the `data-k` attributes
 * existed for it alone; both leave with the harness.
 *
 * ── WHAT IS CARRIED UNCHANGED, BECAUSE IT WAS JUDGED BY USE ────────────────────────
 *
 * Two objects of state per group; auto-submit on the incomplete → complete **edge**;
 * rejection at the keydown over the alphabet `0 1 2 3 d D`; `readonly` inputs; the
 * pill's four orthogonal channels; `Enter` flashing like any other key outside the
 * alphabet; and group switching by mouse click, ten a night, accepted rather than
 * designed away.
 *
 * ── WHAT LEFT, AND WHERE IT WENT (F41, 2026-09-12) ─────────────────────────────────
 *
 * The cell and group RULES -- the `3`/`3` pair, entered, dirty, the `savedComplete`
 * latch, the Submit button's reason and the auto-submit edge -- live in
 * `../score-entry.js`, and this file keeps only closures over `draft[n]` / `saved[n]`
 * under the same names the template used. They were measured untested here: deleting
 * `!hasInvalid(...)` from both write paths below left `node --test` green, because
 * nothing inside `setup()` can be imported by it. `test/score-entry.test.js` now holds
 * the pair rule to a fixture the Python emits, and the same mutation goes red.
 */
const { ref, reactive, computed, watch, onMounted } = window.Vue;

import { api } from '../client.js';
import { ApiError } from '../api.js';
import { session, drafts, isReadOnly, eventId, applySession } from '../store.js';
import { writeDraft, clearDraftGroup } from '../persist.js';
import {
  ALPHABET, entered as enteredIn, invalidKeys as invalidKeysIn, hasInvalid as hasInvalidIn,
  groupState, dirty as dirtyIn, savedComplete as savedCompleteIn, submitProblem, autoSubmitDue,
  pairsIn, clearGroupPrompt, clearAllPrompt,
} from '../score-entry.js';

/** Everything that navigates. Arrow keys are deliberately NOT intercepted. */
const NAV = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta']);

/**
 * The operator remedy per failure, keyed by the code that actually arrives.
 *
 * Note `3`/`3` comes back as **`PLAYER_NOT_IN_GROUP`**, not a code of its own: the
 * server reuses it for an unseated user, for self-play and for the one impossible
 * result. Ticket 28 pinned the registry at thirty and a 31st code would need a mirror
 * in `api.js`, so the code was reused rather than coined.
 */
const FAIL_ACTIONS = {
  DRAW_MISSING: ['Retry', 'Reload session'],
  PLAYER_NOT_IN_GROUP: ['Retry', 'Reload session'],
  LEASE_REQUIRED: ['Retry'],
  LEASE_HELD: [],
};

export const ScoresTab = {
  setup() {
    const cur = ref(1);
    const flash = ref(null);
    const busy = ref(false);
    const banner = reactive({});
    const standings = reactive({});

    // `drafts.savedScores` is the SHADOW OF WHAT THE SERVER HOLDS -- the second of the
    // two objects per group. It is what makes the completeness EDGE computable and the
    // pill's unsaved dot a structural diff rather than a flag someone has to remember
    // to clear. Never written optimistically; only ever from a landed response.
    const saved = drafts.savedScores;
    const draft = drafts.scores;

    let pending = false;   // a POST is in flight and another is owed. No timer, no debounce.

    // ------------------------------------------------------------ group geometry

    const groupOf = (n) => session.groups.find((g) => g.ordinal === n) || null;
    const group = computed(() => groupOf(cur.value));
    const size = computed(() => (group.value ? group.value.players.length : 0));
    const total = computed(() => pairsIn(size.value));

    const pairsOf = (n) => {
      const g = groupOf(n);
      return g ? pairsIn(g.players.length) : 0;
    };

    /** `docs/10` section 2.2's closed form: rows = N-1, row k against k+1..N. */
    const rows = computed(() => {
      const out = [];
      for (let i = 1; i < size.value; i += 1) {
        const cells = [];
        for (let j = i + 1; j <= size.value; j += 1) cells.push({ lo: i, hi: j, key: i + '_' + j });
        out.push({ k: i, cells });
      }
      return out;
    });

    /** seed -> user_id, for the group being edited. */
    const seatOf = (n) => {
      const g = groupOf(n);
      const m = new Map();
      if (g) for (const p of g.players) m.set(p.seed, p.user_id);
      return m;
    };

    // ------------------------------------------------------------ the saved shadow

    /**
     * Seed the shadow and the panel from the cold load.
     *
     * `session.matches` is flat and **always lower `user_id` first** -- CHECK-enforced
     * server-side. The grid is keyed by SEED pair, so every match has to be re-oriented
     * on the way in, taking its games with it. Getting that flip wrong would silently
     * transpose every score in the group, which is the one bug here that would look
     * plausible on screen.
     */
    function seedFromSession() {
      for (const g of session.groups) {
        const seedById = new Map(g.players.map((p) => [p.user_id, p.seed]));
        const cells = {};
        for (const m of session.matches) {
          const sa = seedById.get(m.user_a);
          const sb = seedById.get(m.user_b);
          if (sa == null || sb == null) continue;
          const [lo, hi] = sa < sb ? [sa, sb] : [sb, sa];
          const flip = sa > sb;
          cells[lo + '_' + hi] = {
            a: flip ? m.games_b : m.games_a,
            b: flip ? m.games_a : m.games_b,
          };
        }
        saved[g.ordinal] = cells;
        // A restored sessionStorage draft WINS over the server copy for a group,
        // because it is by definition newer -- it is what the operator typed and has
        // not sent. Groups with no draft take the server's.
        if (!draft[g.ordinal] || Object.keys(draft[g.ordinal]).length === 0) {
          draft[g.ordinal] = JSON.parse(JSON.stringify(cells));
        }
        if (session.standings && session.standings[String(g.ordinal)]) {
          standings[g.ordinal] = session.standings[String(g.ordinal)];
        }
      }
      if (session.groups.length && !groupOf(cur.value)) cur.value = session.groups[0].ordinal;
    }

    onMounted(seedFromSession);

    /**
     * Re-seed when the evening actually arrives.  **Not belt-and-braces -- the line
     * above is guaranteed to run too early on a reload.**
     *
     * `app.js:84` latches `booted` TRUE synchronously from `sessionStorage`, so the
     * shell renders this tab on the first paint; `boot()` -- which awaits
     * `api.getSession()` -- is only started in the SHELL's `onMounted`; and Vue fires a
     * child's `onMounted` before its parent's. So on any reload landing on `#scores`,
     * `session.groups` is empty at `onMounted`, every grid renders blank, and nothing
     * re-seeds until a mutation (`:346`) or a remount by switching tabs and back.
     *
     * Measured on the 2026Jul17 replay: 178 committed cells in the database, the
     * payload carrying all of them, and all ten grids blank after F5. An operator who
     * reloads mid-evening sees the night's scores gone and may re-enter them.
     *
     * `applySession` sets `loaded` LAST, so this fires only once the whole payload has
     * landed. `seedFromSession` already lets a restored draft win over the server copy,
     * so re-running it cannot discard anything the operator has typed.
     */
    watch(() => session.loaded, (yes) => { if (yes) seedFromSession(); });

    // Mirrored to `bttc_lm_draft_v1_<event_id>` on every keystroke (ticket 19 Q9).
    // In-memory-only satisfies every requirement tickets 13 and 14 state, because
    // those all happen within a live page -- and loses the draft to an accidental F5.
    watch(draft, () => {
      if (eventId.value != null) writeDraft(window.sessionStorage, eventId.value, draft);
    }, { deep: true });

    // ------------------------------------------------------------ cell state

    const cellsOf = (n) => draft[n] || (draft[n] = {});
    const val = (k, side) => (cellsOf(cur.value)[k] || {})[side] || '';

    // Every rule below is `score-entry.js`'s, closed over this tab's two objects. The
    // `3`/`3` pair is the ONLY invalid one; `2/1 1/2 2/2 D/1 D/0 0/0` are all accepted.
    // Blank means NOT YET ENTERED; a match that did not happen is typed 0/0 or D
    // (ticket 19 Q4 overturned ticket 11's "no row at all" so that reload is lossless).
    const bad = (k) => invalidKeysIn(cellsOf(cur.value)).includes(k);

    const invalidKeys = computed(() => invalidKeysIn(cellsOf(cur.value))
      .map((k) => k.replace('_', ' v ')));

    const entered = (n) => enteredIn(draft[n]);
    const hasInvalid = (n) => hasInvalidIn(draft[n]);
    const state = (n) => groupState(draft[n], pairsOf(n));
    const dirty = (n) => dirtyIn(draft[n], saved[n]);
    const savedComplete = (n) => savedCompleteIn(saved[n], pairsOf(n));

    // ------------------------------------------------------------ the keystroke filter

    /**
     * Ticket 19 Q5. Only `0 1 2 3 d D` and the navigation keys pass; everything else is
     * `preventDefault`ed and the box flashes ~150ms.
     *
     * This discharges three of ticket 08's properties **structurally** rather than
     * carefully: `#7` (the value never changes on a rejected key), `#43` (the error IS
     * the box) and `#45` (the flash is the beep). The inputs are `readonly` and every
     * value is written from here, so there is no code path by which a character outside
     * the alphabet could exist in a box.
     *
     * `Enter` flashes like any other key outside the alphabet -- ticket 20 Q4, one rule
     * with no carve-outs. Swallowing it silently would make the flash mean "that is not
     * a score" in one place and nothing in another. Modifier combinations are untouched,
     * so `Cmd+A`, `Cmd+R` and the browser's own keys never flash.
     */
    function key(e, k, side) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (NAV.has(e.key)) return;
      e.preventDefault();
      if (isReadOnly.value) return;
      if (e.key === 'Backspace' || e.key === 'Delete') { set(k, side, ''); return; }
      const ch = e.key.toUpperCase();
      if (ALPHABET.includes(ch)) { set(k, side, ch); return; }
      flash.value = k + side;
      window.setTimeout(() => { if (flash.value === k + side) flash.value = null; }, 150);
    }

    function set(k, side, v) {
      const g = cur.value;
      const cells = cellsOf(g);
      if (!cells[k]) cells[k] = { a: '', b: '' };
      cells[k][side] = v;
      if (cells[k].a === '' && cells[k].b === '') delete cells[k];
      maybeAuto(g);
    }

    /**
     * Auto-submit is the incomplete → complete **EDGE**, not the standing predicate.
     *
     * Ticket 19 Q6 reads both ways and ticket 20 Q1 forced the choice: *"fires the
     * moment a group is complete and valid"* is a standing predicate a corrected cell
     * also satisfies, yet the same answer lists *"a correction after `POST /rr/results`
     * has run"* among the cases the explicit button exists to cover. **The edge ships**,
     * and `savedComplete` is the latch -- once the SERVER holds a full group, every
     * later edit is a correction and needs the button. That keeps Q6's own
     * justification alive: the deliberate click is what makes the staleness banner a
     * chosen consequence.
     *
     * No debounce. Q6 rejected it on three counts, one of which is that a debounce
     * window can straddle a transient invalid state and produce saves that silently do
     * not happen. A POST already in flight sets `pending` and re-fires when it lands.
     */
    function maybeAuto(g) {
      if (isReadOnly.value) return;
      if (!autoSubmitDue(draft[g], saved[g], pairsOf(g))) return;
      if (busy.value) { pending = true; return; }
      post(g, true);
    }

    // One predicate for the button and its label: the reason IS the disablement.
    const submitReason = computed(() => submitProblem(draft[cur.value], saved[cur.value],
      { readOnly: isReadOnly.value, busy: busy.value }) ?? '');
    const canSubmit = computed(() => submitReason.value === '');

    // ------------------------------------------------------------ the POST

    /**
     * **Takes the group as an argument.** That is coupling 1, broken.
     *
     * The payload carries **every** cell of the group, did-not-happen included, and
     * `cells: []` keeps its meaning as *delete this group's rows* (ticket 12 Q9). Both
     * users are named and the server canonicalises to lower `user_id` first.
     */
    async function post(g, auto) {
      if (isReadOnly.value) return;
      const seats = seatOf(g);
      const cells = [];
      for (const [k, c] of Object.entries(draft[g] || {})) {
        if (!c.a || !c.b) continue;                  // blank means NOT YET ENTERED
        const [lo, hi] = k.split('_').map(Number);
        const ua = seats.get(lo);
        const ub = seats.get(hi);
        if (ua == null || ub == null) continue;
        cells.push({ user_a: ua, user_b: ub, games_a: c.a, games_b: c.b });
      }

      busy.value = true;
      delete banner[g];
      try {
        const body = await api.submitScores(g, cells, eventId.value);
        saved[g] = JSON.parse(JSON.stringify(draft[g] || {}));
        // Cleared per group WHEN THAT GROUP'S POST LANDS -- and never on lease
        // eviction (ticket 14): an evicted tab keeps its draft, read-only rather than
        // discarded, so taking the lease back still has something to commit.
        if (eventId.value != null) clearDraftGroup(window.sessionStorage, eventId.value, g);
        if (body.standings) standings[g] = body.standings;
        if (body.results_stale != null) session.resultsStale = body.results_stale;
        if (body.results_applied != null) session.resultsApplied = body.results_applied;
        // The server's own words when a correction invalidates an applied night. The
        // app-level banner picks this up from `session.resultsStale` and follows the
        // operator out of this view.
        if (body.warning) {
          banner[g] = { title: 'Saved', message: body.warning, actions: [], code: null, group: g };
        }
      } catch (err) {
        // An AUTO-submit failure is LOUDER, not quieter (ticket 19 Q10): no hand was on
        // it, so the banner and the pill dot are the only evidence it was attempted.
        // The draft stays intact and editable, the dot stays on the pill, and NOTHING
        // RETRIES ITSELF -- a masked retry loop on a gym network is `#45`'s dead button
        // rebuilt.
        const code = err instanceof ApiError ? err.code : null;
        banner[g] = {
          title: (auto ? 'Auto-save failed — ' : '') + 'Group ' + g + ' was not saved',
          message: err instanceof ApiError ? (err.remedy || err.detail || err.message) : String(err),
          actions: FAIL_ACTIONS[code] || ['Retry'],
          code,
          group: g,
        };
      } finally {
        busy.value = false;
        if (pending) { pending = false; maybeAuto(g); }
      }
    }

    /** No `location.reload()` anywhere. That is coupling 3, broken. */
    async function bannerAction(action, g) {
      if (action === 'Retry') { await post(g, false); return; }
      if (action === 'Reload session') {
        const s = await api.getSession(eventId.value);
        if (s) { applySession(s); seedFromSession(); }
        delete banner[g];
      }
    }

    // ------------------------------------------------------------ the clear controls

    /**
     * Both Clear controls ship, **both confirmed** (ticket 19 Q11), one of them new. The
     * count and the wording are `score-entry.js`'s, where the 335 story is told and
     * `test/score-entry.test.js` pins 180. What is here is I/O.
     *
     * The read-only guard protects the DRAFT, not the POST -- `post` refuses on its own.
     * Without it an evicted tab would wipe the draft it is supposed to keep (ticket 14,
     * and the comment in `post` above) before the refused POST ever ran.
     */
    async function clearGroup(g) {
      if (isReadOnly.value) return;
      if (!window.confirm(clearGroupPrompt(g, pairsOf(g)))) return;
      draft[g] = {};
      await post(g, false);            // an empty payload deletes this group's rows
    }

    async function clearAll() {
      if (isReadOnly.value) return;
      if (!window.confirm(clearAllPrompt(session.groups))) return;
      for (const g of session.groups) {
        draft[g.ordinal] = {};
        await post(g.ordinal, false);
      }
    }

    // ------------------------------------------------------------ the panel

    const showResults = computed(() => !!standings[cur.value]);
    const rowFor = (userId) => (standings[cur.value] || [])
      .find((r) => r.user_id === userId) || null;
    const deltaFor = (userId) => {
      // Deltas come from the server, unrounded. Ticket 19 Q8 keeps every rating and
      // ordering computation there: no second comparator, no second rating chain.
      const uid = userId;
      let sum = 0;
      let seen = false;
      for (const m of session.matches) {
        if (m.user_a === uid) { sum += m.delta_a ?? 0; seen = true; }
        else if (m.user_b === uid) { sum += m.delta_b ?? 0; seen = true; }
      }
      return seen ? sum : null;
    };

    return {
      session, cur, group, rows, total, flash, busy, banner, standings, isReadOnly,
      val, bad, invalidKeys, entered, hasInvalid, state, dirty, savedComplete,
      pairsOf, key, post, bannerAction, clearGroup, clearAll,
      canSubmit, submitReason, showResults, rowFor, deltaFor,
    };
  },

  template: `
  <div v-if="!session.groups.length" class="lm-empty">
    <!-- Ticket 23 Q19 fixes the design's stale copy: it said "Generate groups first on
         the Groups tab" for a tab labelled Draw List. -->
    No draw yet. Build and commit the draw on the <b>Draw List</b> tab first.
  </div>

  <div v-else class="lm-scores">
    <div>
      <table class="lm-panel">
        <thead><tr>
          <th>#</th><th>Name</th><th class="lm-n">Rtg</th>
          <template v-if="showResults">
            <th class="lm-n">W</th><th class="lm-n">GW</th><th class="lm-n">GL</th>
            <th class="lm-n">Pl</th><th class="lm-n">Δ</th>
          </template>
        </tr></thead>
        <tbody>
          <tr v-for="p in group.players" :key="p.user_id"
              :class="{ 'lm-placed1': rowFor(p.user_id) && rowFor(p.user_id).place === 1 }">
            <td class="lm-pos">{{ p.seed }}</td>
            <td>{{ p.first_name }} {{ p.last_name }}</td>
            <td class="lm-n">{{ p.rating_at_draw }}</td>
            <template v-if="showResults">
              <td class="lm-n">{{ rowFor(p.user_id) ? rowFor(p.user_id).matches_won : '' }}</td>
              <td class="lm-n">{{ rowFor(p.user_id) ? rowFor(p.user_id).games_won : '' }}</td>
              <td class="lm-n">{{ rowFor(p.user_id) ? rowFor(p.user_id).games_lost : '' }}</td>
              <td class="lm-n">{{ rowFor(p.user_id) ? rowFor(p.user_id).place : '' }}</td>
              <td class="lm-n" :class="deltaFor(p.user_id) >= 0 ? 'lm-delta-up' : 'lm-delta-dn'">
                {{ deltaFor(p.user_id) === null ? '' : deltaFor(p.user_id).toFixed(1) }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <p class="lm-note" v-if="!showResults">
        Rating is the draw-time snapshot (<code>#47</code>). W / GW / GL / Place / Δ
        arrive from the submit — nothing is computed here.
      </p>
    </div>

    <div>
      <!-- THE PILL STRIP. Four orthogonal channels: fill (completeness), border
           (selected), outline halo (an invalid cell somewhere in the group), corner dot
           (differs from what the server holds). Across ten groups the pill is the only
           pointer '#43' and '#45' have. -->
      <div class="lm-strip">
        <button v-for="g in session.groups" :key="g.ordinal" type="button" class="lm-pill"
                :class="{ 'lm-sel': g.ordinal === cur,
                          'lm-done': state(g.ordinal) === 'done',
                          'lm-partial': state(g.ordinal) === 'partial',
                          'lm-invalid': hasInvalid(g.ordinal) }"
                @click="cur = g.ordinal">
          Group {{ g.ordinal }}
          <span class="lm-dot" v-if="dirty(g.ordinal)"></span>
        </button>
        <span class="lm-sp"></span>
        <button class="btn btn-secondary" type="button" :disabled="isReadOnly"
                @click="clearAll">Clear all groups</button>
      </div>

      <!-- Failures land on the group that failed, inline, draft intact and editable.
           Toasts were rejected because they expire, and "Group 6" in a corner is weak
           addressing across ten groups; a blocking modal was rejected because
           auto-submit fires without the operator's hand on it and would eat the next
           keystroke in another group. -->
      <div class="lm-banner" v-if="banner[cur]">
        <span class="lm-who"><b>{{ banner[cur].title }}</b> — {{ banner[cur].message }}</span>
        <span v-if="banner[cur].code" class="lm-code">{{ banner[cur].code }}</span>
        <button v-for="a in banner[cur].actions" :key="a" class="btn btn-secondary"
                type="button" @click="bannerAction(a, banner[cur].group)">{{ a }}</button>
      </div>

      <!-- The staircase by ordinal: the same shape, in the same order, as the printed
           sheet being transcribed from. No play order, no first-up marking, no
           withdrawal highlighting -- ticket 19 Q2 and Q14. -->
      <div>
        <div class="lm-grid-row" v-for="r in rows" :key="r.k">
          <div class="lm-cell" v-for="c in r.cells" :key="c.key" :class="{ 'lm-bad': bad(c.key) }">
            <div class="lm-cell-label">{{ c.lo }} v {{ c.hi }}</div>
            <div class="lm-cell-boxes">
              <input :value="val(c.key,'a')" readonly
                     :class="{ 'lm-empty': !val(c.key,'a'), 'lm-flash': flash === c.key+'a' }"
                     @keydown="key($event, c.key, 'a')" />
              <input :value="val(c.key,'b')" readonly
                     :class="{ 'lm-empty': !val(c.key,'b'), 'lm-flash': flash === c.key+'b' }"
                     @keydown="key($event, c.key, 'b')" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="invalidKeys.length" class="lm-cell-msg" style="font-size:12px;margin-top:8px">
        One side wins 3 — {{ invalidKeys.join(', ') }}
      </div>

      <div class="lm-actions">
        <button class="btn btn-primary" type="button" :disabled="!canSubmit"
                @click="post(cur, false)">Submit Group {{ cur }}</button>
        <span class="lm-reason" v-if="!canSubmit">{{ submitReason }}</span>
        <!-- The button's label carries the reason, so the operator is never left
             wondering why nothing fired (ticket 20 Q1). -->
        <span class="lm-saved" v-else-if="dirty(cur) && savedComplete(cur)">correction — submit to save</span>
        <span class="lm-saved" v-else-if="dirty(cur)">unsaved changes</span>
        <span class="lm-saved" v-if="entered(cur) === total && !dirty(cur)">saved · complete</span>
        <span class="lm-sp"></span>
        <button class="btn btn-secondary" type="button" :disabled="isReadOnly"
                @click="clearGroup(cur)">Clear this group</button>
      </div>
    </div>
  </div>
  `,
};
