/**
 * `app.js` -- the shell: the login gate, the tab strip, hash routing, the member load
 * and the editor lease.
 *
 * Ticket 23 Q2 put seven `v-if` tabs on one page rather than seven pages, and three
 * resolved tickets are what make seven pages actively wrong rather than merely
 * inconvenient: ticket 21 loads all 1,143 members **once at mount** (seven pages means
 * seven loads); ticket 14 acquires the lease **explicitly at mount** and polls it for
 * the app's lifetime; ticket 19 Q15 has two banners that must follow the operator
 * **out of** the Scores view. So the shell owns the member list, the lease and the
 * banners, and the tabs are panels beneath them -- `admin/shell.js:210-212`'s shape,
 * extended from three to seven.
 *
 * **This file copies `admin/shell.js`'s SHAPE and not its AUTH, and the difference is
 * not cosmetic.** `netlify/functions/admin-login.js` mints a random hex token that
 * **nothing anywhere verifies**, with hardcoded `admin`/`bttc2024` fallbacks, and
 * `shell.js` only ever checks its expiry client-side. `POST /rr/login` is HMAC-signed
 * with a Fly secret and verified on **every** request (ticket 13). `admin/` is not
 * migrated (13 Q8, F16), so the site ships two login systems on one origin, and a
 * reader comparing the two files would otherwise assume one of them is wrong.
 *
 * What that login is NOT: access control. Ticket 13 Q2b and Q5 record a live
 * three-request bypass -- `token` stays writable through `PUT /player/{id}` and the
 * proxy allowlist permits it, so `db/search?role=director` -> `PUT` -> `login` yields
 * an operator session with no credential. The login, the role check and the HMAC are
 * **attribution**, and effective access control is F15.
 */
const { createApp, ref, computed, watch, onMounted, onUnmounted } = window.Vue;

import { isAuthExpired, LEASE_LOST, remedyFor, ApiError } from './api.js';
import { api, tabSessionId } from './client.js';
import { readAuth, writeAuth, clearAuth, readDraft, readDraw } from './persist.js';
import {
  session, applySession, members, lock, applyLock, drafts, ui,
  isReadOnly, drawCommitted, eventId, staleBanner, redrawBanner,
} from './store.js';

import { RosterTab } from './tabs/roster.js';
import { DrawTab } from './tabs/draw.js';
import { PrintingTab } from './tabs/printing.js';
import { ScoresTab } from './tabs/scores.js';
import { FinalizeTab } from './tabs/finalize.js';
import { ResultsTab } from './tabs/results.js';
import { SettingsTab } from './tabs/settings.js';

/**
 * Ticket 23 Q19: the design's labels and order, with the keys renamed.
 *
 * The inversion is retired. `League Manager.dc.html:1285-1293` has `finalize` labelled
 * *Printing* and `push` labelled *Finalize* -- a fossil of the v2->v3 rename, where the
 * tab was called *Finalize* when the key was written and was then relabelled without
 * renaming the key. The design's own help text already refers to it by label (`:536`),
 * so the code was the only thing still inverted.
 *
 * **The order is kept, including Finalize sitting before Results.** It is the real
 * Friday-night sequence -- sheets are printed before anything is scored, and results
 * are generated on Finalize before the Results tab has anything to display.
 */
const TABS = [
  { key: 'roster', label: 'Roster', component: RosterTab },
  { key: 'draw', label: 'Draw List', component: DrawTab },
  { key: 'printing', label: 'Printing', component: PrintingTab },
  { key: 'scores', label: 'Scores', component: ScoresTab },
  { key: 'finalize', label: 'Finalize', component: FinalizeTab },
  { key: 'results', label: 'Results', component: ResultsTab },
  { key: 'settings', label: 'Settings / Info', component: SettingsTab },
];

const TAB_KEYS = TABS.map((t) => t.key);
const LOCK_POLL_MS = 5000;   // ticket 14 Q5: sees a takeover with 15 of the 20s left

lock.sessionId = tabSessionId;

