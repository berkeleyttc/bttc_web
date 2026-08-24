/**
 * `persist.js` -- the four `sessionStorage` keys, and the codec for the two drafts.
 *
 * **Why this is not simply inside `store.js`.** `store.js` must reach `window.Vue` for
 * `reactive()`, so it cannot be imported under `node --test`. `test/README.md` names
 * the one test this repository is missing -- *"the draft round-trip (ticket 23 Q17):
 * serialise the uncommitted draw to `bttc_lm_draw_v1_<event_id>`, restore it,
 * re-verify"* -- and says it belongs to the session that writes `store.js`. Splitting
 * the codec out is what makes that test possible at all: the half that has to be
 * correct is pure, and `store.js` stays honest about needing Vue rather than acquiring
 * a fake `reactive` shim to be testable.
 *
 * This is an addition to ticket 23 Q16's file manifest, not a departure from it.
 *
 * **Namespacing is a requirement, not a style note** (ticket 19 Q9). Ticket 04 found
 * `registration/` and `roster/` silently sharing `bttc_roster_cache`, bound only by a
 * comment naming a file that 404s on `main`, and a second, worse instance in
 * `bttc_event_metadata` -- declared independently in two apps, read and written by
 * both, with two independently declared 24-hour TTLs and no comment binding them at
 * all. Every key here is namespaced, versioned where it carries a shape, and event- or
 * tab-scoped.
 *
 * **`sessionStorage`, never `localStorage`.** Per-tab by construction, which is what
 * keeps the drafts from fighting ticket 14's per-tab `session_id` lease identity, and
 * what stops last Friday's draft surfacing this Friday.
 *
 * The active tab is in the URL hash (ticket 23 Q2), deliberately not a fifth key.
 */

/**
 * The complete inventory. Nothing else may be read or written on this origin.
 *
 * In particular **never `bttc_admin_auth` / `bttc_admin_token` / `bttc_admin_expires`**
 * (`admin/shell.js:8-10`): same origin, different identity systems, and one app's stale
 * session must not appear to authenticate the other. Nor `bttc_roster_cache`, nor
 * `bttc_event_metadata`.
 */
export const KEYS = Object.freeze({
  AUTH: 'bttc_lm_auth',
  TOKEN: 'bttc_lm_token',
  EXPIRES: 'bttc_lm_expires',
  SESSION_ID: 'bttc_lm_session_id',
});

/** Ticket 19 Q9. Cleared per group when that group's POST lands; NEVER on eviction. */
export const draftKey = (eventId) => 'bttc_lm_draft_v1_' + eventId;

/** Ticket 23 Q17. Cleared when `POST /rr/draw` returns 200. */
export const drawKey = (eventId) => 'bttc_lm_draw_v1_' + eventId;

/** The version stamped into both draft shapes, so a shape change cannot be misread. */
export const DRAFT_VERSION = 1;

/** A storage read that cannot throw. Safari in private mode throws on access. */
function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;   // quota, or a private-mode refusal. The in-memory draft is intact.
  }
}

function remove(storage, key) {
  try { storage.removeItem(key); } catch (e) { /* nothing to do about it */ }
}

// ---------------------------------------------------------------- the score draft

/**
 * The score draft: `{ "<group>": { "<loSeed>_<hiSeed>": {a, b} } }`, ticket 19 Q9's
 * exact shape. Keyed by **seed pair**, never by group index -- the design keys it
 * `g<gi>_<idA>_<idB>`, baking the group index into the key so a re-draw silently
 * orphans every score (ticket 23 Q6).
 */
export function readDraft(storage, eventId) {
  const stored = readJson(storage, draftKey(eventId));
  if (!stored || stored.v !== DRAFT_VERSION || typeof stored.groups !== 'object') return {};
  return stored.groups || {};
}

export function writeDraft(storage, eventId, groups) {
  return writeJson(storage, draftKey(eventId), { v: DRAFT_VERSION, groups });
}

/**
 * Clear one group, because its POST landed.
 *
 * **Never called on lease eviction** (ticket 14): an evicted tab keeps its draft,
 * read-only rather than discarded, so that taking the lease back still has something
 * to commit.
 */
export function clearDraftGroup(storage, eventId, groupOrdinal) {
  const groups = readDraft(storage, eventId);
  delete groups[String(groupOrdinal)];
  if (Object.keys(groups).length === 0) remove(storage, draftKey(eventId));
  else writeDraft(storage, eventId, groups);
  return groups;
}

// ----------------------------------------------------------------- the draw draft

/**
 * The uncommitted draw, ticket 23 Q17.
 *
 * **This gap belonged to no ticket.** Ticket 05 put the whole draw client-side and
 * uncommitted until persisted; ticket 19 then persisted only the *score* draft. Between
 * them, an accidental F5 at 7:20pm -- after the operator has hand-moved six players
 * between groups -- lost all of it silently, and the recovery is rebuilding it by hand
 * while sixty-five people wait.
 *
 * `groups` are arrays of `user_id`; `moves` is the manual-move log, which is what the
 * groups alone cannot reconstruct.
 */
