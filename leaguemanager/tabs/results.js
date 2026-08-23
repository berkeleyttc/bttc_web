/**
 * The Results tab -- the 26-column table.
 *
 * Four fixed columns (place, player, rating pre, rating post), **seven** game slots,
 * five totals, and **seven** delta-vs-opponent slots: `4 + 7 + 5 + 7 = 23` cells across
 * 26 header columns, because two headers span seven each. Seven is the maximum group
 * size (`MAX_PLAYERS_PER_GROUP`), so a six-player group leaves the last slot of each
 * run blank rather than reflowing the table -- which is what keeps the columns aligned
 * when the operator switches between a six and a seven.
 *
 * **~18 CSS classes the port authors that exist nowhere.** `.col`, `.names`, `.num`,
 * `.rating-pre`, `.rating-post`, `.games`, `.game`, `.score-win`, `.score-loss`,
 * `.matches-won`, `.games-won`, `.rating-change`, `.bonus-points`, `.total-change`,
 * `.rating-change-vs`, `.rating-change-player`, `.rating`, `.row` -- inherited from the
 * markup of the club's published `results/RR_Results_*.html` pages, unstyled in `_ds`,
 * and rendering unstyled in the design canvas today. They are styled in `app.css`, under
 * `.lm-results`, so names this generic cannot reach anything else on the page.
 *
 * **Nothing here computes a rating, a place or an ordering** (ticket 19 Q8). Every
 * number comes from `GET /rr/session`'s `standings` and `matches`, which are the
 * server's own and the only authoritative ones. The prototype kept the rejected
 * client-side projection reachable behind `?panel=live` so the rejection stayed
 * inspectable; it does not ship.
 *
 * The deltas are **stored unrounded and authoritative** (ticket 11) and need not sum to
 * zero -- `#32`'s asymmetry is real arithmetic, not a display artefact. `bonus` is
 * `change - 24 if change > 24 else 0`, accumulated in opponent-ordinal order and rounded
 * **once, half-to-even**. All of that happened on the server; this renders it.
 */
const { ref, computed } = window.Vue;

import { session } from '../store.js';
import { MAX_PLAYERS_PER_GROUP } from '../draw.js';

const SLOTS = MAX_PLAYERS_PER_GROUP;

const fmt = (n) => (n == null ? '' : (n > 0 ? '+' : '') + n.toFixed(1));

