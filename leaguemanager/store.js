/**
 * `store.js` -- five named reactive exports, standing in for the pattern this
 * repository does not have.
 *
 * Ticket 04's sharpest finding was an absence: *"`provide`/`inject`: zero occurrences
 * ... no Pinia, no Vuex, no hand-rolled store module ... whoever builds this is
 * inventing the pattern rather than following one."* Native ES modules (ticket 23 Q3)
 * make the invention trivial -- a module that exports `reactive()` objects is an
 * ordinary import.
 *
 * **Five named exports rather than one object, deliberately.** The line
 * `import { session, lock } from './store.js'` at the top of a tab module **states what
 * that tab touches**. A single `store` import states nothing, and would reproduce
 * exactly the undifferentiated 46-key block at `League Manager.dc.html:658-702` that
 * the design is criticised for. Props-and-emits from a god component was rejected on
 * ticket 04's own measurement: 46 keys down and ~30 emits back up.
 *
 * **The design's 46 keys are a UI inventory, not a state spec** (ticket 23 Q6). Four
 * payment maps went to the server with ticket 22; `rosterLocked` died with ticket 15,
 * which found there is no lock -- `POST /rr/draw` **is** "Lock Out Changes"; three keys
 * are read nowhere in the design itself. What is left is below.
 *
 * This module reaches `window.Vue`, so `node --test` cannot import it. That is the line
 * `test/README.md` draws, and it is why the half that has to be *correct* -- the
 * `sessionStorage` codec -- lives in `persist.js`, which is pure and is tested.
 */
const { reactive, computed } = window.Vue;

/**
 * Server truth: the whole evening, from `GET /rr/session`.
 *
 * Ticket 12 Q3's composite read. Every mutation returns the state it invalidated, so
 * steady state needs no re-read and no polling on gym wifi.
 */
export const session = reactive({
  loaded: false,
  event: null,          // {id, event_type, event_date, status, max_capacity}
  settings: null,       // {table_count, group_table_counts, promotion_gap}
  roster: [],           // newest-first; money columns merged flat into each row
  waitlist: [],         // oldest-first; a NARROWER shape -- position, no money at all
  groups: [],           // 1-based ordinal, table_count may be a half
  matches: [],          // always lower user_id first, CHECK-enforced server-side
  standings: {},        // keyed by group ordinal -- STRING keys, they came through JSON
  capacity: null,
  expectedPurse: 0,
  resultsApplied: false,
  resultsStale: false,
  rrPublish: {},        // latest record PER SCOPE; at most three. Ticket 26 Q5/Q6.
  drawCommitted: false, // server-derived: bool(rr_group_players rows exist)
});

/** Apply a `GET /rr/session` payload, or anything else shaped like one. */
export function applySession(payload) {
  if (!payload) return;
  session.event = payload.event ?? null;
  session.settings = payload.settings ?? null;
  session.roster = payload.roster ?? [];
  session.waitlist = payload.waitlist ?? [];
  session.groups = payload.groups ?? [];
  session.matches = payload.matches ?? [];
  session.standings = payload.standings ?? {};
  session.capacity = payload.capacity ?? null;
  session.expectedPurse = payload.expected_purse ?? 0;
  session.resultsApplied = !!payload.results_applied;
  session.resultsStale = !!payload.results_stale;
  session.rrPublish = payload.rr_publish ?? {};
  session.drawCommitted = !!payload.draw_committed;
  session.loaded = true;
}

/**
 * A roster write returns only the roster half, not the whole evening. Merging rather
 * than replacing is what keeps the draw, the matches and the standings alive across a
 * payment toggle -- ticket 12 Q3 rejected re-fetching the whole session after every
 * write on measurement: ~65 payment toggles and ~10 grid submits an evening against a
 * ~150KB payload, online-only, with no local fallback.
 */
