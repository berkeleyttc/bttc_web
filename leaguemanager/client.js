/**
 * `client.js` -- the one live `api.js` client, wired to the browser.
 *
 * `api.js` takes its `fetch`, its base URL and its credential readers as arguments so
 * that `node --test` can drive it. **Something still has to supply the real ones**, and
 * this is the smallest module that can: `app.js` imports the seven tabs, so a tab
 * importing the client back from `app.js` would be a cycle whose only defence is that
 * nothing touches the binding during module evaluation. That works, right up until
 * someone adds a top-level call.
 *
 * An addition to ticket 23 Q16's manifest, like `persist.js` and `search.js`, and for
 * the same kind of reason: the manifest names what must exist, not what may not.
 */
import { createClient } from './api.js';
import { sessionId as readOrMakeSessionId, readAuth } from './persist.js';

/**
 * This tab's lease identity (ticket 14 Q6), generated once and never cleared.
 *
 * Generated **here**, at module scope, rather than inside the app's `setup()`: the
 * lease is keyed `{user_id, session_id}` and a second `createApp` on the same page
 * must not mint a second identity for the same tab.
 */
function randomHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const tabSessionId = readOrMakeSessionId(window.sessionStorage, randomHex);

/**
 * Credentials are read through closures rather than captured, so a re-auth swaps the
 * token underneath every caller without rebuilding anything that holds one. That is
 * what lets the overlay leave the app mounted.
 */
export const api = createClient({
  fetchImpl: (...args) => window.fetch(...args),
  getToken: () => (readAuth(window.sessionStorage) || {}).token || null,
  getSessionId: () => tabSessionId,
});
