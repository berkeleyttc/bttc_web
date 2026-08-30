/**
 * `api.js` -- the League Manager's only network module.
 *
 * `bttc_api/helpers/errors.py:28` says *"bttc_web/leaguemanager/api.js mirrors this
 * table"*. It said so for two sessions before this file existed: session 4 recorded
 * that the obligation was real but had nothing to update, and session 5 left it. This
 * file is what makes that sentence true, so `errors.py` needs no re-wording.
 *
 * **`js/bttc-utils.js` is neither used nor extended** (ticket 23 Q14). Its
 * `getErrorMessage()` appends *"contact BTTC support at 510-926-6913 (TEXT ONLY)"* to
 * every one of its branches. That is right for a player stuck on a registration form
 * and wrong for the operator, who **is** the person you would be calling. An operator
 * console error must name what to do -- re-run the draw, take the lease back, submit
 * the group again. The cost is named rather than hidden: **two error-mapping functions
 * on one origin.** Extending the shared file was rejected because `LEASE_LOST` means
 * nothing to the other four apps; calling its globals by bare name was rejected
 * because a module cannot `import` a bare `const` from a classic script, so the
 * dependency would be invisible to `node --test` and to any reader of this file.
 *
 * **Why a factory and not a module of bare functions.** `createClient` takes its
 * `fetch`, its base URL and its two credential readers as arguments, so this module
 * touches no `window`, no `sessionStorage` and no global `fetch` at load time. That is
 * what lets `test/api.test.js` import it under `node --test` and *prove* -- rather than
 * assert by inspection -- that all eight gated mutations carry `?session_id=`. It puts
 * `api.js` on the same side of `test/README.md`'s line as `draw.js` and
 * `play-order.js`, and leaves the seven tab modules (which need `window.Vue`) on the
 * other.
 */

/** The Netlify Functions proxy. It strips this prefix and forwards the rest. */
export const DEFAULT_BASE_URL = '/.netlify/functions/api';

/**
 * The operator token header.
 *
 * `netlify/functions/api.js:197` already forwards it -- lower-case in, `X-User-Auth`
 * out -- so **auth needs no proxy change**. Ticket 04 spotted the hook as unused; it is
 * the seam ticket 13 took.
 *
 * Note the proxy's `Access-Control-Allow-Headers` (`:149`) advertises only
 * `Content-Type, Authorization` and does **not** list this header. That is not a bug to
 * fix: this app is same-origin with the proxy, so no preflight is ever issued. Adding
 * it would only matter to a cross-origin caller, of which there are none.
 */
export const AUTH_HEADER = 'x-user-auth';

/**
 * The eight mutations behind ticket 14's editor lease.
 *
 * Session 4 built seven; ticket 16's `publish` is the eighth, and the publish **dry
 * run** is gated too -- it creates real Git objects and is the rehearsal for a real
 * publish, so contention has to surface there rather than at the real one.
 *
 * `session_id` rides as a **query parameter**. The proxy forwards the query string
 * verbatim (`netlify/functions/api.js:178-183`) but only a curated header set
 * (`:189-199`), so a header would have cost a change to shared `bttc_web`
 * infrastructure to buy nothing. A body field would have forced the check out of the
 * FastAPI dependency and into every handler.
 *
 * **The three lock mutations are NOT in this list**, and that is deliberate rather than
 * an omission: `/rr/lock`, `/rr/lock/takeover` and `/rr/lock/release` carry
 * `session_id` in the JSON body (`LockRequest`), because they are how the lease is
 * acquired and cannot be gated on already holding it. Two transports, one id.
 */
export const GATED_MUTATIONS = Object.freeze([
  '/rr/draw',
  '/rr/groups/{n}/scores',
  '/rr/results',
  '/rr/roster/update',
  '/rr/roster/add',
  '/rr/roster/remove',
  '/rr/roster/promote',
  '/rr/publish',
]);

