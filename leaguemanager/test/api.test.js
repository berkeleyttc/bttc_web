/**
 * `api.js` -- the eight gated mutations, the thirty-code mirror, and the NO_CHANGES trap.
 *
 * These are the assertions ticket 23 Q14 and ticket 28 turned into requirements, and
 * they are checkable here only because `createClient` takes its `fetch` as an argument.
 * A module that reached for `window.fetch` and `sessionStorage` at load time would have
 * left "every gated mutation sends ?session_id=" as a claim to be verified by reading
 * the file -- which is exactly how the count drifted from eight to seven in the first
 * place.
 *
 *   node --test 'leaguemanager/test/*.test.js'
 *
 * Quote the glob. Node 24 resolves a bare directory argument as a module path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createClient, WIRE_CODES, CLIENT_CODES, GATED_MUTATIONS, AUTH_HEADER,
  ApiError, isNoChanges, isAuthExpired, isLeaseConflict, remedyFor, LEASE_LOST,
} from '../api.js';

const SESSION_ID = 'tab-7f3a9c';
const TOKEN = 'eyJhbGciOiJmYWtlIn0.c2ln';

/** Records every call and replies with whatever the test queued. */
function harness(reply = { status: 200, body: {} }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => (reply.raw !== undefined ? reply.raw : JSON.stringify(reply.body)),
    };
  };
  const client = createClient({
    fetchImpl,
    baseUrl: '/.netlify/functions/api',
    getToken: () => TOKEN,
    getSessionId: () => SESSION_ID,
  });
  return { calls, client };
}

/** Drive every gated mutation once, in the order GATED_MUTATIONS declares them. */
function callEveryGatedMutation(client) {
  return [
    ['/rr/draw', () => client.commitDraw([], { table_count: 20, promotion_gap: 150 })],
    ['/rr/groups/{n}/scores', () => client.submitScores(6, [])],
    ['/rr/results', () => client.generateResults()],
    ['/rr/roster/update', () => client.updateRosterRow({ user_id: 1, status: 'confirmed' })],
    ['/rr/roster/add', () => client.addToRoster(1, 'cash')],
    ['/rr/roster/remove', () => client.removeFromRoster(1)],
    ['/rr/roster/promote', () => client.promoteFromWaitlist(1)],
    ['/rr/publish', () => client.publish('results')],
  ];
}

describe('the lease rides as ?session_id= on the gated mutations', () => {
  it('names exactly eight of them, and publish is the eighth', () => {
    // Session 4 built seven; ticket 16's publish is the eighth. Ticket 23 Q14's list
    // predates both and is not the authority here.
    assert.equal(GATED_MUTATIONS.length, 8);
    assert.ok(GATED_MUTATIONS.includes('/rr/publish'));
  });

  it('sends it on every one of the eight', async () => {
    // Driven one call at a time so each recorded URL is unambiguous.
    const missing = [];
    for (const entry of GATED_MUTATIONS) {
      const { calls, client } = harness();
      const runner = callEveryGatedMutation(client).find(([n]) => n === entry);
      assert.ok(runner, 'no runner for ' + entry);
      await runner[1]();
      assert.equal(calls.length, 1, entry + ' made ' + calls.length + ' calls');
      if (!calls[0].url.includes('?session_id=' + SESSION_ID)) missing.push(entry);
    }
    assert.deepEqual(missing, [], 'these gated mutations sent no session_id');
  });

  it('gates the publish DRY RUN too — it creates real Git objects', async () => {
    const { calls, client } = harness();
    await client.publish('brackets', { dryRun: true });
    assert.ok(calls[0].url.includes('?session_id=' + SESSION_ID));
    assert.equal(calls[0].body.dry_run, true);
  });

  it('refuses to make a gated call with no session_id rather than sending a bare URL', async () => {
    const client = createClient({
      fetchImpl: async () => { throw new Error('should never be reached'); },
      getToken: () => TOKEN,
      getSessionId: () => null,
    });
    await assert.rejects(() => client.generateResults(), /no session_id/);
  });
});

