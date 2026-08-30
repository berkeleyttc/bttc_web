/**
 * The Netlify proxy's path allowlist.  Ticket 13 Q2.
 *
 * This file exists because the change it guards is the one thing in the League Manager
 * port that can break the club's LIVE PUBLIC SITE. Before it there was no allowlist at
 * all -- `netlify/functions/api.js` stripped the function prefix with a bare
 * `String.replace` and forwarded whatever was left -- so this is a new function body on a
 * file serving four existing apps, not an edit to an existing list. Ticket 13 handed the
 * "must be tested against registration/, roster/, signup/ and admin/" property to ticket
 * 25; this is that test, run early rather than at cutover.
 *
 * Every "in use today" case below was MEASURED off the four apps by sweeping for paths
 * that follow a template interpolation, not remembered. That mattered: `admin/events.js`
 * builds its URLs with `${getApiUrl()}` while the other three use `${apiUrl}`, so a sweep
 * keyed on the variable name missed the whole Events panel -- three endpoints that open
 * and close the club's Friday event.
 *
 * Run: node --test 'leaguemanager/test/*.test.js'   (quote the glob; Node 24 resolves a
 * bare directory as a module path).
 */
const test = require('node:test');
const assert = require('node:assert');

// The proxy validates its env at import time and throws without these.
process.env.BTTC_API_URL = process.env.BTTC_API_URL || 'http://example.invalid';
process.env.BTTC_API_KEY = process.env.BTTC_API_KEY || 'test-key';

const { ALLOWED_ROUTES, normalisePath, isAllowed } =
  require('../../netlify/functions/api.js');

const P = '/.netlify/functions/api';

function allowed(method, rawPath) {
  const path = normalisePath(rawPath);
  return path !== null && isAllowed(method, path);
}

// --------------------------------------------------------------- what must keep working
test('every path the four live apps call is permitted', () => {
  const inUseToday = [
    // roster/roster.js, admin/admin.js
    ['GET', `${P}/rr/roster`],
    ['GET', `${P}/rr/roster?include_id=true`.split('?')[0]],
    // registration/registration.js
    ['GET', `${P}/rr/search`],
    ['POST', `${P}/rr/capacity`],
    ['POST', `${P}/rr/register`],
    ['POST', `${P}/rr/unregister`],
    // admin/admin.js, admin/audit.js
    ['POST', `${P}/rr/registration/confirm`],
    ['GET', `${P}/rr/registration-audit`],
    // admin/events.js -- the panel that opens and closes the Friday event
    ['POST', `${P}/events/all`],
    ['POST', `${P}/events/open`],
    ['POST', `${P}/events/close`],
    // signup/signup.js
    ['GET', `${P}/player/search`],
    ['POST', `${P}/player/signup`],
  ];
  for (const [method, path] of inUseToday) {
    assert.ok(allowed(method, path),
      `${method} ${path} is used by a live app and would now 404 at the proxy`);
  }
});

test('the League Manager router is reachable, login included', () => {
  const lm = [
    ['POST', `${P}/rr/login`],            // must work with no operator token at all
    ['GET', `${P}/rr/session`],
    ['POST', `${P}/rr/draw`],
    ['POST', `${P}/rr/groups/1/scores`],
    ['POST', `${P}/rr/groups/10/scores`],
    ['POST', `${P}/rr/results`],
    ['POST', `${P}/rr/roster/update`],
  ];
  for (const [method, path] of lm) {
    assert.ok(allowed(method, path), `${method} ${path} must reach the API`);
  }
});

test('the reserved slots are listed, so landing one is not also a proxy bug', () => {
  const reserved = [
    ['GET', `${P}/rr/lock`], ['POST', `${P}/rr/lock`],
    ['POST', `${P}/rr/lock/takeover`], ['POST', `${P}/rr/lock/release`],
    ['POST', `${P}/rr/publish`],
    ['GET', `${P}/rr/members`], ['POST', `${P}/rr/member`],
    ['POST', `${P}/rr/roster/add`], ['POST', `${P}/rr/roster/remove`],
    ['POST', `${P}/rr/roster/promote`],
  ];
  for (const [method, path] of reserved) {
    assert.ok(allowed(method, path), `${method} ${path}`);
  }
});