/**
 * The thirty codes of `bttc_api/helpers/errors.py`, each with the operator's remedy.
 *
 * Ticket 23 Q14 wrote **eleven** and ticket 28 corrected it: the registry has thirty,
 * and the eleven were missing `LEASE_HELD`, `REF_CONFLICT`, `NO_CHANGES`,
 * `ROSTER_FULL`, `NOT_ON_WAITLIST`, `WAITLIST_TRANSITION`, the four auth codes, ticket
 * 28 Q2's six and `INTERNAL`/`DB_BUSY`. A registry makes drift a diff instead of a
 * discovery at 8pm on a Friday -- which is the whole reason `errors.py` exists as a
 * module rather than as literals, and the reason this mirror exists at all.
 *
 * `status` is carried so the mirror can be checked against the registry's own tally
 * (409 x19, 404 x3, 401 x3, 403 x1, 503 x2, 500 x1, 200 x1). Any later ticket that
 * coins a code adds it **here and in `errors.py` in the same change**.
 */
export const WIRE_CODES = Object.freeze({
  // --- ticket 12, the five designed endpoints --------------------------------
  RATING_MOVED: { status: 409, remedy:
    'A player’s rating moved since you built this draw. Re-run the draw, then commit again.' },
  ROSTER_MISMATCH: { status: 409, remedy:
    'The roster is not what this draw was built from. Re-run the draw and commit again.' },
  SCORES_EXIST: { status: 409, remedy:
    'Scores have already been entered, so the draw cannot be re-run. Clear those groups first.' },
  DRAW_MISSING: { status: 409, remedy:
    'There is no draw yet. Commit the draw on the Draw List tab first.' },
  PLAYER_NOT_IN_GROUP: { status: 409, remedy:
    'A cell names someone this group does not seat. Check the seat, or re-load the draw.' },
  GROUPS_INCOMPLETE: { status: 409, remedy:
    'Some groups still have cells that have not been entered. Finish them, then generate results.' },
  NO_OPEN_EVENT: { status: 404, remedy:
    'There is no round robin event to read. Open tonight’s event before starting.' },

  // --- tickets 14, 15: the lease and the correction window -------------------
  LEASE_REQUIRED: { status: 409, remedy:
    'You do not hold the editor lease, so nothing was saved. Take it over to make changes.' },
  LEASE_HELD: { status: 409, remedy:
    'Someone else is running tonight’s session. Take over to continue.' },
  NOT_LATEST_SESSION: { status: 409, remedy:
    'Only the most recent session can be re-run. Correcting an older night would drag current ratings back weeks.' },

  // --- ticket 16, publishing -------------------------------------------------
  REF_CONFLICT: { status: 409, remedy:
    'GitHub refused the ref update, so nothing was published. Try again; if it repeats, check that BTTC Publisher is still on main’s bypass list.' },
  RESULTS_NOT_APPLIED: { status: 409, remedy:
    'Generate results before publishing them — the ratings and standings do not exist yet.' },
  RESULTS_STALE: { status: 409, remedy:
    'A score changed since results were generated. Re-run Generate Results, then publish.' },
  // The only 200-carrying code. See `isNoChanges` below -- this is a SUCCESS.
  NO_CHANGES: { status: 200, remedy:
    'Nothing changed — the site already serves this content. No commit was made and no build will run.' },

  // --- tickets 22, 30: roster admin and the waitlist -------------------------
  RR_STARTED: { status: 409, remedy:
    'The round robin has started. The seat and the fee stay — record the missing matches as D or 0/0.' },
  ROSTER_FULL: { status: 409, remedy:
    'The roster is full. Raise the cap on the roster counter, then try again.' },
  NOT_ON_WAITLIST: { status: 404, remedy:
    'That player is not on the waitlist — the row is absent, or they are on the roster already.' },
  WAITLIST_TRANSITION: { status: 409, remedy:
    'Use the waitlist controls to promote a player. A waitlist row holds no money and cannot be settled.' },

  // --- ticket 13, operator identity (attribution, not access control; F15) ---
  BAD_CREDENTIALS: { status: 401, remedy:
    'That phone number and PIN do not match. The two are not distinguished, so check both.' },
  NOT_OPERATOR: { status: 403, remedy:
    'That account is not a director or admin.' },
  SIGNING_SECRET_MISSING: { status: 503, remedy:
    'A signing credential is not set on the server. GET /health’s secrets block says which one.' },
  // What the re-auth overlay keys on. See `isAuthExpired` below.
  TOKEN_INVALID: { status: 401, remedy:
    'Your operator session is no longer valid. Sign in again — nothing you have typed is lost.' },

  // --- ticket 28 Q2: registered now, raised at cutover -----------------------
  // These six land with the `success: false` conversion of /rr/register,
  // /rr/unregister and /player/signup, which is an ORDERED PAIR of pushes inside
  // ticket 25's cutover window (bttc_web first). They are mirrored now so the client
  // and the server agree on the vocabulary before either speaks it. The League Manager
  // calls none of those three endpoints; PLAYER_NOT_FOUND is the exception and IS
  // raised today, by /rr/roster/update, /rr/roster/add and /rr/roster/remove.
  ALREADY_REGISTERED: { status: 409, remedy:
    'That player already has a registration for this event.' },
  EVENT_CLOSED: { status: 409, remedy:
    'The event is closed to public registration. Use the desk controls on the Roster tab.' },
  NOT_REGISTERED: { status: 409, remedy:
    'That player is not registered for this event.' },
  INVALID_PIN: { status: 401, remedy:
    'That PIN does not match.' },
  PLAYER_NOT_FOUND: { status: 404, remedy:
    'No such member — or they are not on tonight’s roster.' },
  ALREADY_SIGNED_UP: { status: 409, remedy:
    'That player has already signed up.' },

  // --- ticket 28 Q3/Q9: anywhere --------------------------------------------
  INTERNAL: { status: 500, remedy:
    'The server hit an internal error and nothing was saved. The detail is in the server log, not here.' },
  DB_BUSY: { status: 503, remedy:
    'The database was busy and nothing was saved. Try again — SQLite has already waited out its five-second timeout, so this is not a retry loop.' },
});