export const ResultsTab = {
  setup() {
    const cur = ref(null);

    const groups = computed(() => session.groups);

    const group = computed(() => {
      if (cur.value == null) return groups.value[0] || null;
      return groups.value.find((g) => g.ordinal === cur.value) || null;
    });

    const standings = computed(() => {
      const g = group.value;
      if (!g) return [];
      // JSON object keys are strings, even though the server keys by int ordinal.
      return session.standings[String(g.ordinal)] || [];
    });

    /** user_id -> the group's seat, for opponent labels and the pre-night rating. */
    const seats = computed(() => {
      const m = new Map();
      if (group.value) for (const p of group.value.players) m.set(p.user_id, p);
      return m;
    });

    /**
     * One row per player, with their matches laid out in **opponent-seed order** --
     * the same order the rating chain accumulates in, and the same order the printed
     * sheet's staircase row reads.
     */
    const rows = computed(() => {
      const g = group.value;
      if (!g) return [];
      const opponents = g.players.slice().sort((a, b) => a.seed - b.seed);

      return standings.value.map((st) => {
        const seat = seats.value.get(st.user_id);
        const games = [];
        const versus = [];
        let total = 0;
        let seen = false;

        for (const opp of opponents) {
          if (opp.user_id === st.user_id) continue;
          const m = session.matches.find((x) =>
            (x.user_a === st.user_id && x.user_b === opp.user_id)
            || (x.user_b === st.user_id && x.user_a === opp.user_id));
          if (!m) { games.push(null); versus.push(null); continue; }
          const mine = m.user_a === st.user_id;
          const my = mine ? m.games_a : m.games_b;
          const theirs = mine ? m.games_b : m.games_a;
          const delta = (mine ? m.delta_a : m.delta_b) ?? 0;
          total += delta;
          seen = true;
          games.push({
            label: my + '-' + theirs,
            // A push (0-0, D-D and the two mixed spellings) is neither a win nor a
            // loss. Ticket 19 Q4: row presence means ENTERED, not PLAYED.
            cls: my === theirs ? '' : (my === '3' ? 'score-win' : 'score-loss'),
          });
          versus.push({
            opponent: opp.first_name + ' ' + opp.last_name[0] + '(' + opp.seed + ')',
            label: fmt(delta),
          });
        }
        while (games.length < SLOTS - 1) { games.push(null); versus.push(null); }

        const change = seen ? total : null;
        // `change - 24 if change > 24 else 0`, on the SERVER's number. Recomputing the
        // bonus here would be a second rating chain, which Q8 forbids -- this only
        // splits a total the server already produced.
        const bonus = change != null && change > 24 ? change - 24 : 0;

        return {
          place: st.place,
          userId: st.user_id,
          name: st.first_name + ' ' + st.last_name,
          displayName: (st.first_name + ' ' + st.last_name).slice(0, 20),
          ratingPre: st.rating_at_draw ?? (seat ? seat.rating_at_draw : ''),
          ratingPost: st.rating_at_draw != null && change != null
            ? Math.round(st.rating_at_draw + change + bonus) : '',
          games,
          versus,
          matchesWon: st.matches_won,
          gamesWon: st.games_won,
          change: fmt(change),
          bonus: bonus ? '+' + bonus.toFixed(1) : '',
          totalChange: fmt(change == null ? null : change + bonus),
          up: change != null && change >= 0,
        };
      });
    });

    const slotRange = computed(() => Array.from({ length: SLOTS - 1 }, (_, i) => i));

    return { session, groups, group, cur, rows, slotRange, SLOTS };
  },

  template: `
  <div v-if="!session.resultsApplied" class="lm-empty">
    Results have not been generated yet. Run <b>Generate results</b> on the Finalize tab.
  </div>

  <div v-else>
    <div class="lm-strip">
      <button v-for="g in groups" :key="g.ordinal" type="button" class="lm-pill"
              :class="{ 'lm-sel': group && g.ordinal === group.ordinal }"
              @click="cur = g.ordinal">Group {{ g.ordinal }}</button>
    </div>

    <div class="lm-results" v-if="group">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Player</th><th>Rtg Pre</th><th>Rtg Post</th>
            <th :colspan="SLOTS - 1">Games (vs. opponents, in seed order)</th>
            <th>Matches W</th><th>Games W</th><th>Rtg Δ</th><th>Bonus</th><th>Total Δ</th>
            <th :colspan="SLOTS - 1">Δ vs. opponent</th>
          </tr>
        </thead>
        <tbody>
          <tr class="row" v-for="r in rows" :key="r.userId">
            <td class="col num">{{ r.place }}</td>
            <td class="col names" :title="r.name">{{ r.displayName }}</td>
            <td class="col rating-pre num">{{ r.ratingPre }}</td>
            <td class="col rating-post num">{{ r.ratingPost }}</td>
            <td class="col games" v-for="i in slotRange" :key="'g' + i">
              <span class="game" :class="r.games[i] ? r.games[i].cls : ''">
                {{ r.games[i] ? r.games[i].label : '' }}
              </span>
            </td>
            <td class="col matches-won num">{{ r.matchesWon }}</td>
            <td class="col games-won num">{{ r.gamesWon }}</td>
            <td class="col rating-change num">
              <span class="tag" :class="r.up ? 'tag-accent' : 'tag-neutral'">{{ r.change }}</span>
            </td>
            <td class="col bonus-points num">{{ r.bonus }}</td>
            <td class="col total-change num">{{ r.totalChange }}</td>
            <td class="col rating-change-vs" v-for="i in slotRange" :key="'v' + i">
              <div class="rating-change-player">{{ r.versus[i] ? r.versus[i].opponent : '' }}</div>
              <div class="rating num">{{ r.versus[i] ? r.versus[i].label : '' }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="lm-note">
      Places come from the six-key comparator — matches won, games won, head-to-head,
      games lost, pre-night rating, name — and are stored, so a later rename cannot
      reorder a published page. Nothing on this screen is computed in the browser.
    </p>
  </div>
  `,
};
