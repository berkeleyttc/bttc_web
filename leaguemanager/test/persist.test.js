/**
 * The draft round-trip -- the test `test/README.md` has been naming as owed.
 *
 *   "**The draft round-trip** (ticket 23 Q17) -- serialise the uncommitted draw to
 *    `bttc_lm_draw_v1_<event_id>`, restore it, re-verify. There is no `store.js` yet.
 *    It belongs to the session that writes it."
 *
 * This is that session. The failure it guards against is measured rather than
 * imagined: an accidental F5 at 7:20pm, after the operator has hand-moved six players
 * between groups, used to lose the whole draw silently, and the recovery is rebuilding
 * it by hand while sixty-five people wait.
 *
 * It also pins the `sessionStorage` inventory at four keys, which is the ticket 04
 * failure mode -- `bttc_roster_cache`, one key, two apps, two disagreeing shapes -- as
 * a test rather than as a comment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYS, DRAFT_VERSION, draftKey, drawKey,
  readDraft, writeDraft, clearDraftGroup,
  readDraw, writeDraw, clearDraw,
  sessionId, readAuth, writeAuth, clearAuth,
} from '../persist.js';

/** A `sessionStorage` stand-in. Same three methods, no browser. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()],
    raw: map,
  };
}

/** One that refuses every write, the way Safari does in private mode. */
function hostileStorage() {
  return {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
}

const EVENT = 41;

describe('the uncommitted draw survives a reload — ticket 23 Q17', () => {
  const built = {
    spec: '6³, 6³, 6³, 6³, 6³, 6², 7³, 7³, 7³, 7³',
    sizes: [6, 6, 6, 6, 6, 7, 7, 7, 7, 7],
    tables: [3, 3, 3, 3, 3, 2, 3, 3, 3, 3],
    groups: [[812, 44, 907, 12, 655, 78], [301, 99, 1042, 6, 570, 233]],
    moves: [{ userId: 907, from: 1, to: 2 }, { userId: 570, from: 2, to: 1 }],
    solutionIndex: 0,
    tableCount: 20,
  };

  it('round-trips through the key byte for byte', () => {
    const s = fakeStorage();
    assert.equal(writeDraw(s, EVENT, built), true);
    const back = readDraw(s, EVENT);
    assert.deepEqual(back, built);
  });

  it('keeps the manual moves, which the groups alone cannot reconstruct', () => {
    // This is the half that costs the operator their evening. The groups are
    // recomputable from the roster and the solution; six hand-moves are not.
    const s = fakeStorage();
    writeDraw(s, EVENT, built);
    assert.deepEqual(readDraw(s, EVENT).moves, built.moves);
  });

  it('is event-scoped, so last Friday’s draw cannot surface', () => {
    const s = fakeStorage();
    writeDraw(s, 40, built);
    assert.equal(readDraw(s, 41), null);
    assert.equal(drawKey(41), 'bttc_lm_draw_v1_41');
  });

  it('is versioned, so a shape change cannot be misread as this shape', () => {
    const s = fakeStorage();
    writeDraw(s, EVENT, built);
    const stored = JSON.parse(s.getItem(drawKey(EVENT)));
    assert.equal(stored.v, DRAFT_VERSION);
    s.setItem(drawKey(EVENT), JSON.stringify({ ...stored, v: 99 }));
    assert.equal(readDraw(s, EVENT), null);
  });

  it('survives a corrupt or truncated value rather than throwing', () => {
    const s = fakeStorage({ [drawKey(EVENT)]: '{"v":1,"groups":' });
    assert.equal(readDraw(s, EVENT), null);
  });

  it('is cleared by POST /rr/draw 200, and only then', () => {
    const s = fakeStorage();
    writeDraw(s, EVENT, built);
    clearDraw(s, EVENT);
    assert.equal(readDraw(s, EVENT), null);
  });
});

describe('the score draft — ticket 19 Q9', () => {
  const draft = {
    6: { '1_2': { a: '3', b: '1' }, '1_3': { a: '0', b: '0' }, '2_3': { a: 'D', b: 'D' } },
    7: { '1_2': { a: '3', b: '' } },
  };

  it('round-trips the { group: { loSeed_hiSeed: {a,b} } } shape', () => {
    const s = fakeStorage();
    writeDraft(s, EVENT, draft);
    assert.deepEqual(readDraft(s, EVENT), draft);
  });

  it('preserves all four did-not-happen spellings distinctly', () => {
    // Ticket 19 Q4's whole reason for overturning ticket 11's "no row at all":
    // a D–D must come back as D–D, not as 0–0.
    const s = fakeStorage();
    const spellings = { 9: {
      '1_2': { a: '0', b: '0' }, '1_3': { a: '0', b: 'D' },
      '2_3': { a: 'D', b: '0' }, '1_4': { a: 'D', b: 'D' },
    } };
    writeDraft(s, EVENT, spellings);
    assert.deepEqual(readDraft(s, EVENT), spellings);
  });

  it('clears one group when that group’s POST lands, leaving the others', () => {
    const s = fakeStorage();
    writeDraft(s, EVENT, draft);
    const left = clearDraftGroup(s, EVENT, 6);
    assert.deepEqual(Object.keys(left), ['7']);
    assert.deepEqual(readDraft(s, EVENT), { 7: draft[7] });
  });

  it('removes the key entirely once the last group is cleared', () => {
    const s = fakeStorage();
    writeDraft(s, EVENT, { 6: draft[6] });
    clearDraftGroup(s, EVENT, 6);
    assert.equal(s.getItem(draftKey(EVENT)), null);
  });

  it('uses a different key from the draw draft', () => {
    // One key holding two shapes is the bttc_roster_cache failure ticket 04 measured.
    assert.notEqual(draftKey(EVENT), drawKey(EVENT));
  });
});

describe('the sessionStorage inventory is four keys, and none is admin’s', () => {
  it('never names a bttc_admin_*, bttc_roster_cache or bttc_event_metadata key', () => {
    // Same origin, different identity systems (ticket 13, ticket 23 Q15). One app's
    // stale session must not appear to authenticate the other.
    const all = [...Object.values(KEYS), draftKey(EVENT), drawKey(EVENT)];
    for (const k of all) {
      assert.ok(k.startsWith('bttc_lm_'), k + ' is outside this app’s namespace');
      assert.ok(!k.startsWith('bttc_admin_'), k + ' collides with admin/');
      assert.notEqual(k, 'bttc_roster_cache');
      assert.notEqual(k, 'bttc_event_metadata');
    }
  });

  it('is exactly the four the ticket lists', () => {
    assert.deepEqual(Object.values(KEYS).sort(),
      ['bttc_lm_auth', 'bttc_lm_expires', 'bttc_lm_session_id', 'bttc_lm_token']);
  });
});

describe('the per-tab lease identity — ticket 14 Q6', () => {
  it('is generated once and reused, so a reload keeps the same lease', () => {
    const s = fakeStorage();
    let n = 0;
    const rnd = () => 'id-' + (++n);
    assert.equal(sessionId(s, rnd), 'id-1');
    assert.equal(sessionId(s, rnd), 'id-1');
    assert.equal(n, 1);
  });

  it('differs between tabs, which is what makes a second tab a real challenger', () => {
    // If user_id were the whole key, both tabs would believe they held the lease,
    // neither would ever be prompted, and they would clobber each other freely.
    let n = 0;
    const rnd = () => 'id-' + (++n);
    assert.notEqual(sessionId(fakeStorage(), rnd), sessionId(fakeStorage(), rnd));
  });

  it('still yields an id when storage refuses — in memory, for this page', () => {
    assert.equal(sessionId(hostileStorage(), () => 'fallback'), 'fallback');
  });
});

describe('the cold gate’s credentials — ticket 23 Q15', () => {
  it('round-trips a live token', () => {
    const s = fakeStorage();
    const soon = Math.floor(Date.now() / 1000) + 3600;
    writeAuth(s, 'tok', soon);
    assert.deepEqual(readAuth(s), { token: 'tok', expiresAt: soon });
  });

  it('treats expiry as no session — expires_at is EPOCH SECONDS, not milliseconds', () => {
    // POST /rr/login returns unix seconds; admin/shell.js stores Date.now()
    // milliseconds. Reading one as the other makes a 12h token look ~50,000 years
    // fresh, which is the kind of mistake two apps on one origin invite.
    const s = fakeStorage();
    writeAuth(s, 'tok', Math.floor(Date.now() / 1000) - 1);
    assert.equal(readAuth(s), null);
  });

  it('requires all three keys, so a half-cleared session does not authenticate', () => {
    const s = fakeStorage();
    writeAuth(s, 'tok', Math.floor(Date.now() / 1000) + 3600);
    s.removeItem(KEYS.EXPIRES);
    assert.equal(readAuth(s), null);
  });

  it('clears the credentials and LEAVES BOTH DRAFTS — a re-auth is not a discard', () => {
    // This is what makes ticket 13's "without discarding unsaved client state" true
    // rather than aspirational.
    const s = fakeStorage();
    writeAuth(s, 'tok', Math.floor(Date.now() / 1000) + 3600);
    writeDraft(s, EVENT, { 6: { '1_2': { a: '3', b: '1' } } });
    writeDraw(s, EVENT, { groups: [[1, 2]] });
    clearAuth(s);
    assert.equal(readAuth(s), null);
    assert.deepEqual(readDraft(s, EVENT), { 6: { '1_2': { a: '3', b: '1' } } });
    assert.ok(readDraw(s, EVENT));
  });

  it('reports a refused write rather than pretending it landed', () => {
    assert.equal(writeAuth(hostileStorage(), 'tok', 1), false);
    assert.equal(readAuth(hostileStorage()), null);
  });
});
