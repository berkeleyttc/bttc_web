/**
 * The Draw List tab -- ticket 23 named it *"the largest un-prototyped tab"* in as many
 * words, and this session designed the screen.
 *
 * Ticket 07 fixed the algorithm and ticket 15 confirmed the Move select ships
 * client-side and pre-commit only, but no ticket designed the screen the way tickets 19
 * and 20 designed Scores. **The decision taken here is to transcribe the design's
 * two-pane shape** (`League Manager.dc.html:325-386`): a 380px left panel beside a
 * single flat table with inverted group-header rows, the Move `<select>` on each player
 * row, and the unassigned strip above the table. It is the shape the club has already
 * looked at, and it maps directly onto what `draw()` returns.
 *
 * **Two of the design's four left-panel inputs do not survive, because they drive
 * nothing.** It offers *Max / group* and *# of groups*; the algorithm takes neither.
 * `draw(players, numTables, solutionIndex)` is the whole surface: the partition comes
 * from a solution string, either the curated 31-entry table (at **exactly** 20 tables
 * and 42-72 players) or the C# enumerator everywhere else. What replaces them is the
 * club table count, the promotion gap and the solution picker -- the three numbers that
 * actually reach `POST /rr/draw`'s `settings`. Shipping inputs that change nothing would
 * be worse than dropping them.
 *
 * **Two rankings ship unreconciled, as the C# has them** (ticket 07). The enumerator
 * ranks fewest-idle-tables-first; the curated table deliberately idles 1-4 tables at
 * seven roster sizes, preferring eight groups of six to seven of sevens. ADR 0001 names
 * that curation as its worked example of behaviour that reads like a bug and is a real
 * club preference. At any table count other than 20 the curated table is abandoned, the
 * enumerator runs and **auto-select is disabled**, so the operator picks every time.
 * Making 17/18/19 first-class is F7; above 20 is F8.
 *
 * ── THE MOVE SELECT, AND THE ONE THING NO TICKET DECIDED ABOUT IT ────────────────
 *
 * Ticket 15 Q3 established that **legacy has no way to move a player between formed
 * groups at all** -- `GroupNum` is written in exactly two places, both on the
 * whole-draw-construction path -- so this is a port-side addition. Q3 says it *"edits
 * the uncommitted client-side draw, seeds recompute, and `POST /rr/draw` sends the
 * finished result"*, and says nothing about what a move does to the two groups' SIZES.
 *
 * The reading taken here is the one that invents least: **a move relocates, and the
 * sizes float.** The source group loses one and the target gains one, the sizes are
 * shown live, and Commit is gated on the server's own rule -- every group 5..7, every
 * roster member seated exactly once -- with the reason in text. That leans on the
 * structural validation ticket 05 already placed on the server rather than inventing a
 * swap rule the C# has no analogue for. Recording which seats were hand-placed was
 * rejected by ticket 15 Q3: it needs a `manual` column ticket 11 declined, and ticket 13
 * made attribution untrustworthy anyway.
 */
const { ref, computed, watch, onMounted } = window.Vue;

import { api } from '../client.js';
import { ApiError } from '../api.js';
import { session, drafts, applySession, isReadOnly, drawCommitted, eventId } from '../store.js';
import { writeDraw, clearDraw } from '../persist.js';
import {
  drawRoster, draw, enumerateSolutions, hasQuickSolutionOption, validateSpec,
  QUICK_SOLUTIONS, MAX_SOLUTIONS_LISTED, NUM_TABLES,
  promoteAllGroups, assignSeeds, REJECT_PROMOTION_MAX_GAP,
} from '../draw.js';