export function applyRosterWrite(payload) {
  if (!payload) return;
  if (payload.roster) session.roster = payload.roster;
  if (payload.waitlist) session.waitlist = payload.waitlist;
  if (payload.capacity) session.capacity = payload.capacity;
  if (payload.expected_purse != null) session.expectedPurse = payload.expected_purse;
}

/**
 * All 1,143 members, loaded once at mount and **never persisted** (ticket 23 Q18).
 *
 * Ticket 21 Q5 moved member search from the server to the client: 52 KB raw, 14 KB
 * gzipped, measured. This IS the search index, not a lazily-populated cache -- ticket
 * 05's two-pass *"scan the cache, fall back to the API on a miss"* design is void,
 * because with everything loaded there is no miss.
 *
 * Persisting it would recreate the exact failure ticket 04 found: `bttc_roster_cache`,
 * one key, two apps, two disagreeing shapes, no invalidation, bound only by a comment
 * naming a file deleted in `ed0bbf7`. 14 KB is not worth that, and `POST /rr/member`
 * appending to a persisted copy is precisely how it would go wrong.
 */
export const members = reactive({
  all: [],
  loaded: false,
});

/**
 * Appended to, never refetched. Ticket 14's single-editor lease is what makes a
 * mount-time load safe: nothing else creates members during an evening.
 */
export function appendMember(row) {
  members.all.push(row);
}

/**
 * The two client-side drafts, both mirrored to `sessionStorage` by `persist.js`.
 *
 * `scores` and `savedScores` are **two objects per group, not one** (ticket 20). Auto
 * submit is the incomplete -> complete EDGE evaluated against what the *server* holds,
 * so the saved shadow is what makes the edge computable at all -- and it is also what
 * makes the pill's unsaved dot a structural diff rather than a flag someone has to
 * remember to clear.
 *
 * The design keys its `matchResults` `g<gi>_<idA>_<idB>`, baking the GROUP INDEX into
 * the key so a re-draw silently orphans every score. These are keyed by seed pair
 * inside a group, per ticket 19 Q9.
 */
export const drafts = reactive({
  scores: {},        // { "<group>": { "<loSeed>_<hiSeed>": {a, b} } }  -- typed
  savedScores: {},   // the same shape, as last confirmed by the server
  draw: null,        // {spec, sizes, tables, groups, moves, solutionIndex, tableCount}
});

/**
 * The editor lease (ticket 14), polled at 5s for the lifetime of the app.
 *
 * **Server-derived and must not be cached stale.** This is the clearest case in the
 * port for the shared-state pattern ticket 04 found the repo offers no example of:
 * read-only mode is app-wide, so every mutating control in all seven tabs consults one
 * piece of state.
 */
export const lock = reactive({
  sessionId: null,            // this tab's identity; persist.js generates it once
  userId: null,               // the signed-in operator, from POST /rr/login
  holder: null,               // {user_id, session_id, first_name, last_name, acquired_at}
  takeoverRequestedBy: null,
  grantAfter: null,
  rosterCount: null,          // an OBSERVABLE, never sent back -- ticket 12 is not reversed
  rosterUpdatedAt: null,
  polling: false,
  heldOnce: false,            // has THIS tab ever held the lease? see `lost`
  lost: false,                // set only when a tab that HELD the lease was evicted
  yielded: false,             // handed over to a waiting challenger; do not race them
});

export function applyLock(payload) {
  if (!payload) return;
  lock.holder = payload.holder ?? null;
  if (isHolder(lock.holder)) lock.heldOnce = true;
  lock.takeoverRequestedBy = payload.takeover_requested_by ?? null;
  lock.grantAfter = payload.grant_after ?? null;
  if (payload.roster_count != null) lock.rosterCount = payload.roster_count;
  if (payload.roster_updated_at != null) lock.rosterUpdatedAt = payload.roster_updated_at;
}

