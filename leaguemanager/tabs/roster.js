/**
 * The Roster tab -- three panes, and the most inherited spec of the seven.
 *
 * Ticket 30 is its surface, ticket 21 its search, ticket 22 its money and ticket 23 Q6
 * its `isReadOnly` gate. Left: client-side search over the cached 1,143. Centre: the
 * member record, the create form and the per-player payment block. Right: tonight's
 * roster, **newest-first by default and sortable by rating or name**, with a
 * **Waitlist (N)** segment beneath it that is **hidden entirely when empty**.
 *
 * **What is NOT here, and where it went.**
 *
 * - **The four-section payments screen** (ticket 22 Q12 -- Online / Cash / No fee due /
 *   Unpaid, with *expected* totals) does not ship in this session. No ticket ever
 *   assigned it a tab: ticket 18 made it screen-only, ticket 22 settled its shape, and
 *   ticket 23's seven tabs have no Payments tab. Deferred deliberately rather than
 *   guessed at. **The per-player block below is not that screen** -- it is ticket 22
 *   Q4d/Q10's settle control, which has always lived on this row, and without it the
 *   desk cannot mark anyone paid.
 * - **Demotion** (roster -> waitlist) does not ship: ticket 30 Q5. `/rr/roster/update`
 *   409s `WAITLIST_TRANSITION` on any attempt, totally and permanently.
 * - **`alwaysAddToHead`** does not ship at all (ticket 30 Q12). The rail DEFAULTS to
 *   newest-first, which is legacy's checked default -- `Form1.cs:63` and
 *   `Form1.Designer.cs:1180-1181` both set it checked, so the club has never run the
 *   other branch. What goes with the flag is `AddToRosterEndSection`
 *   (`RRPrepCode.cs:1278-1305`), which floated unrated-or-unpaid players to the head
 *   and then sorted the rest by last name through a `CompareTo(...) == -1` test that is
 *   correct only because .NET's ordinal comparison happens to return exactly `-1`. A
 *   latent bug the port declines to transcribe.
 * - **A PIN field** on the edit form: ticket 30 Q16, and see `api.js`'s `updateMember`.
 * - **`age_status` on the roster row.** Ticket 22 Q11 offered a desk-side correction
 *   and declined it, so a mis-bracketed Youth costs **$5 through `fee_waived`, not
 *   $3**. The bracket is edited on the member record, which reprices the evening on
 *   the next read -- see the note on `fee` below.
 */
const { ref, reactive, computed } = window.Vue;

import { api } from '../client.js';
import { ApiError } from '../api.js';
import { session, members, appendMember, applyRosterWrite, applySession, isReadOnly, eventId, ui }
  from '../store.js';
import { filterMembers, possibleDuplicates, RESULT_CAP } from '../search.js';
import { nameKey, compareNameKeys } from '../draw.js';

const AGE_OPTIONS = ['youth', 'adult', 'senior'];
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'zelle_venmo', label: 'Venmo, Zelle, etc.' },
];

const blankForm = () => ({
  first_name: '', last_name: '', phone_number: '', email: '',
  latest_rating: '', age_status: 'adult',
});

/**
 * The rail's three sort modes.
 *
 * **Three, not four.** A first-name ordering would be a SECOND name collation, and this
 * codebase has exactly one: `nameKey`/`compareNameKeys` in `draw.js`, ordinal on
 * `(last, first, users.id)`, mirrored server-side in `roundrobin/placement.py` and
 * bound across that seam by `oracle_partition.py`. `name` below is that comparator,
 * imported. Nothing here reimplements it.
 *
 * **`added` is the array as the server returned it** -- `created_at DESC, id DESC`
 * (`rr_session_service.py:371-384`), which is legacy's checked `alwaysAddToHead` and
 * the reason the player you just walked through the door is at eye level. `asc`
 * reverses; no date is parsed in the browser, because the server's order is the answer
 * and `registered_at` is a string on the wire.
 *
 * **`rating` is `draw_rating`, not `latest_rating`.** The two disagree on purpose:
 * `latest_rating` is NULL for every online signup, while `draw_rating` falls back to
 * `details.initial_rating` and is what `POST /rr/draw` actually seeds on. Sorting the
 * rail by anything else would let the rail and the bracket tell different stories about
 * the same player. `0` means unrated and sorts as `0` -- the honest alternative
 * (pinning unrated to the bottom in both directions) was weighed and declined, so `↑`
 * puts them first.
 */