describe('the three lock mutations use the BODY, not the query string', () => {
  // They are how the lease is acquired, so they cannot be gated on holding it.
  // Two transports, one id -- the easiest thing in this file to get backwards.
  const locks = [
    ['/rr/lock', (c) => c.acquireLock()],
    ['/rr/lock/takeover', (c) => c.takeoverLock()],
    ['/rr/lock/release', (c) => c.releaseLock()],
  ];

  for (const [path, call] of locks) {
    it(path + ': session_id in the body and not in the URL', async () => {
      const { calls, client } = harness();
      await call(client);
      assert.equal(calls[0].url, '/.netlify/functions/api' + path);
      assert.ok(!calls[0].url.includes('session_id'), 'session_id leaked into the query');
      assert.equal(calls[0].body.session_id, SESSION_ID);
    });
  }

  it('none of the three is listed as a gated mutation', () => {
    for (const [path] of locks) assert.ok(!GATED_MUTATIONS.includes(path));
  });
});

describe('the thirty-code mirror of helpers/errors.py', () => {
  it('holds exactly thirty wire codes', () => {
    // errors.py's REGISTRY is pinned at thirty by tests/test_errors_registry.py.
    // Any later ticket that coins a code adds it to BOTH in the same change.
    assert.equal(Object.keys(WIRE_CODES).length, 30);
  });

  it('matches the registry’s status breakdown', () => {
    // 409 x19, 404 x3, 401 x3, 403 x1, 503 x2, 500 x1, 200 x1 -- errors.py:119-124.
    // Ticket 28 Q1's own parenthetical says "409 x18 ... = 30", which sums to 29; its
    // table lists nineteen. Thirty is the load-bearing number and the breakdown below
    // is the corrected one.
    const tally = {};
    for (const entry of Object.values(WIRE_CODES)) {
      tally[entry.status] = (tally[entry.status] || 0) + 1;
    }
    assert.deepEqual(tally, { 409: 19, 404: 3, 401: 3, 403: 1, 503: 2, 500: 1, 200: 1 });
  });

  it('gives every code an operator remedy that never offers a phone number', () => {
    // Ticket 23 Q14's substantive reason for not extending js/bttc-utils.js:
    // getErrorMessage() appends "contact BTTC support at 510-926-6913 (TEXT ONLY)" to
    // every branch, and the operator IS the person you would be calling.
    for (const [code, entry] of Object.entries(WIRE_CODES)) {
      assert.ok(entry.remedy && entry.remedy.length > 10, code + ' has no remedy');
      assert.ok(!/926-6913|BTTC support/.test(entry.remedy),
        code + ' offers the operator the support phone number');
    }
  });

  it('keeps LEASE_LOST out of the wire vocabulary and reachable as a client one', () => {
    // It is produced by no endpoint anywhere: app.js synthesises it when the 5s
    // GET /rr/lock poll returns a holder who is not us (ticket 28 Corrections 6).
    // Folding it in would put this mirror one code ahead of errors.py.
    assert.equal(WIRE_CODES[LEASE_LOST], undefined);
    assert.ok(CLIENT_CODES[LEASE_LOST]);
    assert.ok(remedyFor(LEASE_LOST));
    assert.equal(CLIENT_CODES[LEASE_LOST].status, null, 'a synthesised code has no HTTP status');
  });

  it('does not register the six codes as raised by anything this app calls', () => {
    // Ticket 28 Q2's conversion is cutover work and rewrites registration/, signup/
    // and roster/ -- not this app. They are mirrored so the vocabulary agrees before
    // either side speaks it.
    for (const code of ['ALREADY_REGISTERED', 'EVENT_CLOSED', 'NOT_REGISTERED',
                        'INVALID_PIN', 'ALREADY_SIGNED_UP']) {
      assert.ok(WIRE_CODES[code], code + ' is missing from the mirror');
    }
  });
});

describe('NO_CHANGES is a 200 and a success', () => {
  it('resolves rather than throwing', async () => {
    // An api.js that treats a `code` field as failure renders the idempotent publish
    // as an error, and Finalize prints a Failed row for a publish that did exactly the
    // right thing. The discriminator is response.ok FIRST, then code.
    const { client } = harness({
      status: 200,
      body: { code: 'NO_CHANGES', scope: 'sleep', dry_run: false,
              commit_sha: null, base_commit_sha: 'abc123', files_written: [], files_deleted: [] },
    });
    const result = await client.publish('sleep');
    assert.equal(result.code, 'NO_CHANGES');
    assert.ok(isNoChanges(result));
  });

  it('is the only registered code carrying a 200', () => {
    const twoHundreds = Object.entries(WIRE_CODES)
      .filter(([, e]) => e.status === 200).map(([c]) => c);
    assert.deepEqual(twoHundreds, ['NO_CHANGES']);
  });

  it('does not mistake a real publish (code: null) for it', async () => {
    const { client } = harness({
      status: 200,
      body: { code: null, scope: 'results', commit_sha: 'def456', files_written: ['a'] },
    });
    const result = await client.publish('results');
    assert.equal(isNoChanges(result), false);
  });
});