export function readDraw(storage, eventId) {
  const stored = readJson(storage, drawKey(eventId));
  if (!stored || stored.v !== DRAFT_VERSION || !Array.isArray(stored.groups)) return null;
  return {
    spec: stored.spec ?? null,
    sizes: Array.isArray(stored.sizes) ? stored.sizes : [],
    tables: Array.isArray(stored.tables) ? stored.tables : [],
    groups: stored.groups,
    moves: Array.isArray(stored.moves) ? stored.moves : [],
    solutionIndex: Number.isInteger(stored.solutionIndex) ? stored.solutionIndex : 0,
    tableCount: stored.tableCount ?? null,
  };
}

export function writeDraw(storage, eventId, draw) {
  return writeJson(storage, drawKey(eventId), {
    v: DRAFT_VERSION,
    spec: draw.spec ?? null,
    sizes: draw.sizes || [],
    tables: draw.tables || [],
    groups: draw.groups || [],
    moves: draw.moves || [],
    solutionIndex: draw.solutionIndex || 0,
    tableCount: draw.tableCount ?? null,
  });
}

/** Cleared on `POST /rr/draw` 200, and only then. */
export function clearDraw(storage, eventId) {
  remove(storage, drawKey(eventId));
}

// ------------------------------------------------------------------- the identity

/**
 * This tab's lease identity (ticket 14 Q6), generated once and never cleared.
 *
 * The lease is keyed `{user_id, session_id}`. If `user_id` were the whole key, one
 * operator's second tab would believe it held the lease, neither tab would ever be
 * prompted, and they would clobber each other freely -- ticket 12 left no precondition
 * field anywhere. That is the drift the lease exists to prevent, arriving through the
 * side door.
 */
export function sessionId(storage, randomHex) {
  let id = null;
  try { id = storage.getItem(KEYS.SESSION_ID); } catch (e) { id = null; }
  if (!id) {
    id = randomHex();
    try { storage.setItem(KEYS.SESSION_ID, id); } catch (e) { /* in-memory only */ }
  }
  return id;
}

// ----------------------------------------------------------------------- the auth

/** Ticket 23 Q15's cold gate. Three keys, cleared together on logout and on expiry. */
export function readAuth(storage) {
  try {
    const flag = storage.getItem(KEYS.AUTH);
    const token = storage.getItem(KEYS.TOKEN);
    const expires = storage.getItem(KEYS.EXPIRES);
    if (flag !== 'true' || !token || !expires) return null;
    // `expires_at` is UNIX EPOCH SECONDS from POST /rr/login, not milliseconds and not
    // ISO -- unlike admin/shell.js, which stores Date.now() milliseconds.
    const at = parseInt(expires, 10);
    if (!Number.isFinite(at) || Date.now() / 1000 >= at) return null;
    return { token, expiresAt: at };
  } catch (e) {
    return null;
  }
}

export function writeAuth(storage, token, expiresAt) {
  try {
    storage.setItem(KEYS.AUTH, 'true');
    storage.setItem(KEYS.TOKEN, token);
    storage.setItem(KEYS.EXPIRES, String(expiresAt));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Logout and expiry clear the credentials **and nothing else**.
 *
 * The two drafts survive deliberately: a re-auth is not a discard (ticket 13, ticket 23
 * Q15), and the whole point of the overlay is that the app never unmounts.
 */
export function clearAuth(storage) {
  remove(storage, KEYS.AUTH);
  remove(storage, KEYS.TOKEN);
  remove(storage, KEYS.EXPIRES);
}

/**
 * Recover `{user_id, role, exp}` from a stored operator token. Unverified, deliberately.
 *
 * **The bug this exists to kill.** `lock.userId` was assigned in exactly one place --
 * `POST /rr/login`'s response, inside `signIn()`. A warm boot never calls `signIn()`:
 * `booted` latches straight off `sessionStorage` and goes to `boot()`. So after **any
 * reload** `lock.userId` was `null`, `isHolder()` compared every holder against `null`
 * and returned false, and `isReadOnly` was stuck TRUE for the life of the tab.
 *
 * The app then held the lease server-side while telling the operator he did not: his own
 * name in the banner, every control disabled, and a *Take over* button that took the
 * lease from himself, succeeded, re-ran `boot()`, and left `userId` null all over again.
 * The lease protocol was working perfectly; the client simply could not recognise itself.
 * Hash routing exists so *"an accidental F5 at 8pm returns the operator to the tab they
 * were on"* -- that F5 is what armed this.
 *
 * **Unverified is correct here, not a shortcut.** The signature is the server's to check
 * and it checks it on every request; this reads only *which user this token already says
 * it is*, to compare against a holder the server itself reported. Lying to yourself about
 * your own id gains nothing and the server would reject the next mutation anyway. Per
 * ADR 0005 the lease is attribution, not access control.
 *
 * Format is `base64url(JSON).signature`, unpadded (`helpers/auth_helper.py:198-223`).
 */
export function operatorFromToken(token) {
  try {
    const payload = String(token || '').split('.')[0];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    if (!claims || !Number.isInteger(claims.user_id)) return null;
    return claims;
  } catch (e) {
    return null;
  }
}
