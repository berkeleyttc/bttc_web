/**
 * The poll cadence -- the test that keeps a Netlify bill from coming back.
 *
 * `GET /rr/lock` is ~95% of this app's Netlify function invocations, and before
 * `lock-cadence.js` it ran flat out at five seconds for the entire life of a mounted
 * tab, held or not, watched or not. A tab left open over a weekend cost ~42,000
 * invocations against a 100,000/month plan.
 *
 * Two properties have to survive every future edit, and they pull against each other:
 *
 *   1. **A tab nobody is using must go quiet.** Otherwise the spend is unbounded, since
 *      the lease deliberately has no TTL and no heartbeat and nothing server-side will
 *      ever stop an abandoned tab.
 *   2. **A tab that is being taken over must not.** Ticket 14 Q5's fifteen seconds of
 *      flush margin is the whole justification for the grace window existing.
 *
 * The interesting case is the one in `regressions` at the bottom: `lock.lost` looks
 * exactly like contention and is not, and treating it as such quietly restores the
 * unbounded spend for any tab that has ever been evicted.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextPollDelay, isContended,
  LOCK_POLL_FAST_MS, LOCK_POLL_IDLE_MS, IDLE_PAUSE_MS,
} from '../lock-cadence.js';

/** A lease this tab holds, uncontested -- the state a whole evening is spent in. */
function holding(over = {}) {
  return {
    holder: { user_id: 7, session_id: 'tab-a' },
    takeoverRequestedBy: null,
    grantAfter: null,
    yielded: false,
    lost: false,
    heldOnce: true,
    ...over,
  };
}

describe('the two intervals', () => {
  it('polls every 30s while holding it with nobody asking', () => {
    assert.equal(nextPollDelay({ lock: holding() }), LOCK_POLL_IDLE_MS);
  });

  it('drops to 5s the moment somebody asks for it', () => {
    const lock = holding({ takeoverRequestedBy: { user_id: 9 } });
    assert.equal(nextPollDelay({ lock }), LOCK_POLL_FAST_MS);
  });

  it('is fast while the lease is vacant, because that resolves in a tick', () => {
    assert.equal(nextPollDelay({ lock: holding({ holder: null }) }), LOCK_POLL_FAST_MS);
  });

  it('is fast while we have yielded and are waiting for the pickup', () => {
    assert.equal(nextPollDelay({ lock: holding({ yielded: true }) }), LOCK_POLL_FAST_MS);
  });

  it('preserves ticket 14 Q5 margin: idle interval + 15s == GRACE_SECONDS', () => {
    // If this fails, `rr_lock_service.py`'s GRACE_SECONDS must move with it.
    assert.equal(LOCK_POLL_IDLE_MS / 1000 + 15, 45);
  });
});

describe('going quiet', () => {
  it('stops entirely when the tab is hidden', () => {
    assert.equal(nextPollDelay({ lock: holding(), hidden: true }), null);
  });

  it('stops entirely after the idle window with nobody touching it', () => {
    const lock = holding();
    assert.equal(nextPollDelay({ lock, msSinceInteraction: IDLE_PAUSE_MS }), null);
    assert.equal(nextPollDelay({ lock, msSinceInteraction: IDLE_PAUSE_MS + 1 }), null);
  });

  it('keeps polling right up to the idle threshold', () => {
    const lock = holding();
    assert.equal(
      nextPollDelay({ lock, msSinceInteraction: IDLE_PAUSE_MS - 1 }), LOCK_POLL_IDLE_MS);
  });

  it('stops behind the re-auth overlay, ahead of every other consideration', () => {
    // The bug this pins: a tab whose 12h token expired kept polling a 401 every five
    // seconds behind an overlay nobody was looking at -- 720 failing invocations an
    // hour, for as long as the tab stayed open.
    const contended = holding({ takeoverRequestedBy: { user_id: 9 } });
    assert.equal(nextPollDelay({ lock: contended, reauth: true }), null);
    assert.equal(nextPollDelay({ lock: contended, reauth: true, takingOver: true }), null);
  });
});

describe('an in-flight takeover outranks both pauses', () => {
  // Bounded by GRACE_SECONDS and started by a human, so it must complete even if the
  // operator switches tabs to wait it out. Without this, a challenger who looks away
  // never self-completes and we are back to a second click on *Complete takeover*.
  it('keeps polling while hidden', () => {
    assert.equal(
      nextPollDelay({ lock: holding(), takingOver: true, hidden: true }), LOCK_POLL_FAST_MS);
  });

  it('keeps polling past the idle window', () => {
    assert.equal(
      nextPollDelay({ lock: holding(), takingOver: true, msSinceInteraction: IDLE_PAUSE_MS * 4 }),
      LOCK_POLL_FAST_MS);
  });
});

describe('regressions', () => {
  it('does NOT treat lock.lost as contention', () => {
    // `app.js` recomputes `lost` on every poll as `holder && !mine && heldOnce`, so it
    // stays true for as long as somebody else holds the lease -- it is a steady state,
    // not a transient one. Calling it contention pins an evicted tab at five seconds
    // indefinitely, which is the exact unbounded spend this module exists to remove.
    const evicted = holding({
      holder: { user_id: 9, session_id: 'tab-b' }, lost: true, heldOnce: true,
    });
    assert.equal(isContended(evicted), false);
    assert.equal(nextPollDelay({ lock: evicted }), LOCK_POLL_IDLE_MS);
  });

  it('does not put a plain read-only tab on the fast interval', () => {
    const watching = holding({
      holder: { user_id: 9, session_id: 'tab-b' }, heldOnce: false,
    });
    assert.equal(nextPollDelay({ lock: watching }), LOCK_POLL_IDLE_MS);
  });

  it('treats a missing lock as contended rather than as a reason to stop', () => {
    assert.equal(isContended(null), true);
    assert.equal(nextPollDelay({}), LOCK_POLL_FAST_MS);
  });
});