describe('the operator token', () => {
  it('rides on x-user-auth, which the proxy already forwards', async () => {
    const { calls, client } = harness();
    await client.getSession();
    assert.equal(calls[0].init.headers[AUTH_HEADER], TOKEN);
  });

  it('is NOT sent on POST /rr/login — that is the call that issues one', async () => {
    const { calls, client } = harness({ status: 200, body: { token: 'x' } });
    await client.login('4085551212', '482913');
    assert.equal(calls[0].init.headers[AUTH_HEADER], undefined);
  });
});

describe('the error body shapes, including the three that carry no code', () => {
  it('maps a flat {detail, code, ...extras} onto a remedy', async () => {
    const { client } = harness({
      status: 409,
      body: { detail: 'Another operator is running tonight’s session.', code: 'LEASE_HELD',
              holder: { user_id: 7, first_name: 'Jane', last_name: 'Doe' } },
    });
    const err = await client.acquireLock().then(() => null, (e) => e);
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'LEASE_HELD');
    assert.equal(err.extras.holder.first_name, 'Jane');
    assert.ok(isLeaseConflict(err));
    assert.ok(err.remedy.includes('Take over'));
  });

  it('raises the re-auth overlay on TOKEN_INVALID and NOT on a bad API key', async () => {
    // A bad X-API-Key is the proxy's own credential, not the operator's, and comes
    // back as a plain 401 with no code. Signing in again cannot fix it, so it must
    // not raise the overlay.
    const expired = harness({ status: 401, body: { detail: 'x', code: 'TOKEN_INVALID' } });
    const badKey = harness({ status: 401, body: { detail: 'Invalid api key' } });
    const a = await expired.client.getSession().then(() => null, (e) => e);
    const b = await badKey.client.getSession().then(() => null, (e) => e);
    assert.ok(isAuthExpired(a));
    assert.equal(isAuthExpired(b), false);
    assert.equal(b.code, null);
    assert.equal(b.detail, 'Invalid api key');
  });

  it('handles a 422, whose detail is an ARRAY and which carries no code', async () => {
    const { client } = harness({
      status: 422,
      body: { detail: [{ loc: ['body', 'scope'], msg: 'unexpected value', type: 'value_error' }] },
    });
    const err = await client.publish('nonsense').then(() => null, (e) => e);
    assert.equal(err.code, null);
    assert.ok(Array.isArray(err.extras.validation));
    assert.ok(!/\[object Object\]/.test(err.message));
  });

  it('handles a legacy string detail with no code', async () => {
    const { client } = harness({
      status: 409, body: { detail: 'An OPEN event for this type and date already exists.' },
    });
    const err = await client.setMaxCapacity(41, 60).then(() => null, (e) => e);
    assert.equal(err.code, null);
    assert.equal(err.detail, 'An OPEN event for this type and date already exists.');
  });

  it('does not mislabel a non-JSON error page as a network failure', async () => {
    // prototype 20 does exactly this at :401 -- await r.json() throws on an HTML
    // proxy error and the catch reports it as NETWORK.
    const { client } = harness({ status: 502, raw: '<html>Bad Gateway</html>' });
    const err = await client.getSession().then(() => null, (e) => e);
    assert.equal(err.status, 502);
    assert.ok(err.detail.includes('Bad Gateway'));
  });

  it('reports a genuine transport failure as status 0', async () => {
    const client = createClient({
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
      getToken: () => TOKEN, getSessionId: () => SESSION_ID,
    });
    const err = await client.getSession().then(() => null, (e) => e);
    assert.equal(err.status, 0);
    assert.ok(err.detail.includes('no connection'));
  });
});