/**
 * `isReadOnly` -- this tab does not hold the lease.
 *
 * The lease is keyed `{user_id, session_id}`, so **one operator's second tab is a real
 * challenger**, not the holder. If `user_id` were the whole key both tabs would believe
 * they held it, neither would ever be prompted, and they would clobber each other
 * freely -- ticket 12 left no precondition field anywhere.
 *
 * Not held yet is also read-only: the app renders with *"Jane Doe is running tonight's
 * session"* and a Take over button, and the operator decides **before** they start.
 * Ticket 14 Q8 rejected auto-acquire on the first mutation precisely because it puts
 * the discovery of contention at the worst possible moment -- after a whole draw has
 * been built client-side.
 */
export const isReadOnly = computed(() => !isHolder(lock.holder));

/**
 * Is `who` this tab? The `{user_id, session_id}` pair test, in ONE place.
 *
 * It was written out three times -- `isReadOnly`, `pollLock`'s `mine`, and `applyLock` --
 * which is how `lock.lost` came to be computed as `holder && !mine`: a form that is
 * literally `isReadOnly && lock.holder` and therefore says nothing `isReadOnly` did not
 * already say. The banner hung *"-- your unsaved work is still here."* on it, so a tab
 * that had **never held the lease** was told its work was preserved. `heldOnce` is the
 * missing half.
 */
export function isHolder(who) {
  return !!(who && who.user_id === lock.userId && who.session_id === lock.sessionId);
}

/**
 * `drawCommitted` -- `POST /rr/draw` has run and closed the event.
 *
 * **A separate gate from `isReadOnly`, and the design conflates them.** Its single
 * `rosterLocked` flag gates twelve controls across four tabs, and they are different
 * conditions: scoring happens *after* the draw, so conflating the two would lock the
 * operator out of the tab they spend the evening in.
 */
export const drawCommitted = computed(() => session.drawCommitted);

/** Convenience for the many calls that take an optional `event_id`. */
export const eventId = computed(() => (session.event ? session.event.id : null));

/**
 * View state: the active tab, the two app-level banners, and the re-auth overlay.
 *
 * **The active tab lives in the URL hash** (ticket 23 Q2), not a fifth `sessionStorage`
 * key; `ui.tab` mirrors it. The repo has no routing of any kind, so this is the first,
 * and it is deliberately the smallest possible form: read on mount, write on switch, no
 * router, no history entries to trap the back button.
 *
 * **Exactly two banners.** Ticket 28 Q10 declined a third for failures no view claims,
 * so the consequence is named rather than papered over: with `v-if` tab teardown, a
 * write that fails in a tab the operator has already left leaves nothing visible.
 */
export const ui = reactive({
  tab: 'roster',
  reauth: false,       // the overlay -- the app stays mounted behind it
  gateError: '',
  busy: false,
  // The Printing tab's screen preview. It lives here rather than in the tab because
  // `print.css:131` is `#lm-app.lm-print-preview .lm-print` -- the class has to be on
  // the APP ROOT, and `#lm-app` is the element `createApp().mount()` was given, not
  // anything the root component renders. Only `app.js` can reach it, and it does so
  // once, in a watcher. A tab reaching outside its own subtree is exactly the
  // document-wide DOM access ticket 23 flagged in the prototype.
  printPreview: false,
});

/** Ticket 19 Q15: it follows the operator OUT of the Scores view. */
export const staleBanner = computed(() => (session.resultsStale
  ? 'Scores changed after results were generated. Re-run Generate Results on the Finalize tab.'
  : null));

/**
 * Ticket 15's `remedy: "redraw"`, in the same shape. It also satisfies `#45` one level
 * up: the disabled print button says why.
 */
export const redrawBanner = computed(() => {
  if (!session.drawCommitted) return null;
  const seated = session.groups.reduce((n, g) => n + g.players.length, 0);
  const roster = session.roster.length;
  if (seated === 0 || seated === roster) return null;
  return 'The draw is out of date — the roster has ' + roster + ' players and the draw seats '
    + seated + '. Printing is unavailable until it is re-run.';
});
