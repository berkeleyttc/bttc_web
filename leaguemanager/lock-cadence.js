/**
 * `lock-cadence.js` -- when to poll `GET /rr/lock`, and when to stop.
 *
 * **Why this file exists at all: every poll is a Netlify function invocation.**
 * `api.js:31` points the whole client at `/.netlify/functions/api`, because the club's
 * `X-API-Key` is attached server-side by the proxy and must never reach a browser
 * (`netlify/functions/api.js:200`). So the transport for this app's ambient poll is a
 * metered serverless function on a 100,000/month plan, and ticket 14 Q5's flat
 * five-second interval spends 720 of them per hour per open tab, forever, for the life
 * of the mounted app.
 *
 * Nobody had costed that. Ticket 14 Q5 asked whether the poll was a *load* problem and
 * correctly answered no -- *"a 5-second poll from one or two tabs is not a load problem
 * on an always-on machine"* -- but the Fly machine is not what meters it. The measured
 * shape of the bill:
 *
 * - A real Friday evening is four hours, one operator tab, ~2,880 polls. Against
 *   ~4.3 sessions a month that is ~12,400 invocations, and everything else the app does
 *   all evening -- login, ~65 payment toggles, ~10 score submits, the draw, the
 *   publishes -- totals ~130. **The poll is ~95% of the bill.**
 * - A tab left open costs 17,280 a day. `operating-runbook.md:60` explicitly blesses
 *   this: *"a tab left open overnight still holds the lease until someone takes it."*
 *   One tab forgotten over a weekend is ~42,000 invocations, 2.5x a normal month; one
 *   forgotten for a month is ~518,000, five times the entire plan.
 *
 * The budget is therefore a function of **open-tab hours, not session hours**, and the
 * lease deliberately has no TTL and no heartbeat (ticket 14 Q4), so nothing on the
 * server side will ever stop an abandoned tab. It has to stop itself.
 *
 * **What this does NOT change.** No endpoint, no field, no precondition token; ticket
 * 12's *"no `state_version`, no `row_version`, no precondition field on any endpoint"*
 * is untouched, and so is the lease's `{user_id, session_id}` key. This is a client-side
 * decision about *when to ask*, plus one server constant (`GRACE_SECONDS`) raised to
 * keep the one invariant that constant exists to protect.
 *
 * **The invariant, preserved exactly.** Ticket 14 Q5 chose five seconds so that *"5
 * seconds sees a takeover request with 15 of the 20-second window still left to flush
 * in."* The number that matters is the **15 seconds of margin**, not the 5. At a
 * thirty-second idle poll the same margin needs a forty-five-second window, which is
 * why `rr_lock_service.py` now reads `GRACE_SECONDS = 45`. Change one of those two
 * numbers and you must change the other.
 *
 * **Why pausing outright is safe, and is not a new failure mode.** A paused tab is
 * indistinguishable from a tab whose laptop has been shut -- which is not an edge case
 * here, it is the case the grace window was designed around. `rr_lock_service.py:30-35`:
 * *"on a Friday night at a gym desk a laptop that has been shut, slept or carried away
 * is the normal case. So a grace window is unavoidable whichever way the question
 * goes."* A challenger meeting a paused incumbent waits out the window with no release
 * and the grant completes, exactly as it does today for a dead one. On resume the tab
 * polls once immediately, `app.js` synthesises `LEASE_LOST`, and the draft survives
 * read-only in `sessionStorage` -- all already-documented behaviour, reached by an
 * already-existing path.
 *
 * **Why this is a separate module rather than three constants in `app.js`.** Same
 * reason as `persist.js`: `pollLock` and its timer live inside the Vue `setup()`
 * closure, are not exported, and cannot be imported under `node --test`. The half that
 * has to be *correct* is a pure function of observable state, so it lives here where
 * `test/lock-cadence.test.js` can exhaust it, and `app.js` keeps only the plumbing.
 */

/** Contention is live. Ticket 14 Q5's original interval, unchanged. */
export const LOCK_POLL_FAST_MS = 5000;

/**
 * Holding it, and nobody is asking. Paired with `GRACE_SECONDS = 45` to preserve
 * ticket 14 Q5's fifteen seconds of flush margin. Raising this without raising
 * `GRACE_SECONDS` silently deletes that margin.
 */
export const LOCK_POLL_IDLE_MS = 30000;

/**
 * How long a tab keeps polling with nobody touching it.
 *
 * Not a lease timeout -- the lease still has none, and this tab still holds it after
 * the poll stops. It bounds only the *spend*: a forgotten tab now costs ~30 invocations
 * once and then nothing, instead of 17,280 a day.
 *
 * Fifteen minutes is chosen against the evening it has to survive: the desk is idle
 * between the draw finishing (~7pm) and the first scores coming back, and an operator
 * who has walked away for a quarter of an hour is not about to flush a draft.
 */
export const IDLE_PAUSE_MS = 15 * 60 * 1000;

/**
 * Is something happening that the next poll needs to see quickly?
 *
 * Every case here is **transient** -- it resolves within a tick or two -- which is what
 * makes it safe to burn the fast interval on. That is the whole test, and it is why
 * `lock.lost` is deliberately NOT in this list despite being the most contention-shaped
 * flag on the object: `app.js` recomputes it every poll as `holder && !mine && heldOnce`,
 * so it stays true for as long as somebody else holds the lease. Treating it as
 * contention would pin an evicted tab at five seconds indefinitely, which is precisely
 * the unbounded spend this module exists to remove.
 */
export function isContended(lock, takingOver = false) {
  if (takingOver) return true;
  if (!lock) return true;
  // Somebody is asking for it: either we are the incumbent who must flush inside the
  // grace window, or we are the challenger watching for `grant_after`.
  if (lock.takeoverRequestedBy) return true;
  // Vacant. `pollLock` acquires on the next tick and a 409 LEASE_HELD resolves it the
  // tick after; either way this is over almost immediately.
  if (!lock.holder) return true;
  // We released early for a waiting challenger and are watching for them to pick it up.
  if (lock.yielded) return true;
  return false;
}

/**
 * Milliseconds until the next `GET /rr/lock`, or **`null` to stop polling entirely**.
 *
 * Pure by construction: the caller reads the clock, the DOM and the store, and this
 * decides. `msSinceInteraction` is time since the last `pointerdown`/`keydown`.
 *
 * Order is load-bearing:
 *
 * 1. `reauth` first, ahead of everything. A tab whose token expired polls a 401 every
 *    five seconds behind an overlay nobody is looking at -- 720 failing invocations an
 *    hour, indefinitely -- and no state below can excuse that.
 * 2. `takingOver` next, exempt from both pauses. An in-flight takeover is
 *    user-initiated and bounded by `GRACE_SECONDS`, so it must complete even if the
 *    operator switches tabs to wait it out. Without this exemption a challenger who
 *    looks away never self-completes, and we are back to the second click on
 *    *Complete takeover* that `pollLock` exists to have removed.
 * 3. Then the two pauses, then the cadence.
 */
export function nextPollDelay({
  lock,
  takingOver = false,
  reauth = false,
  hidden = false,
  msSinceInteraction = 0,
} = {}) {
  if (reauth) return null;
  if (takingOver) return LOCK_POLL_FAST_MS;
  if (hidden) return null;
  if (msSinceInteraction >= IDLE_PAUSE_MS) return null;
  return isContended(lock, takingOver) ? LOCK_POLL_FAST_MS : LOCK_POLL_IDLE_MS;
}