describe('PUT /player/{id} — the member edit form', () => {
  it('never sends role or is_active', async () => {
    // UpdatePlayerRequest accepts both and the proxy allowlists the route. `role` is what
    // ticket 13 Q2b's three-request bypass writes; `is_active` is ticket 31's soft delete,
    // which has its own path. **`token` used to be on this list** and came off when F30
    // shipped the PIN field — see the three cases below, which are what replaced it.
    const { calls, client } = harness();
    await client.updateMember(812, {
      firstName: 'Jane', lastName: 'Doe', phoneNumber: '(510) 555-1212',
      email: 'j@x.com', latestRating: 1740, ageStatus: 'senior',
    });
    for (const forbidden of ['role', 'is_active']) {
      assert.equal(forbidden in calls[0].body, false, forbidden + ' must never be sent');
    }
  });

  it('omits token entirely when the PIN field was left blank — blank means unchanged', async () => {
    // The field can never show the current PIN (ticket 13 dropped `token` from
    // PlayerDbSearchResponse), so sending '' would blank a credential the operator never
    // saw. The `!= null` idiom the other five fields use would do exactly that.
    const { calls, client } = harness();
    await client.updateMember(812, { firstName: 'Jane', token: '' });
    assert.equal('token' in calls[0].body, false);
    await client.updateMember(812, { firstName: 'Jane', token: '   ' });
    assert.equal('token' in calls[1].body, false);
    await client.updateMember(812, { firstName: 'Jane', token: null });
    assert.equal('token' in calls[2].body, false);
  });

  it('sends token when the desk sets one — F30, the only way to unlock a new director', async () => {
    // POST /rr/login refuses the "123456" default every member carries, so without this
    // a member promoted to director after cutover cannot sign in at all.
    const { calls, client } = harness();
    await client.updateMember(812, { token: '481902' });
    assert.deepEqual(Object.keys(calls[0].body), ['token']);
    assert.equal(calls[0].body.token, '481902');
  });

  it('refuses an unusable PIN before the request leaves, never at the server', async () => {
    // The form disables Save on the same rule, so this arm is the second lock: a bug in
    // the tab must not be able to write a PIN that provably cannot sign in. Defects #10,
    // #19 and #20 were all a state whose remedy could not reach it — this is that shape
    // caught on the way in.
    for (const [bad, expected] of [
      ['12345', /six digits/],
      ['012345', /cannot start with/],
      ['123456', /sign-in refuses it|sign in/],
    ]) {
      const { calls, client } = harness();
      const err = await client.updateMember(812, { token: bad }).then(() => null, (e) => e);
      assert.ok(err instanceof ApiError, bad + ' must throw');
      assert.equal(err.status, 0, bad + ' never reached the network');
      assert.match(err.detail, expected);
      assert.equal(calls.length, 0, bad + ' must send nothing at all');
    }
  });

  it('strips non-digits from the phone number, which the server requires as 10 digits', () => {
    const { calls, client } = harness();
    return client.updateMember(812, { phoneNumber: '(510) 555-1212' }).then(() => {
      assert.equal(calls[0].body.phone_number, '5105551212');
    });
  });

  it('sends age_status inside details, which the server shallow-merges', async () => {
    // Session 4 put it on users.details["age_status"] rather than on a column, so the
    // edit form needs no server change. The merge is what keeps initial_rating and
    // rating_survey, which already live there.
    const { calls, client } = harness();
    await client.updateMember(812, { ageStatus: 'youth' });
    assert.deepEqual(calls[0].body.details, { age_status: 'youth' });
  });

  it('omits every field the caller did not supply — extra is forbidden server-side', async () => {
    const { calls, client } = harness();
    await client.updateMember(812, { latestRating: 1800 });
    assert.deepEqual(Object.keys(calls[0].body), ['latest_rating']);
  });
});

describe('POST /events/update — the editable roster counter', () => {
  it('always sends announcement_notes: null, or it blanks the club’s notes', async () => {
    // UpdateEventRequest declares it Optional[str] = '' (not None), and
    // event_service.py:225-226 writes it whenever it `is not None`. No endpoint
    // returns the current value -- /events/all responds with OpenEventResponse, which
    // omits the field -- so the client cannot round-trip it. An explicit null makes
    // `is not None` false and leaves the column alone.
    const { calls, client } = harness();
    await client.setMaxCapacity(41, 62);
    assert.ok('announcement_notes' in calls[0].body, 'the field must be present');
    assert.equal(calls[0].body.announcement_notes, null);
  });

  it('never sends status — that would reopen a CLOSED event', async () => {
    // UpdateEventRequest accepts it, and POST /rr/draw closing the event IS ticket
    // 15's "Lock Out Changes". Surfacing it here would hand the client the undo.
    const { calls, client } = harness();
    await client.setMaxCapacity(41, 62);
    assert.equal('status' in calls[0].body, false);
  });

  it('is not a gated mutation — it predates the lease and takes no session_id', async () => {
    const { calls, client } = harness();
    await client.setMaxCapacity(41, 62);
    assert.ok(!calls[0].url.includes('session_id'));
  });
});