/**
 * `LEASE_LOST` is **not a server code**, and it must never be added to the registry.
 *
 * It appears in ticket 23 Q14's list and in no server contract anywhere -- tickets 12,
 * 14, 15, 16, 22 and 30 raise `LEASE_REQUIRED` and `LEASE_HELD`, never this. Ticket 28
 * resolved it as a **synthesised client state**: `app.js` produces it when the
 * five-second `GET /rr/lock` poll returns a holder who is not us.
 *
 * It lives in its own object rather than in `WIRE_CODES` so that the separation is
 * structural. `test/api.test.js` asserts it is absent from the wire map, which is what
 * stops a future edit from quietly folding it in and putting the mirror one code ahead
 * of `errors.py`.
 */
export const CLIENT_CODES = Object.freeze({
  LEASE_LOST: { status: null, remedy:
    'Another operator took over tonight’s session. This tab is read-only and your unsaved work is still here — take the lease back to commit it.' },
});

/** Every code the operator console can show, wire and synthesised alike. */
export function remedyFor(code) {
  const entry = WIRE_CODES[code] || CLIENT_CODES[code];
  return entry ? entry.remedy : null;
}

/** The client-synthesised code, named once so no tab spells the string itself. */
export const LEASE_LOST = 'LEASE_LOST';

/**
 * A failed call.  `code` is `null` for the three body shapes that carry none.
 *
 * `extras` holds the per-code top-level fields `api_error(**extra)` merges into the
 * body: `holder`, `user_ids`, `roster_count`/`max_capacity`,
 * `github_status`/`github_message`.
 */
export class ApiError extends Error {
  constructor({ status, code, detail, extras }) {
    const remedy = remedyFor(code);
    super(detail || remedy || ('HTTP ' + status));
    this.name = 'ApiError';
    this.status = status;
    this.code = code || null;
    this.detail = detail;
    this.remedy = remedy;
    this.extras = extras || {};
  }
}

/** True when the operator's token has expired or is missing -- raises the overlay. */
export function isAuthExpired(err) {
  return err instanceof ApiError && err.code === 'TOKEN_INVALID';
}

/** True when someone else holds the lease.  Carries `extras.holder`. */
export function isLeaseConflict(err) {
  return err instanceof ApiError
    && (err.code === 'LEASE_HELD' || err.code === 'LEASE_REQUIRED');
}