const Shell = {
  components: Object.fromEntries(TABS.map((t) => ['tab-' + t.key, t.component])),

  setup() {
    // `booted` latches TRUE on first successful login and never goes back.
    // That is the whole mechanism behind ticket 23 Q15: the cold gate is a
    // pre-mount surface, and a 401 afterwards raises an OVERLAY over the
    // still-mounted app rather than swapping the app for a form. `admin/shell.js`
    // cannot do this -- `isAuthenticated` false destroys everything mounted, and
    // here the draw and the score draft are client-side and uncommitted.
    const booted = ref(!!readAuth(window.sessionStorage));
    const phone = ref('');
    const pin = ref('');
    const signingIn = ref(false);
    const operator = ref(null);
    const fatal = ref('');

    let pollTimer = null;

    // ---------------------------------------------------------------- auth

    async function signIn() {
      ui.gateError = '';
      signingIn.value = true;
      try {
        const body = await api.login(phone.value.trim(), pin.value.trim());
        writeAuth(window.sessionStorage, body.token, body.expires_at);
        operator.value = body.operator;
        lock.userId = body.operator.id;
        pin.value = '';
        if (!booted.value) {
          booted.value = true;
          await boot();
        } else {
          // A re-auth. Nothing is reloaded and nothing is discarded: the drafts,
          // the member list and the selected tab are all exactly where they were.
          ui.reauth = false;
          await pollLock();
        }
      } catch (err) {
        ui.gateError = err instanceof ApiError ? (err.remedy || err.message) : String(err);
      } finally {
        signingIn.value = false;
      }
    }

    function signOut() {
      // Release the lease first, while the token is still valid to send.
      releaseLease();
      clearAuth(window.sessionStorage);
      // A full reload IS right here, and only here: the operator is leaving.
      window.location.reload();
    }

    /**
     * Every call in the app funnels through this. A 401 `TOKEN_INVALID` raises the
     * overlay and **returns**, leaving the caller's state untouched -- the banner
     * waits behind it, the draft is untouched (ticket 19 Q10).
     */
    async function guard(fn) {
      try {
        return await fn();
      } catch (err) {
        if (isAuthExpired(err)) {
          ui.reauth = true;
          ui.gateError = '';
          return null;
        }
        throw err;
      }
    }

    // ---------------------------------------------------------------- the lease

    /**
     * Acquired **explicitly** at mount, not on the first mutation.
     *
     * Auto-acquire is friendlier -- an operator working alone would never see a lock
     * UI -- and ticket 14 Q8 rejected it anyway, because it puts the discovery of
     * contention at the worst possible moment: ticket 05 put the whole draw
     * client-side, so the operator would build an entire draw in the browser and find
     * out someone else holds the lease at `POST /rr/draw`, after all the work rather
     * than before it.
     */
    async function acquireLease() {
      try {
        applyLock(await api.acquireLock(eventId.value));
      } catch (err) {
        // 409 LEASE_HELD is not a failure to report; it is the answer. The poll
        // paints the banner and the operator decides whether to take over.
        if (err instanceof ApiError && err.extras.holder) applyLock({ holder: err.extras.holder });
        else if (!isAuthExpired(err)) throw err;
      }
    }

    /**
     * The ambient poll, doing two jobs (ticket 14 Q5).
     *
     * Polling is not optional: the 20-second grace window only works if the
     * incumbent's tab LEARNS of a takeover request, and requests are stateless with no
     * push channel. It carries the roster's shape for nothing besides, because there
     * is a second writer the lease provably cannot hold -- public online registration
     * keeps running through the 6:00-7:30 window while the desk holds a roster it read
     * at 6:05.
     *
     * `roster_count` and `roster_updated_at` are **observables the UI displays**. They
     * are never sent back on a mutation, so ticket 12's "no `state_version`, no
     * precondition field on any endpoint" stands unchanged.
     */
    async function pollLock() {
      try {
        const body = await api.getLock(eventId.value);
        applyLock(body);
        // LEASE_LOST is SYNTHESISED HERE and nowhere else. It is not a server code
        // and must never enter helpers/errors.py -- no endpoint raises it. See
        // api.js's CLIENT_CODES, which is deliberately a separate table.
        const h = body.holder;
        const mine = h && h.user_id === lock.userId && h.session_id === lock.sessionId;
        lock.lost = !!(h && !mine);
      } catch (err) {
        if (isAuthExpired(err)) ui.reauth = true;
        // Any other failure is left silent on purpose: a dropped poll on gym wifi is
        // not news, and the next one is five seconds away. Ticket 19 Q10's "no silent
        // retry" is about MUTATIONS -- this is a read that repeats by construction.
      }
    }

    /**
     * Best-effort release on tab close. If it does not land, takeover recovers -- the
     * abandoned and the sleeping incumbent are the same case, handled the same way.
     *
     * **`navigator.sendBeacon` cannot do this, and ticket 14 named it before the
     * transport was decided.** `POST /rr/lock/release` sits behind `verify_operator`
     * and needs the `x-user-auth` header; `sendBeacon` cannot set headers, so a beacon
     * would 401 silently forever -- dead code that looks like a safety net. A
     * `keepalive` fetch survives unload AND carries headers. Nothing depends on the
     * release landing, so this is a mechanism correction, not a decision reopened.
     */
    /**
     * `pagehide` fires when the tab is merely backgrounded into the bfcache, not only
     * when it is closed -- and the old listener called this unconditionally. So
     * switching away from the desk tab DROPPED the lease, the tab you switched to
     * polled, saw `holder: null`, and offered a Take over that the server grants
     * instantly (rr_lock_service.py:290 -- an unheld lease has no grace window). That
     * is the takeover/acquire storm in the 2026-08-24 log, and it was one operator
     * alternating two tabs, not two operators contending.
     *
     * `persisted` is the distinction: true means the page is going into the bfcache
     * and is coming back, false means it is really going away.
     */
    function onPageHide(e) {
      if (e && e.persisted) return;      // backgrounded, not closed -- keep the lease
      releaseLease();
    }

    /** Restored from the bfcache: take the lease back if it is still free. */
    async function onPageShow(e) {
      if (!e || !e.persisted || !booted.value) return;
      await acquireLease();
      await pollLock();
    }

    function releaseLease() {
      try {
        const r = api._describeRelease(eventId.value);
        window.fetch(r.url, { method: 'POST', headers: r.headers, body: r.body, keepalive: true });
      } catch (e) { /* the page is going away; takeover is the recovery path */ }
    }

    // ---------------------------------------------------------------- hash routing

    /**
     * The active tab is in the URL hash, not a fifth `sessionStorage` key.
     *
     * Ticket 04 found the repo has **no routing of any kind** -- no `vue-router`, no
     * History API, nothing reading `location.hash` -- so this is the first, and it is
     * deliberately the smallest possible form: read on mount, write on switch, no
     * router, no history entries to trap the back button. What it buys is that an
     * accidental F5 at 8pm returns the operator to the tab they were on rather than to
     * Roster.
     */
    function readHash() {
      const key = (window.location.hash || '').replace(/^#/, '');
      if (TAB_KEYS.includes(key)) ui.tab = key;
    }

    function selectTab(key) {
      ui.tab = key;
      // `replaceState`, not a hash assignment: an assignment pushes a history entry
      // per tab switch, and ten switches an evening would bury the back button.
      window.history.replaceState(null, '', '#' + key);
    }

    // ---------------------------------------------------------------- cold load

    async function boot() {
      try {
        const s = await guard(() => api.getSession());
        if (s) applySession(s);

        // All 1,143, ONCE. 52 KB raw / 14 KB gzipped, measured. In memory only --
        // never persisted (Q18), because persisting it would recreate the exact
        // failure ticket 04 found in `bttc_roster_cache`.
        const m = await guard(() => api.getMembers());
        if (m) { members.all = m.members || []; members.loaded = true; }

        // Restore both client-side drafts before anything can overwrite them.
        if (eventId.value != null) {
          drafts.scores = readDraft(window.sessionStorage, eventId.value);
          drafts.draw = readDraw(window.sessionStorage, eventId.value);
        }

        await acquireLease();
        await pollLock();
        // boot() re-runs on every GRANTED takeover (see takeover() below), so the
        // previous interval has to go first. Without this each takeover left another
        // 5s poll running for the life of the tab and only the most recent was ever
        // cleared in onUnmounted -- five takeovers, five polls, forever. Seen in the
        // 2026-08-24 replay log: five GET /rr/lock inside 900ms from one connection.
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = window.setInterval(pollLock, LOCK_POLL_MS);
        lock.polling = true;
      } catch (err) {
        fatal.value = err instanceof ApiError ? (err.remedy || err.message) : String(err);
      }
    }

    // The one place this app touches an element outside its own render tree, and it
    // is the shell that does it. `print.css:131` puts the preview opt-in on
    // `#lm-app` itself, which `createApp().mount('#lm-app')` renders INTO rather than
    // renders AS -- so no `:class` binding can reach it.
    watch(() => ui.printPreview, (on) => {
      const root = document.getElementById('lm-app');
      if (root) root.classList.toggle('lm-print-preview', !!on);
    });

    onMounted(() => {
      readHash();
      window.addEventListener('hashchange', readHash);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onPageShow);
      if (booted.value) boot();
    });

    onUnmounted(() => {
      if (pollTimer) window.clearInterval(pollTimer);
      window.removeEventListener('hashchange', readHash);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    });

    const holderName = computed(() => (lock.holder
      ? (lock.holder.first_name + ' ' + lock.holder.last_name).trim() : null));

    const leaseBanner = computed(() => {
      if (!isReadOnly.value) return null;
      if (!lock.holder) return 'You do not hold the editor lease. Take it to make changes.';
      return holderName.value + ' is running tonight’s session'
        + (lock.lost ? ' — your unsaved work is still here.' : '.');
    });

    const takeoverPending = computed(() => !!lock.grantAfter && !!lock.takeoverRequestedBy);
    const takingOver = ref(false);

    /**
     * Nobody holds it -- so the honest verb is ACQUIRE, not takeover.
     *
     * `isReadOnly` is true for an unheld lease too (store.js), which is deliberate:
     * ticket 14 Q8 wants the operator to decide before they start, not on their first
     * mutation. But offering *takeover* for a lease with no holder is wrong in a way
     * that costs someone else: `rr_lock_service.py:290-295` grants it outright AND
     * silently clears any rival's pending `takeover_requested_by`, restarting their
     * 20-second window at zero. Acquire does the same job and takes nothing.
     */
    const leaseUnheld = computed(() => !lock.holder);

    async function takeover() {
      // Idempotent and self-completing (ticket 14 Q8). The first call stamps the
      // request and returns 202 with the deadline; a later call is granted once the
      // incumbent has released OR the 20 seconds has elapsed. There is no server-side
      // timer and nothing to poll on this endpoint -- the deadline is evaluated on the
      // next request, which is the only thing that works with stateless requests and
      // no scheduler. So we re-POST rather than wait for a push.
      // The button carried no in-flight guard and no :disabled, unlike every other
      // mutating control in the app (finalize.js:218, scores.js:290). N impatient
      // clicks were N round trips, each one re-stamping the lease record.
      if (takingOver.value) return;
      takingOver.value = true;
      try {
        if (leaseUnheld.value) {
          await acquireLease();
          await pollLock();
          return;
        }
        const body = await guard(() => api.takeoverLock(eventId.value));
        if (!body) return;
        applyLock({ holder: body.holder, grant_after: body.grant_after });
        if (body.granted) { lock.lost = false; await boot(); }
      } finally {
        takingOver.value = false;
      }
    }

    return {
      TABS, booted, phone, pin, signingIn, operator, fatal,
      ui, session, lock, isReadOnly, drawCommitted, takingOver, leaseUnheld,
      staleBanner, redrawBanner, leaseBanner, holderName, takeoverPending,
      signIn, signOut, selectTab, takeover,
      remedyFor, LEASE_LOST,
    };
  },

  template: `
    <!-- THE COLD GATE, admin/shell.js:149-186's shape. Shown once, before first
         login; a later 401 raises the overlay below instead. -->
    <div v-if="!booted" class="lm-gate">
      <h2>League Manager</h2>
      <p class="text-muted">Sign in with your phone number and your six-digit BTTC PIN.</p>
      <p v-if="ui.gateError" class="lm-error">{{ ui.gateError }}</p>
      <div class="field">
        <label for="lm-phone">Phone number</label>
        <input id="lm-phone" class="input" type="tel" autocomplete="username"
               v-model="phone" @keyup.enter="signIn" />
      </div>
      <div class="field">
        <label for="lm-pin">PIN</label>
        <input id="lm-pin" class="input" type="password" autocomplete="current-password"
               v-model="pin" @keyup.enter="signIn" />
      </div>
      <button class="btn btn-primary btn-block" :disabled="signingIn" @click="signIn">
        {{ signingIn ? 'Signing in…' : 'Sign in' }}
      </button>
    </div>

    <div v-else>
      <p v-if="fatal" class="lm-banner">{{ fatal }}</p>

      <!-- THE TWO APP-LEVEL BANNERS, above the tab switcher. Ticket 19 Q15: the
           forgetting they guard against happens BETWEEN screens, so an explanation
           that vanishes on tab switch is missing from the one place the stale state
           does damage. Ticket 28 Q10 declined a third. -->
      <div class="lm-banners">
        <div v-if="staleBanner" class="lm-banner">
          <span class="lm-who">{{ staleBanner }}</span>
          <button class="btn btn-secondary" @click="selectTab('finalize')">Go to Finalize</button>
        </div>
        <div v-if="redrawBanner" class="lm-banner">
          <span class="lm-who">{{ redrawBanner }}</span>
          <button class="btn btn-secondary" @click="selectTab('draw')">Go to Draw List</button>
        </div>
        <div v-if="leaseBanner" class="lm-banner lm-banner-lease">
          <span class="lm-who">{{ leaseBanner }}</span>
          <span v-if="takeoverPending" class="lm-sha">granted after {{ lock.grantAfter }}</span>
          <button class="btn btn-secondary" @click="takeover" :disabled="takingOver">
            {{ takeoverPending ? 'Complete takeover'
                               : (leaseUnheld ? 'Take the lease' : 'Take over') }}
          </button>
        </div>
      </div>

      <nav class="lm-tabs">
        <button v-for="t in TABS" :key="t.key" class="lm-tab" type="button"
                :aria-selected="ui.tab === t.key" @click="selectTab(t.key)">{{ t.label }}</button>
        <span class="lm-sp"></span>
        <button class="lm-tab" type="button" @click="signOut">Sign out</button>
      </nav>

      <!-- v-if, not v-show, and no <KeepAlive> -- admin/shell.js:210-212's shape.
           Everything that must survive a tab switch is in store.js or sessionStorage
           BY CONSTRUCTION: the member list, the lease, both drafts, both banners. So
           teardown forces the survival list to be an explicit decision rather than an
           accident of DOM retention. What is deliberately allowed to die: scroll
           position, the Roster search box, the selected player, the selected group. -->
      <tab-roster v-if="ui.tab === 'roster'"></tab-roster>
      <tab-draw v-if="ui.tab === 'draw'"></tab-draw>
      <tab-printing v-if="ui.tab === 'printing'"></tab-printing>
      <tab-scores v-if="ui.tab === 'scores'"></tab-scores>
      <tab-finalize v-if="ui.tab === 'finalize'"></tab-finalize>
      <tab-results v-if="ui.tab === 'results'"></tab-results>
      <tab-settings v-if="ui.tab === 'settings'"></tab-settings>

      <div class="lm-statusbar">
        <span v-if="operator">{{ operator.first_name }} {{ operator.last_name }}</span>
        <span v-if="session.event">{{ session.event.event_date }} · {{ session.event.status }}</span>
        <span v-if="lock.rosterCount !== null">{{ lock.rosterCount }} registered</span>
        <span class="lm-sp"></span>
        <span v-if="isReadOnly" class="lm-code">read-only</span>
      </div>

      <!-- THE RE-AUTH OVERLAY, over the still-mounted app. The tab strip, both drafts
           and every scroll position are still behind it. This is what makes ticket
           13's "without discarding unsaved client state" true rather than
           aspirational. -->
      <div v-if="ui.reauth" class="lm-overlay">
        <div class="lm-overlay-panel">
          <h3>Sign in again</h3>
          <p class="text-muted">Your operator session expired. Nothing you have typed is lost.</p>
          <p v-if="ui.gateError" class="lm-error">{{ ui.gateError }}</p>
          <div class="field">
            <label for="lm-phone2">Phone number</label>
            <input id="lm-phone2" class="input" type="tel" v-model="phone" @keyup.enter="signIn" />
          </div>
          <div class="field">
            <label for="lm-pin2">PIN</label>
            <input id="lm-pin2" class="input" type="password" v-model="pin" @keyup.enter="signIn" />
          </div>
          <button class="btn btn-primary btn-block" :disabled="signingIn" @click="signIn">
            {{ signingIn ? 'Signing in…' : 'Sign in' }}
          </button>
        </div>
      </div>
    </div>
  `,
};

createApp(Shell).mount('#lm-app');