const SORT_MODES = [
  { value: 'added', label: 'Added' },
  { value: 'rating', label: 'Rating' },
  { value: 'name', label: 'Name' },
];

export const RosterTab = {
  setup() {
    const query = ref('');
    const selectedId = ref(null);
    const mode = ref('view');            // 'view' | 'edit' | 'create'
    const form = reactive(blankForm());
    const banner = ref(null);
    const busy = ref(false);
    const capDraft = ref(null);

    // ---------------------------------------------------------------- search

    const found = computed(() => filterMembers(members.all, query.value));

    const searchNote = computed(() => {
      const r = found.value;
      if (r.parsed.kind === 'empty') return members.all.length + ' members loaded.';
      if (!r.total) return 'No match.';
      // Measured: a bare "an" matches 373 of 1,143 and "o" matches 494. The count is
      // what tells the operator the query is too broad; the cap keeps the DOM small.
      return r.capped
        ? r.total + ' matches — showing the first ' + RESULT_CAP + '. Keep typing to narrow.'
        : r.total + (r.total === 1 ? ' match.' : ' matches.');
    });

    // ---------------------------------------------------------------- selection

    const rosterById = computed(() => {
      const m = new Map();
      for (const r of session.roster) m.set(r.user_id, r);
      return m;
    });

    const waitlistById = computed(() => {
      const m = new Map();
      for (const r of session.waitlist) m.set(r.user_id, r);
      return m;
    });

    const selectedMember = computed(() => (selectedId.value == null ? null
      : members.all.find((m) => m.user_id === selectedId.value) || null));

    /** The roster row carries the money; the member row carries the identity. */
    const selectedRosterRow = computed(() => (selectedId.value == null ? null
      : rosterById.value.get(selectedId.value) || null));

    const selectedWaitlistRow = computed(() => (selectedId.value == null ? null
      : waitlistById.value.get(selectedId.value) || null));

    function select(userId) {
      selectedId.value = userId;
      mode.value = 'view';
      banner.value = null;
    }

    function startCreate() {
      Object.assign(form, blankForm());
      selectedId.value = null;
      mode.value = 'create';
      banner.value = null;
    }

    function startEdit() {
      const m = selectedMember.value;
      if (!m) return;
      Object.assign(form, {
        first_name: m.first_name ?? '', last_name: m.last_name ?? '',
        phone_number: m.phone_number ?? '', email: m.email === 'NA' ? '' : (m.email ?? ''),
        latest_rating: m.latest_rating ?? '',
        age_status: AGE_OPTIONS.includes(m.age_status) ? m.age_status : 'adult',
      });
      mode.value = 'edit';
      banner.value = null;
    }

    // ---------------------------------------------------------------- the duplicate warning

    /**
     * Client-side and pre-commit (ticket 21 Q7) -- the only moment a warning can still
     * change the outcome, and what legacy actually did. Silent until BOTH fields are
     * non-empty (`Form1.cs:2226`), and **the create button is never disabled**:
     * `GenerateNewPlayer` never consulted the panel either, and `POST /rr/member`
     * never 409s on a name.
     */
    const duplicates = computed(() => (mode.value === 'create'
      ? possibleDuplicates(members.all, form.first_name, form.last_name)
      : []));

    // ---------------------------------------------------------------- writes

    async function run(fn) {
      busy.value = true;
      banner.value = null;
      try {
        return await fn();
      } catch (err) {
        // No silent retry, ever (ticket 19 Q10): the state is safe, so retrying is a
        // choice. A masked retry loop on a gym network is `#45`'s dead button rebuilt.
        banner.value = err instanceof ApiError
          ? { text: err.detail || err.message, remedy: err.remedy, code: err.code }
          : { text: String(err), remedy: null, code: null };
        return null;
      } finally {
        busy.value = false;
      }
    }

    async function createMember() {
      const body = await run(() => api.createMember({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_number: form.phone_number.replace(/\D/g, ''),
        email: form.email.trim() || null,
        latest_rating: form.latest_rating === '' ? null : Number(form.latest_rating),
        age_status: form.age_status,
      }));
      if (!body) return;
      // THE CACHE IS APPENDED TO, NEVER REFETCHED (ticket 21 Q5). The response is
      // {user_id} and nothing else, so the row we push is the one the form already
      // holds. Ticket 14's single-editor lease is what makes that safe: nothing else
      // creates members during an evening.
      appendMember({
        user_id: body.user_id,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_number: form.phone_number.replace(/\D/g, ''),
        email: form.email.trim() || 'NA',
        bttc_id: '',
        latest_rating: form.latest_rating === '' ? null : Number(form.latest_rating),
        age_status: form.age_status,
        role: 'player',
        is_active: true,
      });
      select(body.user_id);
    }

    async function saveMember() {
      const id = selectedId.value;
      const ok = await run(() => api.updateMember(id, {
        firstName: form.first_name.trim(),
        lastName: form.last_name.trim(),
        phoneNumber: form.phone_number,
        email: form.email.trim() || null,
        latestRating: form.latest_rating === '' ? null : Number(form.latest_rating),
        ageStatus: form.age_status,
      }));
      if (!ok) return;
      // The endpoint returns {success, message, bttc_id, internal_user_id} and not the
      // row, so patch the cached copy rather than refetch 1,143 members for one edit.
      const m = selectedMember.value;
      if (m) {
        m.first_name = form.first_name.trim();
        m.last_name = form.last_name.trim();
        m.phone_number = form.phone_number.replace(/\D/g, '');
        m.email = form.email.trim() || 'NA';
        m.latest_rating = form.latest_rating === '' ? null : Number(form.latest_rating);
        m.age_status = form.age_status;
      }
      mode.value = 'view';
      // The bracket and the rating are money inputs, and `GET /rr/session` recomputes
      // `fee` and `expected_purse` on every read (session 4 dropped the frozen
      // `registrations.age_status`). Re-read so the roster row shows the new fee
      // rather than a stale one.
      const s = await run(() => api.getSession(eventId.value));
      if (s) applySession(s);
    }

    const addMethod = ref('cash');

    async function addToRoster(userId) {
      // `payment_method` is REQUIRED and is DECLARED INTENT, not a receipt (ticket 22
      // Q15): the desk picks how they say they will pay, and `status` alone says
      // whether it landed. Same as the online path, where a registrant declares
      // zelle_venmo days early and stays `pending` until confirmed.
      const body = await run(() => api.addToRoster(userId, addMethod.value, null, eventId.value));
      if (body) applyRosterWrite(body);
    }

    async function removeFromRoster(userId) {
      // 409 RR_STARTED at the first score (ticket 22 Q7b): nobody leaves once the
      // round robin has started, the seat and the fee stay, and the operator records
      // the missing matches as D or 0/0. Removal-as-refund does not exist.
      const body = await run(() => api.removeFromRoster(userId, eventId.value));
      if (!body) return;
      applyRosterWrite(body);
      // Invalidation is REPORTED, never silent (ticket 15). The client does not act on
      // `remedy: "default"` -- ticket 19 Q13 overrode the withdrawn-seat `D` pre-fill,
      // because "unplayed" is not knowable from a grid whose paper lags the floor.
      if (body.remedy) {
        banner.value = { text: 'The draw no longer matches the roster.', remedy:
          'Re-run the draw on the Draw List tab.', code: body.remedy };
      }
    }

    async function promote(userId) {
      const body = await run(() => api.promoteFromWaitlist(userId, eventId.value));
      if (body) applyRosterWrite(body);
    }

    /**
     * Settling: **one call, not two.** `POST /rr/roster/update` sets the method and
     * confirms in the same transaction (ticket 22 Q4d) -- the existing
     * `POST /registration/confirm` is one-way, which is why this endpoint exists.
     *
     * **Clicking the already-chosen method again un-settles**, back to `pending` with
     * `payment_method` cleared server-side. That is the undo for a mis-click, and it
     * is the whole reason the two buttons are toggles rather than a radio group.
     */
    async function settle(row, method) {
      const already = row.status === 'confirmed' && row.payment_method === method;
      const patch = already
        ? { user_id: row.user_id, status: 'pending' }
        : { user_id: row.user_id, status: 'confirmed', payment_method: method };
      const body = await run(() => api.updateRosterRow(patch, eventId.value));
      if (body && body.row) {
        Object.assign(row, body.row);
        if (body.expected_purse != null) session.expectedPurse = body.expected_purse;
      }
    }

    async function toggleFlag(row, field) {
      const body = await run(() => api.updateRosterRow(
        { user_id: row.user_id, [field]: !row[field] }, eventId.value));
      if (body && body.row) {
        Object.assign(row, body.row);
        if (body.expected_purse != null) session.expectedPurse = body.expected_purse;
      }
    }

    /**
     * The roster counter is an editable field (`58 / [ 60 ]`), ticket 30 Q2.
     *
     * Editable because **promotion and walk-in both refuse at capacity, and the
     * refusal has to be actionable where it happens.** `POST /events/update` now 409s
     * `ROSTER_FULL` rather than lowering the cap below the people already seated --
     * the port's ninth modification to existing behaviour, and the one nobody had
     * counted. See `api.js`'s `setMaxCapacity` for the two fields it must and must not
     * send.
     */
    async function saveCap() {
      const next = Number(capDraft.value);
      capDraft.value = null;
      if (!Number.isInteger(next) || next <= 0) return;
      if (!session.event || next === session.event.max_capacity) return;
      const body = await run(() => api.setMaxCapacity(session.event.id, next));
      if (!body) return;
      session.event.max_capacity = body.max_capacity;
      if (session.capacity) {
        session.capacity.max_capacity = body.max_capacity;
        session.capacity.spots_available = Math.max(0, body.max_capacity - session.roster.length);
      }
    }

    // ---------------------------------------------------------------- display helpers

    const feeLabel = (row) => {
      // NO MONEY IS COMPUTED IN THE BROWSER (ticket 22). `GET /rr/session` returns
      // `fee` in INTEGER DOLLARS along with the reason it is what it is. The client
      // renders and sums nothing.
      if (row.fee === 0) {
        if (row.fee_waived) return 'no fee — waived';
        if (row.free_reason === 'director') return 'no fee — director';
        if (row.free_reason === 'high_rating') return 'no fee — rating';
        return 'no fee';
      }
      return '$' + row.fee + (row.renting ? ' (incl. $2 rental)' : '');
    };

    const statusLabel = (row) => (row.status === 'confirmed'
      ? 'settled · ' + (row.payment_method === 'cash' ? 'cash' : 'online')
      : 'unpaid');

    /**
     * The rail's order. A COMPUTED, never a mutation.
     *
     * `session.roster` is replaced wholesale on every write -- `store.js`'s two
     * assignment sites both rebind the array rather than splice it, because the server
     * re-derives the order on each roster change. Sorting in place would be overwritten
     * by the next `add`/`remove`/`settle` and, worse, would put a client-side order
     * where `tabs/draw.js` reads `session.roster` directly. The draw seeds off
     * `drawRoster()`, which sorts what it is given, so this cannot perturb a bracket --
     * and it stays that way only as long as the sorting lives here and not in the store.
     *
     * `.slice()` before `.sort()` for the same reason: `Array.prototype.sort` mutates.
     */
    const sortedRoster = computed(() => {
      const rows = session.roster.slice();
      const dir = ui.rosterSortDir === 'asc' ? -1 : 1;
      if (ui.rosterSort === 'added') {
        // The server's order IS `added` descending; `asc` is that reversed.
        return dir === 1 ? rows : rows.reverse();
      }
      const byName = (a, b) => compareNameKeys(
        nameKey(a.last_name, a.first_name, a.user_id),
        nameKey(b.last_name, b.first_name, b.user_id));
      if (ui.rosterSort === 'name') return rows.sort((a, b) => dir * byName(a, b));
      // `rating`: `draw_rating` descending, then the collation -- `drawRoster`'s own
      // rule. The name tiebreak is NOT reversed with the rating, so two players on the
      // same rating hold their relative order in both directions.
      return rows.sort((a, b) => {
        const ra = a.draw_rating || 0;
        const rb = b.draw_rating || 0;
        if (ra !== rb) return dir * (rb - ra);
        return byName(a, b);
      });
    });

    function toggleSortDir() {
      ui.rosterSortDir = ui.rosterSortDir === 'desc' ? 'asc' : 'desc';
    }

    return {
      ui, SORT_MODES, sortedRoster, toggleSortDir,
      query, found, searchNote, RESULT_CAP,
      session, members, isReadOnly, busy, banner,
      selectedId, selectedMember, selectedRosterRow, selectedWaitlistRow,
      mode, form, duplicates, AGE_OPTIONS, PAYMENT_METHODS, addMethod,
      capDraft,
      select, startCreate, startEdit, createMember, saveMember,
      addToRoster, removeFromRoster, promote, settle, toggleFlag, saveCap,
      feeLabel, statusLabel,
    };
  },

  template: `
  <div class="lm-roster">

    <!-- ══ LEFT: the client-side search over all 1,143 ══════════════════════ -->
    <div class="lm-rail">
      <div class="lm-rail-head">
        <label class="text-muted" for="lm-search">Search members</label>
        <input id="lm-search" class="input" type="search" v-model="query"
               placeholder="name, ID or phone" autocomplete="off" />
      </div>
      <p class="lm-count">{{ searchNote }}</p>
      <button v-for="m in found.rows" :key="m.user_id" type="button" class="lm-rail-row"
              :aria-current="m.user_id === selectedId" @click="select(m.user_id)">
        <span class="lm-grow">{{ m.last_name }}, {{ m.first_name }}</span>
        <span class="lm-num">{{ m.latest_rating ?? '—' }}</span>
      </button>
      <div class="lm-rail-head" style="border-top:2px solid var(--color-divider);border-bottom:0">
        <button class="btn btn-secondary btn-block" type="button"
                :disabled="isReadOnly" @click="startCreate">New member »</button>
      </div>
    </div>

    <!-- ══ CENTRE: the record, the forms, and the payment block ═════════════ -->
    <div class="lm-centre"
         :class="{ 'lm-paid': selectedRosterRow && selectedRosterRow.status === 'confirmed',
                   'lm-unpaid': selectedRosterRow && selectedRosterRow.status === 'pending' }">

      <div v-if="banner" class="lm-banner">
        <span class="lm-who">
          {{ banner.text }}
          <span v-if="banner.remedy"><br />{{ banner.remedy }}</span>
        </span>
        <span v-if="banner.code" class="lm-code">{{ banner.code }}</span>
      </div>

      <p v-if="!selectedMember && mode !== 'create'" class="lm-empty">
        Search on the left, or add a new member.
      </p>

      <!-- The per-player payment block. 'League Manager.dc.html:210-232', minus the
           'Paid ($ __ )' number input, which ticket 22 Q6 removed: no amount is
           recorded anywhere, so the fee IS the amount. -->
      <div v-if="selectedRosterRow" style="margin-bottom:20px;padding-bottom:16px;
           border-bottom:2px solid var(--color-divider)">
        <div class="card-title">{{ selectedRosterRow.first_name }} {{ selectedRosterRow.last_name }}</div>
        <p class="text-muted">{{ feeLabel(selectedRosterRow) }} · {{ statusLabel(selectedRosterRow) }}</p>
        <div class="lm-row2" style="margin:10px 0">
          <button v-for="p in PAYMENT_METHODS" :key="p.value" type="button"
                  class="btn btn-secondary" :disabled="isReadOnly || busy"
                  @click="settle(selectedRosterRow, p.value)">
            {{ p.label }} »
            <span v-if="selectedRosterRow.status === 'confirmed'
                        && selectedRosterRow.payment_method === p.value">✓</span>
          </button>
        </div>
        <div class="lm-row2">
          <label><input type="checkbox" :disabled="isReadOnly || busy"
                        :checked="selectedRosterRow.fee_waived"
                        @change="toggleFlag(selectedRosterRow, 'fee_waived')" /> Fee waived</label>
          <label><input type="checkbox" :disabled="isReadOnly || busy"
                        :checked="selectedRosterRow.renting"
                        @change="toggleFlag(selectedRosterRow, 'renting')" /> Renting a paddle</label>
          <label><input type="checkbox" :disabled="isReadOnly || busy"
                        :checked="selectedRosterRow.to_be_promoted"
                        @change="toggleFlag(selectedRosterRow, 'to_be_promoted')" /> To be promoted</label>
        </div>
        <button class="btn btn-ghost" type="button" style="margin-top:12px"
                :disabled="isReadOnly || busy"
                @click="removeFromRoster(selectedRosterRow.user_id)">« Remove from roster</button>
      </div>

      <!-- The waitlist record, opened in this pane by a click in the right rail --
           the same click target and the same pane the member list already uses
           (ticket 30 Q11). -->
      <div v-if="selectedWaitlistRow" style="margin-bottom:20px">
        <div class="card-title">
          #{{ selectedWaitlistRow.position }}
          {{ selectedWaitlistRow.first_name }} {{ selectedWaitlistRow.last_name }}
        </div>
        <!-- Nothing notifies a promoted player: GoogleVoice.cs is an empty stub whose
             own comment reads "Not needed for the time being", and with F17 deferred
             there is one device, so promotion happens at the laptop and the person is
             told there. The phone number is here for the case where they wandered off. -->
        <p class="text-muted">
          {{ selectedWaitlistRow.phone_number || 'no phone on file' }} ·
          rating {{ selectedWaitlistRow.draw_rating }} ·
          waiting since {{ selectedWaitlistRow.registered_at }}
        </p>
        <button class="btn btn-primary" type="button" :disabled="isReadOnly || busy"
                @click="promote(selectedWaitlistRow.user_id)">Promote to roster ↑</button>
      </div>

      <!-- The member record, and the walk-in path onto tonight's roster. -->
      <div v-if="selectedMember && mode === 'view'">
        <div class="card-kicker">Member details</div>
        <div class="card-title">{{ selectedMember.first_name }} {{ selectedMember.last_name }}</div>
        <p class="text-muted">
          rating {{ selectedMember.latest_rating ?? '—' }} ·
          {{ selectedMember.age_status || 'adult' }} ·
          {{ selectedMember.phone_number || 'no phone' }}
          <span v-if="selectedMember.is_active === false"> · inactive</span>
        </p>
        <div class="lm-row2" style="margin-top:12px">
          <button class="btn btn-ghost" type="button" :disabled="isReadOnly" @click="startEdit">
            Edit details
          </button>
          <template v-if="!selectedRosterRow && !selectedWaitlistRow">
            <select class="input" v-model="addMethod" :disabled="isReadOnly">
              <option v-for="p in PAYMENT_METHODS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
            <button class="btn btn-primary" type="button" :disabled="isReadOnly || busy"
                    @click="addToRoster(selectedMember.user_id)">Add to roster »</button>
          </template>
        </div>
      </div>

      <!-- One form shape for create and edit. AGE STATUS IS A <select> ON BOTH
           (ticket 30 Q13): the design's create-form radio group at
           'League Manager.dc.html:189-192' becomes the '<select>' the edit form
           already used at ':252-253'. THERE IS NO PIN FIELD (ticket 30 Q16). -->
      <div v-if="mode === 'edit' || mode === 'create'">
        <div class="card-kicker">{{ mode === 'create' ? 'New member' : 'Edit details' }}</div>
        <div class="lm-row2">
          <div class="field"><label>First name</label>
            <input class="input" v-model="form.first_name" /></div>
          <div class="field"><label>Last name</label>
            <input class="input" v-model="form.last_name" /></div>
        </div>
        <div class="lm-row2">
          <div class="field"><label>Phone</label>
            <input class="input" v-model="form.phone_number" inputmode="tel" /></div>
          <div class="field"><label>Rating</label>
            <input class="input" v-model="form.latest_rating" inputmode="numeric" /></div>
        </div>
        <div class="field"><label>Email</label>
          <input class="input" v-model="form.email" type="email" /></div>
        <div class="field"><label for="lm-age">Age status</label>
          <select id="lm-age" class="input" v-model="form.age_status">
            <option v-for="a in AGE_OPTIONS" :key="a" :value="a">{{ a }}</option>
          </select>
        </div>

        <!-- Advisory only, and the create button below is NEVER disabled. -->
        <div v-if="duplicates.length" class="lm-dupes">
          {{ duplicates.length }} member{{ duplicates.length === 1 ? '' : 's' }} already
          match this name:
          <span v-for="d in duplicates" :key="d.user_id">
            {{ d.first_name }} {{ d.last_name }} ({{ d.latest_rating ?? 'unrated' }});
          </span>
        </div>

        <div class="lm-row2" style="margin-top:12px">
          <button class="btn btn-primary" type="button" :disabled="isReadOnly || busy"
                  @click="mode === 'create' ? createMember() : saveMember()">
            {{ mode === 'create' ? 'Create member' : 'Save' }}
          </button>
          <button class="btn btn-ghost" type="button" @click="mode = 'view'">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ══ RIGHT: tonight's roster, sortable, and the waitlist segment ═══════ -->
    <div class="lm-rail">
      <div class="lm-rail-head">
        <div class="lm-cap">
          <strong>Roster</strong>
          <span class="lm-grow"></span>
          <span>{{ session.roster.length }} /</span>
          <!-- The editable cap. 'capDraft' holds the in-flight value so a partly typed
               number never reaches the server. -->
          <input class="input" inputmode="numeric" :disabled="isReadOnly"
                 :value="capDraft ?? (session.event ? session.event.max_capacity : '')"
                 @input="capDraft = $event.target.value"
                 @change="saveCap" @blur="saveCap" />
        </div>
        <!-- The sort. A dropdown rather than clickable column headers because 'Added'
             is not a column you can click, and a header row costs a line of a rail that
             already scrolls at 64. -->
        <div class="lm-sort">
          <label class="lm-sort-label" for="lm-roster-sort">Sort</label>
          <select id="lm-roster-sort" class="input" v-model="ui.rosterSort">
            <option v-for="m in SORT_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
          <button type="button" class="btn btn-ghost lm-sort-dir" @click="toggleSortDir"
                  :aria-label="ui.rosterSortDir === 'desc' ? 'Descending' : 'Ascending'"
                  :title="ui.rosterSortDir === 'desc' ? 'Descending' : 'Ascending'">
            {{ ui.rosterSortDir === 'desc' ? '↓' : '↑' }}
          </button>
        </div>
      </div>
      <!-- The row carries NO money column. An unsettled status tints it instead: the
           literal flag, so a fee-waived player or a director reads as unpaid too and the
           browser computes nothing about money. Green is not mirrored here. The centre
           pane already tints on lm-paid when you click through, and tinting all 64 rows
           would leave the amber reading as wallpaper rather than as an alert. -->
      <button v-for="r in sortedRoster" :key="r.user_id" type="button" class="lm-rail-row"
              :class="{ 'lm-unpaid-row': r.status === 'pending' }"
              :aria-current="r.user_id === selectedId" @click="select(r.user_id)">
        <span class="lm-grow">{{ r.first_name }} {{ r.last_name }}</span>
        <span class="lm-num">{{ r.draw_rating || '—' }}</span>
      </button>

      <!-- HIDDEN ENTIRELY WHEN EMPTY (ticket 30 Q11). A segment, not a mode: no
           trigger, no vocabulary, no toggle. This is the shape the public roster/ app
           already ships at 'roster.js:871-890', and what legacy did on reload, where
           'LoadRosterFile' called 'ActivateWaitlist()' when the restored list was
           non-empty. -->
      <template v-if="session.waitlist.length">
        <div class="lm-waitlist-head">Waitlist ({{ session.waitlist.length }})</div>
        <button v-for="w in session.waitlist" :key="w.user_id" type="button" class="lm-rail-row"
                :aria-current="w.user_id === selectedId" @click="select(w.user_id)">
          <span class="lm-pos">#{{ w.position }}</span>
          <span class="lm-grow">{{ w.first_name }} {{ w.last_name }}</span>
          <!-- Rating is not decoration: promoting a 1900 rather than a 1400 changes
               the draw. -->
          <span class="lm-num">{{ w.draw_rating }}</span>
        </button>
      </template>
    </div>
  </div>
  `,
};