export const DrawTab = {
  setup() {
    const tableCount = ref(NUM_TABLES);
    const promotionGap = ref(REJECT_PROMOTION_MAX_GAP);
    const solutionIndex = ref(0);
    const moves = ref({});                 // userId -> target group ordinal (1-based)
    const banner = ref(null);
    const busy = ref(false);
    const customSpec = ref(null);          // the operator's typed solution, or null
    const specText = ref('');              // what the combo currently shows
    const specError = ref(null);
    // Re-draw is an explicit gesture, as legacy's lock is a toggle rather than a
    // one-way door (`Form1.cs:1236`, `:2196`). See `frozen` below.
    const unlocked = ref(false);

    const norm = (t) => String(t == null ? '' : t).replace(/\s+/g, '');

    onMounted(() => {
      if (session.settings) {
        if (session.settings.table_count) tableCount.value = session.settings.table_count;
        if (session.settings.promotion_gap != null) promotionGap.value = session.settings.promotion_gap;
      }
      // Ticket 23 Q17: the uncommitted draw survives an F5. Between ticket 05 (the
      // whole draw client-side) and ticket 19 (only the SCORE draft persisted), an
      // accidental F5 at 7:20pm -- after six hand-moves -- lost all of it silently.
      const saved = drafts.draw;
      if (saved) {
        if (saved.tableCount) tableCount.value = saved.tableCount;
        customSpec.value = saved.customSpec || null;
        solutionIndex.value = saved.solutionIndex || 0;
        moves.value = Object.fromEntries((saved.moves || []).map((m) => [m.userId, m.to]));
      }
    });

    // ------------------------------------------------------------ the roster

    /**
     * The draw reads `latest_rating ?? details.initial_rating ?? 0` -- which is what
     * `GET /rr/session` already returns as `draw_rating` (ticket 29). Money and history
     * read `latest_rating` STRICTLY; the two readings are not interchangeable, and a
     * self-declared number never becomes a fee waiver.
     */
    const players = computed(() => session.roster.map((r) => ({
      userId: r.user_id,
      lastName: r.last_name,
      firstName: r.first_name,
      rating: r.draw_rating ?? 0,
      toBePromoted: !!r.to_be_promoted,
    })));

    /** A draw rating of 0 is the operator's to set BEFORE committing (ticket 29). */
    const unrated = computed(() => players.value.filter((p) => !p.rating));

    const seeded = computed(() => drawRoster(players.value));

    /**
     * `frozen` -- a committed draw the operator has not asked to re-draw.
     *
     * **Not the same as `drawCommitted`, and that is the whole fix.** Ticket 15 Q1:
     * *"re-draw allowed until the first score"*, and `POST /rr/draw` is a full idempotent
     * DELETE+INSERT that `409 SCORES_EXIST`s only once an `RRMatch` row exists. The tab
     * used to disable every control on `drawCommitted`, which made that impossible from
     * the browser -- while four separate messages told the operator to do it anyway
     * (`api.js:93` RATING_MOVED, `api.js:95` ROSTER_MISMATCH, `roster.js` after a
     * removal, and `store.js`'s `redrawBanner`, which disables PRINTING until the draw is
     * re-run). A walk-in arriving after commit had no way out of that.
     *
     * Legacy has the affordance: `ChangesLockedOut` is a toggle, and unlocking re-enables
     * the solutions combo and Discard (`Form1.cs:979-1030`).
     */
    const frozen = computed(() => drawCommitted.value && !unlocked.value);

    /** Any score at all arms the server's `SCORES_EXIST` refusal. */
    const scoresExist = computed(() => session.matches.length > 0);

    // ------------------------------------------------------------ solutions

    const curated = computed(() =>
      hasQuickSolutionOption(players.value.length, tableCount.value));

    /**
     * The typed solution, re-checked against the CURRENT roster on every read.
     *
     * A spec is only ever stored after `validateSpec` passed, but the roster moves
     * underneath it -- a walk-in arrives and `6², (5, 5)³, 7²` no longer totals. Legacy
     * cannot hit this: `CheckForUserAddedDraw()` validates once, at the moment of typing,
     * and the whole draw is rebuilt from scratch when the roster changes. Here the spec
     * outlives the roster it was typed for, so it is re-validated rather than trusted.
     */
    const customPairs = computed(() => (customSpec.value
      ? validateSpec(customSpec.value, players.value.length).pairs
      : null));

    const enumerated = computed(() => {
      const n = players.value.length;
      if (!n) return [];
      if (curated.value) {
        return (QUICK_SOLUTIONS[n] || []).map((cfg) => ({ cfg, label: cfg }));
      }
      // Truncated to 35 -- `Declarations.cs:137`, transcribed with the enumerator.
      return enumerateSolutions(n, tableCount.value)
        .slice(0, MAX_SOLUTIONS_LISTED)
        .map((s) => ({
          cfg: s.cfg,
          label: s.cfg + '  ·  ' + s.free + ' idle, eff ' + s.eff + '%'
            + (s.shares ? ', ' + s.shares + ' shared' : ''),
        }));
    });

    /**
     * The typed solution goes in at **index 0**, which is where legacy puts it:
     * `SortedSolutions.Insert(0, tplist)` (`DrawListCode.cs:170`), labelled `(user)`
     * (`TableAssignment.cs:343`). It is prepended rather than ranked because the
     * enumerator has no score for it -- the operator's reason for typing it is not a
     * number the catalogue holds.
     */
    const solutions = computed(() => (customPairs.value
      ? [{ cfg: customSpec.value, label: customSpec.value + '  ·  (user)', user: true },
         ...enumerated.value]
      : enumerated.value));

    /** Set aside rather than silently applied. See `customPairs`. */
    const specNote = computed(() => (customSpec.value && !customPairs.value
      ? 'The typed solution no longer fits a roster of ' + players.value.length
        + ' and has been set aside.'
      : null));

    watch(solutions, () => {
      if (solutionIndex.value >= solutions.value.length) solutionIndex.value = 0;
    });

    /**
     * The combo shows the selected spec. Typing does not move it; committing to the edit
     * (`change`) does, through `onSpecChange` below.
     *
     * **While frozen it shows the COMMITTED spec**, which is the whole reason the server
     * now stores one. Falling back to `solutions[0]` there would name the top-ranked
     * partition while the table beside it renders a different, already-committed one --
     * and after a reload, with no draft to restore, that is exactly what would happen.
     */
    watch([solutions, solutionIndex, frozen, () => session.settings], () => {
      if (frozen.value) {
        const st = session.settings || {};
        // Older evenings were drawn before `spec` was persisted and have nothing to name.
        specText.value = st.spec || '';
        return;
      }
      const s = solutions.value[solutionIndex.value];
      specText.value = s ? s.cfg : '';
    }, { immediate: true, deep: true });

    /**
     * `CheckForUserAddedDraw()`, `DrawListCode.cs:157-176`.
     *
     * Legacy distinguishes typed from picked by `SelectedIndex == -1`; a `<datalist>`
     * has no such signal, so the text is matched against the list instead. Whitespace is
     * ignored on both sides because `parseSpec` strips it anyway, and the enumerator's
     * own output carries spaces the operator will not reproduce by hand.
     */
    function onSpecChange(text) {
      specError.value = null;
      const want = norm(text);
      if (!want) {                       // cleared -- fall back to the ranked list
        customSpec.value = null;
        solutionIndex.value = 0;
        return;
      }
      const i = solutions.value.findIndex((s) => norm(s.cfg) === want);
      if (i >= 0) {
        solutionIndex.value = i;
        return;
      }
      const { pairs, error } = validateSpec(text, players.value.length);
      if (!pairs) {
        // Legacy beeps (`:168`). A beep is not a port target; the reason is shown.
        specError.value = error;
        const cur = solutions.value[solutionIndex.value];
        specText.value = cur ? cur.cfg : '';
        return;
      }
      customSpec.value = String(text).trim();
      solutionIndex.value = 0;
    }

    const summary = computed(() => {
      const n = players.value.length;
      if (!n) return 'No roster yet.';
      const lines = [
        n + ' players, ' + tableCount.value + ' club tables',
        curated.value
          ? 'curated table (20 tables, 42–72 players)'
          : 'enumerator — the curated table does not apply, so nothing is auto-selected',
        solutions.value.length + ' solution' + (solutions.value.length === 1 ? '' : 's')
          + (solutions.value.length === MAX_SOLUTIONS_LISTED ? ' (truncated to 35)' : ''),
      ];
      if (!solutions.value.length) {
        // A real outcome, not an error: a roster whose every partition strands 1-4
        // players yields an empty list, and legacy's DistributeTables2() still
        // returned true.
        lines.push('');
        lines.push('No partition exists for this roster at this table count.');
      }
      return lines.join('\n');
    });

    // ------------------------------------------------------------ the draw itself

    const built = computed(() => {
      if (!players.value.length || !solutions.value.length) return null;
      // The SPEC, not the index. With a typed solution at index 0 this tab's list and
      // `draw()`'s internal enumeration no longer agree on what index *n* means, and a
      // desync there draws a different partition from the one named in the picker.
      const chosen = solutions.value[solutionIndex.value];
      const base = draw(seeded.value, tableCount.value, 0, chosen ? chosen.cfg : null);
      if (!base) return null;
      // Promotion runs on the pre-promotion partition, exactly as
      // PromotePlayersAllGroups does: index order, strongest first, group 1 promotes
      // nobody, at most three candidates per group, gap measured against the
      // SECOND-lowest because the lowest is about to be ejected.
      const after = promoteAllGroups(base.groups, players.value, promotionGap.value);
      return { ...base, groups: after.groups, promoted: new Set(after.promoted) };
    });

    /** The manual moves, applied on top of the computed draw. */
    const groups = computed(() => {
      const b = built.value;
      if (!b) return [];
      const out = b.groups.map((g) => g.slice());
      for (const [idStr, target] of Object.entries(moves.value)) {
        const id = Number(idStr);
        const t = Number(target) - 1;
        if (!Number.isInteger(t) || t < 0 || t >= out.length) continue;
        const from = out.findIndex((g) => g.includes(id));
        if (from < 0 || from === t) continue;
        out[from].splice(out[from].indexOf(id), 1);
        out[t].push(id);
      }
      // Seeds recompute after every move (ticket 15 Q3), so the order has to be right.
      const byId = Object.fromEntries(players.value.map((p) => [p.userId, p]));
      for (const g of out) {
        g.sort((x, y) => {
          const p = byId[x];
          const q = byId[y];
          if (p.rating !== q.rating) return q.rating - p.rating;
          return (p.lastName + p.firstName).toLowerCase()
            < (q.lastName + q.firstName).toLowerCase() ? -1 : 1;
        });
      }
      return out;
    });

    const byId = computed(() =>
      Object.fromEntries(players.value.map((p) => [p.userId, p])));

    const tablesFor = (i) => {
      const b = built.value;
      return b && b.tables ? b.tables[i] : null;
    };

    /**
     * The COMMITTED draw, read back from the server.
     *
     * Until this existed the Draw List tab was the only tab that never read
     * `session.groups` -- Scores, Printing and Results all do. It rendered `built`, a live
     * client-side recomputation, which coincides with the committed draw right up until a
     * reload: `commit()` clears the draft, so `solutionIndex` returns to 0 and every
     * hand-move is lost, and the tab then showed a DIFFERENT draw from the one the rest of
     * the app was working against, with nothing to say so.
     */
    const committedRows = computed(() => {
      const out = [];
      for (const g of session.groups) {
        out.push({
          header: true, ordinal: g.ordinal, count: g.players.length,
          tables: g.table_count, key: 'h' + g.ordinal,
        });
        // Server-side these arrive seed-ordered (`_Group.players`), which is the order
        // the printed sheet uses.
        for (const p of g.players) {
          out.push({
            header: false, key: 'p' + p.user_id, userId: p.user_id, seed: p.seed,
            last: p.last_name, first: p.first_name, rating: p.rating_at_draw,
            group: g.ordinal,
            note: p.promoted ? 'promoted' : '',
          });
        }
      }
      return out;
    });

    /** Flat rows: a header row per group, then its players. The design's shape. */
    const liveRows = computed(() => {
      const out = [];
      groups.value.forEach((g, i) => {
        out.push({
          header: true, ordinal: i + 1, count: g.length, tables: tablesFor(i),
          key: 'h' + i,
        });
        g.forEach((id, seedIdx) => {
          const p = byId.value[id];
          if (!p) return;
          out.push({
            header: false, key: 'p' + id, userId: id, seed: seedIdx + 1,
            last: p.lastName, first: p.firstName, rating: p.rating,
            group: i + 1,
            note: (built.value && built.value.promoted.has(id)) ? 'promoted'
              : (!p.rating ? 'no rating — set it before committing' : ''),
          });
        });
      });
      return out;
    });

    const rows = computed(() => (frozen.value ? committedRows.value : liveRows.value));

    // Anyone the partition could not seat. Legacy's solution list simply has no entry
    // that strands players; this exists so a manual move that empties a group is
    // visible rather than silent.
    //
    // Against the COMMITTED seats once frozen, which is what makes the walk-in case
    // legible: the roster grew, the stored draw does not seat them, and they show up here
    // rather than only in `store.js`'s app-level `redrawBanner`.
    const unassigned = computed(() => {
      const seated = frozen.value
        ? new Set(session.groups.flatMap((g) => g.players.map((p) => p.user_id)))
        : new Set(groups.value.flat());
      return players.value.filter((p) => !seated.has(p.userId));
    });

    // ------------------------------------------------------------ persistence

    watch([groups, moves, solutionIndex, tableCount, customSpec], () => {
      if (eventId.value == null || !built.value) return;
      // **Stop persisting once the draw is committed.** `commit()` calls `clearDraw`,
      // but `built` still computes from the roster, so without this guard the watch
      // fires immediately afterwards and writes the key straight back -- and a reload
      // would then restore a draft for a draw that is already on the server. Found by
      // driving the app rather than by reading it: the key was still in
      // `sessionStorage` after a successful commit.
      //
      // `frozen`, not `drawCommitted`: a re-draw in progress is an uncommitted draw like
      // any other, and it is exactly the work an F5 must not lose.
      if (frozen.value) return;
      const draft = {
        spec: built.value.spec,
        sizes: built.value.sizes,
        tables: built.value.tables,
        groups: groups.value,
        moves: Object.entries(moves.value).map(([userId, to]) => ({ userId: Number(userId), to })),
        solutionIndex: solutionIndex.value,
        customSpec: customSpec.value,
        tableCount: tableCount.value,
      };
      drafts.draw = draft;
      writeDraw(window.sessionStorage, eventId.value, draft);
    }, { deep: true });

    // ------------------------------------------------------------ commit

    /**
     * `POST /rr/draw` **is** "Lock Out Changes" (ticket 15): it stores the draw and
     * closes the event as its last step. There is no lock flag, no `ProgressMode` and
     * no `finalize`. The freeze binds the PUBLIC only -- the desk keeps working through
     * `/rr/roster/add` and `/rr/roster/remove` all evening.
     */
    const problems = computed(() => {
      const out = [];
      if (!groups.value.length) out.push('No solution has been chosen.');
      if (unassigned.value.length) {
        out.push(unassigned.value.length + ' player(s) are not in a group.');
      }
      groups.value.forEach((g, i) => {
        if (g.length < 5 || g.length > 7) {
          out.push('Group ' + (i + 1) + ' has ' + g.length + ' players — the server allows 5 to 7.');
        }
      });
      if (unrated.value.length) {
        out.push(unrated.value.length + ' player(s) have no rating. A draw rating of 0 seeds them last.');
      }
      return out;
    });

    // `unrated` is a WARNING, not a blocker: a newcomer's 0 is the operator's to set,
    // and the draw is still legal with it. Everything else is a real refusal.
    const blocking = computed(() => problems.value.filter((p) => !p.includes('no rating')));

    // `scoresExist` blocks committing as well as unlocking. Without it, an operator who
    // unlocked BEFORE a score was entered still has a live "Re-commit draw" button, and
    // the first they hear of the refusal is the 409. It cannot fire on a first commit:
    // match rows reference group players, so there are none until a draw exists.
    const canCommit = computed(() => !isReadOnly.value && !busy.value
      && !frozen.value && !scoresExist.value && !blocking.value.length);

    async function commit() {
      busy.value = true;
      banner.value = null;
      try {
        const payload = groups.value.map((g, i) => ({
          ordinal: i + 1,
          table_count: tablesFor(i) ?? 0,
          players: assignSeeds(g).map(({ userId, seed }) => ({
            user_id: userId,
            seed,
            promoted: !!(built.value && built.value.promoted.has(userId)),
            // The ratings the BROWSER drew with. The server cross-checks them against
            // its own, 409s RATING_MOVED naming the player, and stores its own value --
            // which closes the one race structural validation misses (ticket 12).
            rating: byId.value[userId].rating,
          })),
        }));
        const body = await api.commitDraw(payload, {
          table_count: Number(tableCount.value),
          promotion_gap: Number(promotionGap.value),
          // The partition this draw was built from. Stored by the server and handed back
          // on the cold load, so a reload can name it instead of the tab recomputing one.
          spec: built.value ? built.value.spec : null,
        }, eventId.value);
        applySession(body);
        // Cleared on 200, and only on 200.
        if (eventId.value != null) clearDraw(window.sessionStorage, eventId.value);
        drafts.draw = null;
        // Re-freeze. A re-draw is one deliberate unlock, not a mode the tab stays in.
        unlocked.value = false;
      } catch (err) {
        banner.value = err instanceof ApiError
          ? { text: err.detail || err.message, remedy: err.remedy, code: err.code,
              userIds: err.extras.user_ids || [] }
          : { text: String(err), remedy: null, code: null, userIds: [] };
      } finally {
        busy.value = false;
      }
    }

    function discard() {
      if (!window.confirm('Discard this draw and recalculate from the roster?')) return;
      moves.value = {};
      customSpec.value = null;
      specError.value = null;
      solutionIndex.value = 0;
      banner.value = null;
      if (eventId.value != null) clearDraw(window.sessionStorage, eventId.value);
      drafts.draw = null;
    }

    /**
     * Re-draw: reopen a committed draw for editing. The server needs nothing for this --
     * `POST /rr/draw` is the same call either way -- so it is purely this tab's state.
     *
     * Seeded from what was actually committed, so the operator starts where they left
     * off. When the committed spec is no longer among the options the ranked list stands:
     * the roster having changed under it is usually the very reason for the re-draw.
     */
    function redraw() {
      if (isReadOnly.value || scoresExist.value) return;
      const st = session.settings || {};
      if (st.table_count) tableCount.value = st.table_count;
      if (st.promotion_gap != null) promotionGap.value = st.promotion_gap;
      moves.value = {};
      customSpec.value = null;
      specError.value = null;
      banner.value = null;
      solutionIndex.value = 0;
      const want = norm(st.spec);
      if (want) {
        const i = solutions.value.findIndex((x) => norm(x.cfg) === want);
        if (i >= 0) solutionIndex.value = i;
      }
      unlocked.value = true;
    }

    const moveOptions = computed(() => {
      // Disabled while frozen, but the options still have to exist or the select shows
      // blank instead of the group the player is actually in.
      const n = frozen.value ? session.groups.length : groups.value.length;
      return Array.from({ length: n }, (_, i) => ({ value: i + 1, label: 'Group ' + (i + 1) }));
    });

    function onMove(userId, target) {
      moves.value = { ...moves.value, [userId]: Number(target) };
    }

    return {
      session, isReadOnly, drawCommitted, busy, banner,
      tableCount, promotionGap, solutionIndex, solutions, curated, summary,
      rows, unassigned, moveOptions, onMove, problems, blocking, canCommit,
      commit, discard, players,
      frozen, scoresExist, redraw, unlocked,
      specText, specError, specNote, onSpecChange,
    };
  },

  template: `
  <div v-if="drawCommitted && !unlocked" class="lm-banner" style="margin-bottom:16px">
    <span class="lm-who">
      The draw is committed and the event is closed to public registration.
      <template v-if="scoresExist">
        Scores have been entered, so it can no longer be re-run — clear those groups on the
        Scores tab first.
      </template>
      <template v-else>Re-draw below to change it.</template>
    </span>
  </div>
  <div v-else-if="unlocked" class="lm-banner" style="margin-bottom:16px">
    <span class="lm-who">
      Re-drawing. Nothing changes on the server until you re-commit, and re-committing
      replaces the stored draw outright.
    </span>
  </div>

  <div class="lm-draw">
    <div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-kicker">Solutions</div>
        <div class="lm-row2" style="margin:12px 0">
          <div class="field" style="width:130px">
            <label>Club tables</label>
            <input class="input" type="number" min="1" v-model.number="tableCount"
                   :disabled="isReadOnly || frozen" />
          </div>
          <div class="field" style="width:130px">
            <label>Promotion gap</label>
            <input class="input" type="number" min="0" v-model.number="promotionGap"
                   :disabled="isReadOnly || frozen" />
          </div>
        </div>

        <!-- An editable combo, not a picker: legacy's SolutionsComboBox sets no
             DropDownStyle ('Form1.Designer.cs:2905'), so it is a DropDown, and typing
             into it runs CheckForUserAddedDraw(). Ticket 07 kept that in scope in as many
             words: "the 9-state solution-string FSM, and the operator's ability to type a
             solution". The option VALUE is the bare spec so the input stays parseable;
             the metrics ride on 'label', which is what a datalist renders beside it. -->
        <div class="field">
          <label for="lm-sol">Selected solution</label>
          <input id="lm-sol" class="input" type="text" list="lm-sol-list"
                 placeholder="Pick one, or type e.g. 6², (5, 5)³, 7²"
                 :value="specText"
                 :disabled="isReadOnly || frozen || !solutions.length"
                 @change="onSpecChange($event.target.value)" />
          <datalist id="lm-sol-list">
            <option v-for="(s, i) in solutions" :key="i" :value="s.cfg" :label="s.label"></option>
          </datalist>
        </div>
        <p v-if="specError" class="lm-reason">{{ specError }}</p>
        <p v-if="specNote" class="lm-saved">{{ specNote }}</p>

        <div class="hr" style="margin:16px 0"></div>
        <div class="lm-solutions">{{ summary }}</div>
      </div>

      <div class="card">
        <div class="card-kicker">Draw list</div>

        <!-- Frozen: the one control is the way back out. -->
        <template v-if="frozen">
          <button class="btn btn-primary btn-block" style="margin-top:12px" type="button"
                  :disabled="isReadOnly || scoresExist" @click="redraw">
            Re-draw
          </button>
          <!-- The server's own refusal, said before it is provoked. It does not replace
               the 409: SCORES_EXIST stays the authority, and a score entered in another
               tab between this render and the click still lands there. -->
          <p v-if="scoresExist" class="lm-reason">
            Scores have already been entered, so the draw cannot be re-run. Clear those
            groups on the Scores tab first.
          </p>
          <span class="tag tag-accent"
                style="margin-top:12px;display:inline-block">Draw committed</span>
        </template>

        <template v-else>
          <button class="btn btn-primary btn-block" style="margin-top:12px" type="button"
                  :disabled="!canCommit" @click="commit">
            {{ busy ? 'Committing…' : (drawCommitted ? 'Re-commit draw' : 'Commit draw') }}
          </button>
          <p v-if="scoresExist" class="lm-reason">
            Scores have already been entered, so the draw cannot be re-run. Clear those
            groups on the Scores tab first.
          </p>
          <p v-for="p in blocking" :key="p" class="lm-reason">{{ p }}</p>
          <p v-for="p in problems" :key="'w' + p" class="lm-saved"
             v-show="!blocking.includes(p)">{{ p }}</p>
          <button class="btn btn-secondary btn-block" style="margin-top:12px" type="button"
                  :disabled="isReadOnly" @click="discard">
            Discard and recalculate
          </button>
        </template>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:auto">
      <div v-if="banner" class="lm-banner" style="margin:16px">
        <span class="lm-who">
          {{ banner.text }}
          <span v-if="banner.remedy"><br />{{ banner.remedy }}</span>
        </span>
        <span v-if="banner.code" class="lm-code">{{ banner.code }}</span>
      </div>

      <div v-if="unassigned.length" class="lm-unassigned">
        <div class="card-kicker" style="opacity:.6">Not assigned to a group</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
          <span v-for="p in unassigned" :key="p.userId" class="tag tag-neutral">
            {{ p.firstName }} {{ p.lastName }} · {{ p.rating }}
          </span>
        </div>
      </div>

      <p v-if="!rows.length" class="lm-empty">
        No draw yet. Add players to the roster, then choose a solution.
      </p>

      <table v-else class="table lm-drawlist" style="width:100%">
        <thead><tr><th>Last</th><th>First</th><th>Rating</th><th>Notes</th><th>Move</th></tr></thead>
        <tbody>
          <template v-for="r in rows" :key="r.key">
            <tr v-if="r.header" class="lm-grouphead">
              <td>Group #{{ r.ordinal }}</td>
              <td>{{ r.count }} Players</td>
              <td></td>
              <td colspan="2">{{ r.tables }} Table{{ r.tables === 1 ? '' : 's' }}</td>
            </tr>
            <tr v-else class="row">
              <td>{{ r.last }}</td>
              <td>{{ r.first }}</td>
              <td class="lm-num">{{ r.rating }}</td>
              <td style="font-size:12px;color:var(--color-accent-700)">{{ r.note }}</td>
              <td>
                <!-- Client-side and PRE-COMMIT only (ticket 15 Q3). It edits the
                     uncommitted draw and seeds recompute; there is no /rr/draw/move,
                     and after commit moving is a re-draw. -->
                <select class="input lm-move" :value="r.group"
                        :disabled="isReadOnly || frozen"
                        @change="onMove(r.userId, $event.target.value)">
                  <option v-for="o in moveOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
  `,
};