/**
 * **`NO_CHANGES` is a 200.**
 *
 * A publish that returns it is a success with no commit and no build: `POST /git/trees`
 * returned the base tree sha, so nothing differed. Idempotence, not failure -- and free
 * from the data structure, because git content-addresses trees.
 *
 * This is the trap the whole response path is shaped around. An `api.js` that treats a
 * `code` field as failure renders the idempotent case as an error, and the Finalize log
 * would print a `Failed` row for a publish that did exactly the right thing. So the
 * discriminator is `response.ok` **first**, and `code` only after.
 *
 * A real publish returns `code: null`, which is why a merely-present `code` key is not
 * the test either.
 */
export function isNoChanges(result) {
  return !!result && result.code === 'NO_CHANGES';
}

/** `?session_id=` -- ticket 14's transport, as a query parameter. */
function withSessionId(path, sessionId) {
  if (!sessionId) {
    throw new Error('a gated mutation was called with no session_id: ' + path);
  }
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'session_id=' + encodeURIComponent(sessionId);
}

/**
 * Read a response body without assuming it is JSON.
 *
 * A proxy 502 or an HTML error page would otherwise throw inside `.json()` and be
 * mislabelled as a network failure -- the exact mistake prototype 20 makes at :401.
 */
async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return { detail: text }; }
}

/**
 * Turn a non-2xx response into an `ApiError`.
 *
 * `main.py:101-123`'s flattening handler gives every registered failure a **flat**
 * body: `{"detail": "...", "code": "...", ...extras}`. No envelope, no `success` field,
 * no nested `error` object. Three shapes arrive with **no `code` at all** and each
 * needs its own branch:
 *
 * - **422** -- `{"detail": [ ...pydantic error objects... ]}`, where `detail` is an
 *   ARRAY. Nothing in the operator surface should produce one; if it does it is a
 *   client bug, so say so rather than rendering `[object Object]`.
 * - **the 24 legacy endpoints** -- `POST /events/update` is the one this app calls.
 *   They raise string details and were never converted (ticket 28 Q2 is cutover work).
 * - **a bad `X-API-Key`** -- a plain 401 `{"detail": "Invalid api key"}` from the
 *   proxy's own credential, not the operator's. It must NOT raise the re-auth overlay:
 *   signing in again cannot fix a server-side key.
 */
function toApiError(status, body) {
  if (body && Array.isArray(body.detail)) {
    return new ApiError({
      status,
      code: null,
      detail: 'The server rejected the request as malformed. This is a bug in the operator app, not something to retry.',
      extras: { validation: body.detail },
    });
  }
  const code = body && typeof body.code === 'string' ? body.code : null;
  const detail = body && typeof body.detail === 'string' ? body.detail : null;
  const extras = {};
  if (body && typeof body === 'object') {
    for (const k of Object.keys(body)) {
      if (k !== 'detail' && k !== 'code') extras[k] = body[k];
    }
  }
  return new ApiError({ status, code, detail, extras });
}

/**
 * Build the League Manager's client.
 *
 * @param {object}   opts
 * @param {Function} opts.fetchImpl     `window.fetch` in the browser, a fake in tests
 * @param {string}   [opts.baseUrl]     the proxy prefix
 * @param {Function} opts.getToken      () => the operator token, or null before login
 * @param {Function} opts.getSessionId  () => this tab's lease identity
 */
