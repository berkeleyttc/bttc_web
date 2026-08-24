/**
 * The Settings / Info tab -- small, and it ships.
 *
 * Everything the design put here has been resolved elsewhere: the fee threshold is a
 * constant (ticket 22), the four draw inputs are duplicated from the Draw List tab and
 * now come from the server (ticket 23 Q13), and the five GitHub checkboxes describe a
 * publish path ticket 16 moved entirely server-side. **Dropping the tab would have
 * been a sixth parity break** against the charting decision *"full parity, all seven
 * tabs"*, so it ships with what is genuinely left (Q20):
 *
 * - **the table count**, halves included -- ticket 07 kept it as the one persisted
 *   setting and it is a real operator input;
 * - **the `roundrobin/` constants, read-only** -- shown, not edited; making them
 *   club-editable is F21;
 * - **the lease and session state** from ticket 14: who holds it, since when, and this
 *   tab's `session_id`. There is nowhere else in the seven tabs that belongs.
 *
 * ── A GAP IN TICKET 23 Q13'S PREMISE, FOUND WHILE BUILDING THIS ────────────────────
 *
 * Q13 declined to put anything in `env.js` on the ground that *"the browser does need
 * those last three numbers -- and it gets them from `GET /rr/session`'s settings block,
 * which ticket 12 Q3 already returns."* **It returns one of the three.**
 * `RR_SETTINGS_FIELDS` is `("table_count", "group_table_counts", "promotion_gap")`
 * (`services/rr_session_service.py:81`); min/max group size, max group count, the fee
 * table and the free-play threshold are **not** on any endpoint's response anywhere.
 *
 * Q13's conclusion still holds and nothing is added to `env.js`. What changes is where
 * this tab reads from:
 *
 * - **Group sizes come from `draw.js`**, which already declares
 *   `MAX_PLAYERS_PER_GROUP = 7` and encodes 5..7 in `DISTRIBUTIONS` -- transcribed from
 *   the C# and bound by `oracle_partition.py`. That is one declaration with a
 *   conformance test behind it, not a second copy.
 * - **The fee table and the free-play threshold are NOT reproduced here.** `roundrobin/`
 *   holds one declaration of them (ticket 22 collapsed legacy's three), and hardcoding
 *   a fourth in JS to fill a read-only panel would reintroduce exactly the drift that
 *   decision removed -- with nothing to catch it, because no oracle spans this seam.
 *   The tab says so rather than showing a number it cannot vouch for. Exposing them is
 *   a one-field addition to `GET /rr/session` whenever someone wants the panel filled;
 *   it is not this session's, and it is not worth a modification to the read surface.
 */
const { computed } = window.Vue;

import { session, lock, isReadOnly } from '../store.js';
import { MAX_PLAYERS_PER_GROUP, MAX_SOLUTIONS_LISTED, NUM_TABLES, DISTRIBUTIONS } from '../draw.js';