// The ninth slot, and the endpoint it is NOT. Asserted here rather than folded into the
// list above because the pair is the documentation: preview says "these are the bytes",
// which the server has just rendered; status would have said "the site is live", which
// nothing in the port can support. Ticket 26 removed status; ticket 33 added preview.
test('the preview is reachable and the status endpoint is still not', () => {
  assert.ok(allowed('GET', `${P}/rr/publish/preview`),
    'GET /rr/publish/preview must reach the API or the Finalize tab cannot show the page');
  assert.ok(!allowed('GET', `${P}/rr/publish/status`),
    'ticket 26 removed the status endpoint from the surface; it is not deferred');
  // Preview is a read. Nothing may reach it as a write.
  assert.ok(!allowed('POST', `${P}/rr/publish/preview`));
});

// ------------------------------------------------------------- what ticket 13 closed
test('the four leaked routes are gone from the public internet', () => {
  const closed = [
    ['POST', `${P}/users/export`],
    ['POST', `${P}/users/import`],
    ['POST', `${P}/users/bulk-update`],
    ['POST', `${P}/users/bulk-update/file`],
    ['GET', `${P}/refresh/all`],
  ];
  for (const [method, path] of closed) {
    assert.ok(!allowed(method, path),
      `${method} ${path} is still reachable; ticket 13 Q2 closed it`);
  }
});

// ------------------------------------------------- what ticket 13 deliberately KEPT open
test('the accepted bypass stays open, because ticket 13 Q2b decided so', () => {
  // db/search?role=director -> PUT a known PIN -> login yields an operator session with
  // no credential. Recorded as F15. Dropping PUT would remove the only route that can
  // ever change a PIN, for the nine operators and every member. Do not "fix" this here.
  assert.ok(allowed('GET', `${P}/player/db/search`));
  assert.ok(allowed('PUT', `${P}/player/1001`));
  assert.ok(allowed('DELETE', `${P}/player/1001`));
});

// ------------------------------------------------------------------ the matcher itself
test('traversal is refused rather than resolved', () => {
  // The old handler used a bare String.replace, so this would have been forwarded
  // verbatim. An allowlist that matches an un-normalised path is not an allowlist.
  const attacks = [
    `${P}/player/db/search/../../users/export`,
    `${P}/rr/roster/../../users/export`,
    `${P}/../users/export`,
    `${P}/rr/%2e%2e/%2e%2e/users/export`,
  ];
  for (const path of attacks) {
    assert.strictEqual(normalisePath(path), null, `traversal not refused: ${path}`);
  }
});

test('normalisation collapses empty segments and dots without changing meaning', () => {
  assert.strictEqual(normalisePath(`${P}//rr//roster/`), '/rr/roster');
  assert.strictEqual(normalisePath(`${P}/rr/./roster`), '/rr/roster');
  assert.strictEqual(normalisePath(`${P}`), '/');
  assert.strictEqual(normalisePath(`${P}/`), '/');
});

test('a permitted path on the wrong method is not permitted', () => {
  assert.ok(!allowed('POST', `${P}/rr/roster`));   // GET only; POST /rr/roster is not a route
  assert.ok(!allowed('GET', `${P}/rr/draw`));      // POST only
  assert.ok(!allowed('DELETE', `${P}/rr/session`));
});

test('a single-segment wildcard does not swallow extra segments', () => {
  assert.ok(allowed('PUT', `${P}/player/1001`));
  assert.ok(!allowed('PUT', `${P}/player/1001/token`));
  assert.ok(!allowed('PUT', `${P}/player`));
});

test('nothing unlisted gets through, including plausible near-misses', () => {
  const notRoutes = [
    ['GET', `${P}/`],
    ['GET', `${P}/health`],
    ['GET', `${P}/metrics`],
    ['GET', `${P}/openapi.json`],
    ['GET', `${P}/docs`],
    ['POST', `${P}/rr/finalize`],       // dropped by ticket 15 Q5
    ['GET', `${P}/rr/publish/status`],  // removed by ticket 26, not deferred
  ];
  for (const [method, path] of notRoutes) {
    assert.ok(!allowed(method, path), `${method} ${path} should not be proxied`);
  }
});

test('the list is well formed', () => {
  for (const entry of ALLOWED_ROUTES) {
    assert.strictEqual(entry.length, 2);
    const [method, pattern] = entry;
    assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(method), method);
    assert.ok(pattern.startsWith('/'), pattern);
    assert.ok(!pattern.endsWith('/'), pattern);
  }
  const seen = new Set();
  for (const [method, pattern] of ALLOWED_ROUTES) {
    const key = `${method} ${pattern}`;
    assert.ok(!seen.has(key), `duplicate entry: ${key}`);
    seen.add(key);
  }
});