export function createClient({ fetchImpl, baseUrl = DEFAULT_BASE_URL, getToken, getSessionId }) {
  if (typeof fetchImpl !== 'function') throw new Error('createClient needs a fetch');

  async function request(method, path, { body, auth = true, gated = false } = {}) {
    const url = baseUrl + (gated ? withSessionId(path, getSessionId()) : path);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = getToken();
      // No token yet is not an error here -- the cold gate is the caller's problem.
      // Sending an absent header produces TOKEN_INVALID, which is the right answer.
      if (token) headers[AUTH_HEADER] = token;
    }
    const init = { method, headers };
    // The proxy drops bodies on anything but POST and PUT
    // (netlify/functions/api.js:204-206), so nothing here may rely on a DELETE body.
    if (body !== undefined) init.body = JSON.stringify(body);

    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (err) {
      throw new ApiError({
        status: 0,
        code: null,
        detail: 'Not saved — no connection to the server.',
        extras: { cause: String(err) },
      });
    }
    const parsed = await readBody(response);
    if (!response.ok) throw toApiError(response.status, parsed);
    return parsed;
  }

  const ev = (eventId) => (eventId == null ? {} : { event_id: eventId });

  return {
    // --- identity ----------------------------------------------------------
    // POST /rr/login is the ONE call that sends no operator token: it is what
    // issues one. It is reachable unauthenticated through the proxy by design
    // (netlify/functions/api.js:80).
    login: (phoneNumber, token) =>
      request('POST', '/rr/login', { body: { phone_number: phoneNumber, token }, auth: false }),

    // --- reads (never gated) -----------------------------------------------
    getSession: (eventId) =>
      request('GET', '/rr/session' + (eventId == null ? '' : '?event_id=' + eventId)),
    getMembers: () => request('GET', '/rr/members'),
    getLock: (eventId) =>
      request('GET', '/rr/lock' + (eventId == null ? '' : '?event_id=' + eventId)),
    /**
     * The page a `results` publish would commit, rendered but not pushed. Ticket 33.
     *
     * `{scope, path, html, bytes}`, from the same renderer `POST /rr/publish` uses, so
     * what the operator approves is what goes up.
     *
     * **A read, so it is NOT in `GATED_MUTATIONS`** -- it creates no Git object and
     * makes no network call, which is what lets the read-only operator look at the page
     * too. Its neighbour the publish dry run *is* gated, because that one does create
     * objects; the distinction is about writes, not about publishing.
     *
     * It refuses on exactly the codes publish refuses on, so if this returns the
     * operator has one fewer surprise waiting at Step 2.
     */
    previewResultsPage: (eventId) =>
      request('GET', '/rr/publish/preview'
                     + (eventId == null ? '' : '?event_id=' + eventId)),

    // --- the lease: session_id in the BODY, not the query -------------------
    // These three cannot be gated on holding the lease; they are how it is held.
    acquireLock: (eventId) =>
      request('POST', '/rr/lock', { body: { ...ev(eventId), session_id: getSessionId() } }),
    takeoverLock: (eventId) =>
      request('POST', '/rr/lock/takeover', { body: { ...ev(eventId), session_id: getSessionId() } }),
    releaseLock: (eventId) =>
      request('POST', '/rr/lock/release', { body: { ...ev(eventId), session_id: getSessionId() } }),

    // --- member creation (not gated: it touches no event) -------------------
    // Returns {user_id} and NO possible_duplicates -- the duplicate warning is
    // client-side and pre-commit (ticket 21 Q7). Never 409s on a name.
    createMember: (member) => request('POST', '/rr/member', { body: member }),

    // --- the eight gated mutations -----------------------------------------
    commitDraw: (groups, settings, eventId) =>
      request('POST', '/rr/draw', { gated: true, body: { ...ev(eventId), groups, settings } }),
    submitScores: (groupOrdinal, cells, eventId) =>
      request('POST', '/rr/groups/' + groupOrdinal + '/scores',
              { gated: true, body: { ...ev(eventId), cells } }),
    generateResults: (eventId) =>
      request('POST', '/rr/results', { gated: true, body: { ...ev(eventId) } }),
    updateRosterRow: (patch, eventId) =>
      request('POST', '/rr/roster/update', { gated: true, body: { ...ev(eventId), ...patch } }),
    addToRoster: (userId, paymentMethod, notes, eventId) =>
      request('POST', '/rr/roster/add',
              { gated: true, body: { ...ev(eventId), user_id: userId,
                                     payment_method: paymentMethod, notes: notes ?? null } }),
    removeFromRoster: (userId, eventId) =>
      request('POST', '/rr/roster/remove', { gated: true, body: { ...ev(eventId), user_id: userId } }),
    promoteFromWaitlist: (userId, eventId) =>
      request('POST', '/rr/roster/promote', { gated: true, body: { ...ev(eventId), user_id: userId } }),
    // The DRY RUN is gated too (ticket 16 Q7) -- same endpoint, same query param.
    publish: (scope, { dryRun = false, eventId } = {}) =>
      request('POST', '/rr/publish',
              { gated: true, body: { ...ev(eventId), scope, dry_run: dryRun } }),

    // --- the one legacy endpoint this app calls -----------------------------
    /**
     * The editable roster counter (`58 / [ 60 ]`), ticket 30 Q2.
     *
     * **`announcement_notes: null` is load-bearing and must not be dropped.**
     * `UpdateEventRequest` declares it `Optional[str] = ''`, not `None`, and
     * `event_service.py:225-226` writes it whenever it `is not None` -- so **omitting
     * the field blanks the club's announcement notes.** No endpoint returns the
     * current value (`/events/all` responds with `OpenEventResponse`, which omits it),
     * so the client cannot round-trip it either. Sending an explicit `null` is what
     * makes `is not None` false and leaves the column alone. No server change needed.
     *
     * `status` is deliberately NOT sent. `UpdateEventRequest` accepts it, and
     * surfacing it here would hand the client a way to reopen a CLOSED event and undo
     * ticket 15's freeze -- where `POST /rr/draw` closing the event IS "Lock Out
     * Changes".
     *
     * Refuses with 409 ROSTER_FULL rather than lowering the cap below the people
     * already seated -- the port's ninth modification to existing behaviour. Note its
     * `max_capacity` extra is **the value you asked for**, while /roster/add's and
     * /roster/promote's is the event's current cap.
     */
    setMaxCapacity: (eventId, maxCapacity) =>
      request('POST', '/events/update',
              { body: { event_id: eventId, max_capacity: maxCapacity, announcement_notes: null } }),

    /**
     * The member edit form, ticket 30 Q16.
     *
     * `PUT /player/{id}` shallow-merges `details`, which is where `age_status` lives --
     * session 4 put it on `users.details["age_status"]` rather than on a column, so
     * **the edit form needs no server change**. It sits beside `initial_rating` and
     * `rating_survey`, which are already there.
     *
     * **Three fields the request model accepts and this function will not send.**
     * `UpdatePlayerRequest` declares `token`, `role` and `is_active`, and the proxy
     * allowlists this route:
     *
     * - **`token`** is the member's six-digit PIN, and ticket 30 Q16 ships no control
     *   for it. The client could not display one anyway -- ticket 13 dropped `token`
     *   from `PlayerDbSearchResponse` and from `to_dict`'s 'all' list. The cost is
     *   named rather than absorbed: `POST /rr/login` must refuse `token == "123456"`,
     *   the default written for every member who signs up without supplying one, so a
     *   member promoted to director mid-season **cannot log in** and the desk has no
     *   way to fix it (**F30**).
     * - **`role`** is what the three-request bypass writes (13 Q2b). Not ours to send.
     * - **`is_active`** is ticket 31's soft delete, which has its own path.
     *
     * `model_config = ConfigDict(extra="forbid")`, so an unknown key is a 422 rather
     * than a silent no-op -- which is why the caller passes a fixed shape and not a
     * spread. `phone_number` is coerced to `int` server-side and must be ten digits.
     */
    updateMember: (userId, { firstName, lastName, phoneNumber, email, latestRating, ageStatus }) => {
      const body = {};
      if (firstName != null) body.first_name = firstName;
      if (lastName != null) body.last_name = lastName;
      if (phoneNumber != null) body.phone_number = String(phoneNumber).replace(/\D/g, '');
      if (email != null) body.email = email;
      if (latestRating != null) body.latest_rating = latestRating;
      // Shallow-merged, so this does not disturb initial_rating or rating_survey.
      if (ageStatus != null) body.details = { age_status: ageStatus };
      return request('PUT', '/player/' + userId, { body });
    },

    /** Exposed for the unload path, which needs the URL and headers without a promise. */
    _describeRelease: (eventId) => ({
      url: baseUrl + '/rr/lock/release',
      headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: getToken() || '' },
      body: JSON.stringify({ ...ev(eventId), session_id: getSessionId() }),
    }),
  };
}