export const SettingsTab = {
  setup() {
    // The smallest group any distribution offers. Reading it rather than writing `5`
    // keeps the number tied to the table it comes from.
    const minGroupSize = computed(() => Math.min(...DISTRIBUTIONS.map((d) => d[1])));

    const tableCount = computed(() => (session.settings ? session.settings.table_count : null));
    const promotionGap = computed(() => (session.settings ? session.settings.promotion_gap : null));
    const groupTables = computed(() => (session.settings
      ? (session.settings.group_table_counts || []) : []));

    const holderLabel = computed(() => {
      if (!lock.holder) return 'nobody';
      return (lock.holder.first_name + ' ' + lock.holder.last_name).trim()
        + (isReadOnly.value ? '' : ' (this tab)');
    });

    /**
     * **A local clock time, not an ISO string.**
     *
     * These three fields rendered the server's UTC ISO-8601 verbatim, so the operator
     * read `2026-08-24T19:51:01.541059Z` at ten to one in the afternoon. There is no
     * time formatter anywhere in `leaguemanager/`; this is the first, and it stays here
     * rather than becoming a module because the two other stamps that reach a human --
     * the takeover deadline and the eviction time -- are a countdown, not a clock.
     */
    function clockTime(iso) {
      if (!iso) return '—';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return iso;
      return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    const heldSince = computed(() => clockTime(lock.holder && lock.holder.acquired_at));
    const rosterChanged = computed(() => clockTime(lock.rosterUpdatedAt));
    const takeoverLabel = computed(() => (lock.takeoverRequestedBy
      ? lock.takeoverRequestedBy.first_name + ' — granted at ' + clockTime(lock.grantAfter)
      : 'no'));

    return {
      session, lock, isReadOnly,
      minGroupSize, MAX_PLAYERS_PER_GROUP, MAX_SOLUTIONS_LISTED, NUM_TABLES,
      tableCount, promotionGap, groupTables, holderLabel,
      heldSince, rosterChanged, takeoverLabel,
    };
  },

  template: `
  <div class="lm-settings">
    <div class="card">
      <div class="card-kicker">Tonight</div>
      <dl class="lm-kv">
        <dt>Event</dt><dd>{{ session.event ? session.event.event_date : '—' }}</dd>
        <dt>Status</dt><dd>{{ session.event ? session.event.status : '—' }}</dd>
        <dt>Roster cap</dt><dd>{{ session.event ? session.event.max_capacity : '—' }}</dd>
        <dt>On the roster</dt><dd>{{ session.roster.length }}</dd>
        <dt>On the waitlist</dt><dd>{{ session.waitlist.length }}</dd>
        <dt>Draw committed</dt><dd>{{ session.drawCommitted ? 'yes' : 'no' }}</dd>
        <dt>Results applied</dt><dd>{{ session.resultsApplied ? 'yes' : 'no' }}</dd>
        <dt>Results stale</dt><dd>{{ session.resultsStale ? 'yes' : 'no' }}</dd>
      </dl>

      <div class="hr"></div>

      <div class="card-kicker">Draw settings</div>
      <!-- Written by POST /rr/draw as part of the draw payload (ticket 12), so they
           need no settings endpoint of their own -- and they are read-only here.
           The editable copy is the Draw List tab's, pre-commit. -->
      <dl class="lm-kv">
        <dt>Club tables</dt><dd>{{ tableCount ?? '—' }}</dd>
        <dt>Promotion gap</dt><dd>{{ promotionGap ?? '—' }}</dd>
      </dl>
      <!-- HALVES INCLUDED. Ticket 07 persists the table count and nothing else about
           the floor: no group-to-table relation and no layout is recorded, so '#52'
           ships live. 'group_table_counts' is 0-INDEXED while group ordinals are
           1-based, which is why this renders the index + 1. -->
      <dl class="lm-kv" v-if="groupTables.length">
        <template v-for="(t, i) in groupTables" :key="i">
          <dt>Group {{ i + 1 }}</dt><dd>{{ t }} table{{ t === 1 ? '' : 's' }}</dd>
        </template>
      </dl>
    </div>

    <div class="card">
      <div class="card-kicker">The editor lease</div>
      <!-- Ticket 30 Q15: this is the ONLY lock an operator ever sees. Ticket 06's
           momentary roster lock is a database transaction inside one request -- it is
           sub-second, it has no home and no column, and no UI can render it. Ticket 15
           found there is no draw lock either: POST /rr/draw IS "Lock Out Changes". -->
      <dl class="lm-kv">
        <dt>Held by</dt><dd>{{ holderLabel }}</dd>
        <dt>Since</dt><dd>{{ heldSince }}</dd>
        <!-- 'lm-sha' stays HERE and only here: this one really is an id. It was also on
             the takeover deadline, which rendered a clock time as though it were a hash. -->
        <dt>This tab</dt><dd class="lm-sha">{{ lock.sessionId }}</dd>
        <dt>Takeover pending</dt><dd>{{ takeoverLabel }}</dd>
        <dt>Registered (polled)</dt><dd>{{ lock.rosterCount ?? '—' }}</dd>
        <dt>Roster last changed</dt><dd>{{ rosterChanged }}</dd>
      </dl>

      <div class="hr"></div>

      <div class="card-kicker">Constants, read-only</div>
      <dl class="lm-kv">
        <dt>Group size</dt><dd>{{ minGroupSize }}–{{ MAX_PLAYERS_PER_GROUP }}</dd>
        <dt>Solutions listed</dt><dd>{{ MAX_SOLUTIONS_LISTED }}</dd>
        <dt>Curated table applies at</dt><dd>{{ NUM_TABLES }} tables</dd>
      </dl>
      <p class="text-muted" style="font-size:12px">
        From <code>draw.js</code>, which is bound to the Python oracle. Making any of
        them club-editable is a deferred feature.
      </p>
      <p class="text-muted" style="font-size:12px">
        The fee table and the free-play threshold are single declarations in the
        server's <code>roundrobin/</code> and are not returned by any endpoint, so they
        are not shown here rather than copied into a second place that could drift.
      </p>
    </div>
  </div>
  `,
};
