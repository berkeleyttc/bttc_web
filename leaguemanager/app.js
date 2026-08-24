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
import {
  readAuth, writeAuth, clearAuth, readDraft, readDraw, operatorFromToken,
} from './persist.js';
import {
  session, applySession, members, lock, applyLock, isHolder, drafts, ui,
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

// The countdown ticks faster than the poll on purpose. `grant_after` is an absolute
// deadline, so counting down to it needs no server round trip -- and a number that
// only moved every five seconds would read as frozen.
const TICK_MS = 1000;

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
        lock.yielded = false;
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
      let body;
      try {
        body = await api.getLock(eventId.value);
        applyLock(body);
      } catch (err) {
        if (isAuthExpired(err)) ui.reauth = true;
        // Any other failure is left silent on purpose: a dropped poll on gym wifi is
        // not news, and the next one is five seconds away. Ticket 19 Q10's "no silent
        // retry" is about MUTATIONS -- this is a read that repeats by construction.
        return;
      }

      // LEASE_LOST is SYNTHESISED HERE and nowhere else. It is not a server code and
      // must never enter helpers/errors.py -- no endpoint raises it. See api.js's
      // CLIENT_CODES, which is deliberately a separate table.
      //
      // `heldOnce` is what makes it mean something. It used to read `holder && !mine`,
      // which is `isReadOnly && lock.holder` spelled differently -- so the banner hung
      // *"-- your unsaved work is still here."* on a tab that had never held the lease
      // and had no work to preserve.
      const mine = isHolder(body.holder);
      lock.lost = !!body.holder && !mine && lock.heldOnce;
      // Somebody else now holds it, so whatever we yielded has been collected and this
      // tab is free to compete for the lease again the next time it falls vacant.
      if (body.holder && !mine) lock.yielded = false;

      // ---- nobody holds it: just take it. -------------------------------------
      // Ticket 14 Q8's "the operator decides before they start" is about deciding
      // whether to take the lease FROM SOMEONE. There is nobody to decide about here,
      // and leaving the app read-only behind a *Take the lease* button for a lease
      // nobody holds is a click that asks a question with one answer. A race loser
      // gets 409 LEASE_HELD, which `acquireLease` already absorbs.
      //
      // **`yielded` is what stops this eating the handover it just performed.** When we
      // release early for a waiting challenger the lease is briefly unheld, and without
      // the guard this branch would grab it back before the challenger's next poll --
      // an unbounded loop between two tabs, each politely taking turns stealing.
      if (!body.holder && booted.value && !takingOver.value && !lock.yielded) {
        await acquireLease();
        return;
      }

      const pending = body.takeover_requested_by;

      // ---- we hold it, and someone is asking for it. ---------------------------
      // **This is the half ticket 14 Q2 specified and nobody built.** `takeoverRequestedBy`
      // had two readers in the whole frontend and both sat behind `isReadOnly`, i.e. in
      // the CHALLENGER's tab -- the holding tab was never told, never flushed and never
      // released early. So the twenty-second window it justified was dead time in every
      // takeover the app has ever performed, and `operating-runbook.md:54-57` promised
      // operators a warning that no code emitted.
      if (mine && pending && !isHolder(pending)) {
        if (hasDraft()) {
          // Something is unsaved. Say so, and leave it to the operator: auto-POSTing a
          // draw or a score grid nobody clicked Commit on is a mutation this app does
          // not make on its own, and ticket 19 Q10 bans silent writes.
          return;
        }
        // Nothing to flush, so the window is protecting nothing. Hand over now and
        // collapse twenty seconds of standing around into one poll interval.
        lock.yielded = true;
        await releaseLease();
        lock.holder = null;
        return;
      }

      // ---- we are the challenger, and it is ours to complete. -------------------
      // `POST /rr/lock/takeover` is idempotent and self-completing (ticket 14 Q8): the
      // deadline is evaluated on the NEXT REQUEST, because with stateless requests and
      // no scheduler there is nothing on the server counting. Something has to make
      // that next request. It was a human clicking *Complete takeover* a second time,
      // which is not a protocol -- it is a nag.
      if (!mine && isHolder(pending)
          && (!body.holder || deadlinePassed(body.grant_after))) {
        await takeover();
      }
    }

    /**
     * Is there anything in this tab that a commit would save?
     *
     * Deliberately structural rather than a flag: `drafts.draw` is `null` when there is
     * none (`persist.js`), and `drafts.scores` is keyed by group, so a group whose cells
     * were all cleared leaves an empty object behind that is not a draft.
     */
    function hasDraft() {
      const draw = drafts.draw;
      if (draw && Array.isArray(draw.groups) && draw.groups.length) return true;
      return Object.values(drafts.scores || {})
        .some((g) => g && Object.keys(g).length > 0);
    }

    function deadlinePassed(grantAfter) {
      const at = grantAfter ? Date.parse(grantAfter) : NaN;
      return Number.isFinite(at) && Date.now() >= at;
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
        // Returned, not awaited here: `onPageHide` and `signOut` are both leaving and
        // have nothing to wait for. `pollLock`'s early handover DOES await it, so the
        // challenger's next poll cannot arrive before the release has landed.
        return window.fetch(r.url,
          { method: 'POST', headers: r.headers, body: r.body, keepalive: true })
          .catch(() => { /* takeover is the recovery path */ });
      } catch (e) { /* the page is going away; takeover is the recovery path */ }
      return Promise.resolve();
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
        // **Recover WHO WE ARE before anything consults the lease.**
        //
        // `lock.userId` was written in exactly one place -- `signIn()` -- and a warm boot
        // never calls it: `booted` latches straight off `sessionStorage`. So every reload
        // left `userId` null, `isHolder()` compared each holder against null, and the app
        // was read-only for the life of the tab while holding the lease server-side. The
        // operator saw his own name in the lease banner and a Take over button that took
        // the lease from himself and changed nothing. See `operatorFromToken`.
        const claims = operatorFromToken((readAuth(window.sessionStorage) || {}).token);
        if (claims) lock.userId = claims.user_id;
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
      if (tickTimer) window.clearInterval(tickTimer);
      window.removeEventListener('hashchange', readHash);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    });

    const holderName = computed(() => nameOf(lock.holder));

    /**
     * The status bar's name, which a reload also used to lose.
     *
     * `POST /rr/login` is the only thing that returns `first_name`/`last_name`, and the
     * token carries only `{user_id, role, exp}` -- so on a warm boot there is nobody to
     * name. Except there is: when we hold the lease, the holder the server reports **is**
     * the operator, under the name the server itself put on it.
     */
    const operatorName = computed(() => {
      if (operator.value) {
        return ((operator.value.first_name || '') + ' '
              + (operator.value.last_name || '')).trim();
      }
      return holderIsMe.value ? holderName.value : null;
    });

    function nameOf(who) {
      return who ? ((who.first_name || '') + ' ' + (who.last_name || '')).trim() : null;
    }

    /** The holder is the signed-in operator, in one of their other tabs. */
    const holderIsMe = computed(() => !!lock.holder && lock.holder.user_id === lock.userId);

    const leaseBanner = computed(() => {
      if (!isReadOnly.value) return null;
      if (!lock.holder) {
        return lock.yielded
          ? 'You handed the session over. This tab is read-only until you take it back.'
          : 'You do not hold the editor lease. Take it to make changes.';
      }

      // **Your own name is not a rival.** The lease is keyed `{user_id, session_id}` so a
      // second tab is a genuine challenger -- correct, and it is what stops two tabs
      // clobbering each other with no precondition token anywhere to catch it. But the
      // banner rendered that as *"Mohit Galvankar is running tonight’s session"* to Mohit
      // Galvankar, which reads as a stranger holding the desk rather than as the tab
      // behind this one.
      if (holderIsMe.value) {
        return lock.lost
          ? 'You took the session over in another tab. This tab is read-only and anything'
            + ' unsaved here is still here.'
          : 'You are running tonight’s session in another tab.';
      }

      // `lost` now means what it says (`store.js`): this tab HELD the lease and was
      // evicted. That is the one case with work to reassure anybody about, and it is
      // the case `CLIENT_CODES.LEASE_LOST` was written for -- a string that has been
      // unreachable since it was added, because nothing in the template referenced it
      // and `remedyFor`/`LEASE_LOST` were returned from `setup()` into a void.
      if (lock.lost) return remedyFor(LEASE_LOST);
      return holderName.value + ' is running tonight’s session.';
    });

    /**
     * The incumbent-side notice: **the half of ticket 14 Q2 that was never built.**
     *
     * The grace window is justified entirely by the incumbent flushing their draft before
     * releasing, and until now the holding tab was never told a takeover had been
     * requested -- `takeoverRequestedBy` had two readers and both sat behind `isReadOnly`.
     * `operating-runbook.md:54-57` promises operators *"a 20-second warning naming the
     * person and the time"*. This is that warning.
     *
     * It only ever renders when there is something unsaved: with nothing to flush,
     * `pollLock` hands the lease over immediately instead of showing anybody a countdown
     * they have no reason to read.
     */
    const handoverBanner = computed(() => {
      const who = lock.takeoverRequestedBy;
      if (isReadOnly.value || !who || isHolder(who)) return null;
      const secs = secondsLeft.value;
      return nameOf(who) + ' is taking over on another device'
        + (secs === null ? '' : (secs > 0 ? ' in ' + secs + 's' : ' now'))
        + '. Commit anything unsaved on this tab — it does not travel with the lease.';
    });

    /**
     * A countdown is only news to the two tabs in the handover: the incumbent watching
     * theirs run out, and the challenger waiting on it. A tab that has already YIELDED is
     * neither -- it left the protocol -- and leaving the clock ticking beside *"You handed
     * the session over"* counts down to nothing it is waiting for.
     */
    const takeoverPending = computed(() =>
      !!lock.grantAfter && !!lock.takeoverRequestedBy && !lock.yielded);
    const takingOver = ref(false);

    // ------------------------------------------------------------------ the countdown
    /**
     * `grant_after` used to be interpolated **raw** -- `granted after
     * 2026-08-24T19:51:01.541059Z`, UTC, to the microsecond, in `lm-sha`, which is the
     * monospace **id chip** used for SHAs and session ids. A deadline rendered as a hash.
     *
     * It is an absolute instant, so counting down to it costs no request. The ticker runs
     * only while something is pending; there is nothing to animate the rest of the night.
     */
    const nowMs = ref(Date.now());
    let tickTimer = null;

    const secondsLeft = computed(() => {
      const at = lock.grantAfter ? Date.parse(lock.grantAfter) : NaN;
      if (!Number.isFinite(at)) return null;
      return Math.max(0, Math.ceil((at - nowMs.value) / 1000));
    });

    const countdown = computed(() => {
      const secs = secondsLeft.value;
      if (secs === null) return '';
      return secs > 0 ? 'handing over in ' + secs + 's…' : 'taking over…';
    });

    watch(() => !!lock.grantAfter && !!lock.takeoverRequestedBy, (pending) => {
      if (tickTimer) { window.clearInterval(tickTimer); tickTimer = null; }
      if (!pending) return;
      nowMs.value = Date.now();
      tickTimer = window.setInterval(() => { nowMs.value = Date.now(); }, TICK_MS);
    }, { immediate: true });

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
        lock.yielded = false;
        if (leaseUnheld.value) {
          await acquireLease();
          await pollLock();
          return;
        }
        const body = await guard(() => api.takeoverLock(eventId.value));
        if (!body) return;
        applyLock({ holder: body.holder, grant_after: body.grant_after });
        if (body.granted) { lock.lost = false; await boot(); }
        // NOT granted: the request is stamped and the deadline is running. Nobody has to
        // come back and click again -- `pollLock` re-POSTs once `grant_after` passes or
        // the incumbent releases. That is what makes the endpoint's "idempotent and
        // self-completing" true of the SYSTEM rather than only of the server.
      } finally {
        takingOver.value = false;
      }
    }

    return {
      TABS, booted, phone, pin, signingIn, operator, fatal,
      operatorName,
      ui, session, lock, isReadOnly, drawCommitted, takingOver, leaseUnheld,
      staleBanner, redrawBanner, leaseBanner, handoverBanner, holderName,
      holderIsMe, takeoverPending, countdown,
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
        <!-- The INCUMBENT side, and it is a fourth banner. 'store.js' and 'app.css'
             both record ticket 28 Q10 declining a third; this reopens that knowingly,
             because ticket 14 Q2 justified the whole twenty-second window on the
             incumbent being warned and no code has ever warned them. It shows only when
             this tab has something unsaved -- with nothing to flush, 'pollLock' hands
             the lease over at once rather than making anyone watch a clock. -->
        <div v-if="handoverBanner" class="lm-banner lm-banner-lease">
          <span class="lm-who">{{ handoverBanner }}</span>
        </div>
        <div v-if="leaseBanner" class="lm-banner lm-banner-lease">
          <span class="lm-who">{{ leaseBanner }}</span>
          <!-- A COUNTDOWN, not an ISO string, and no 'lm-sha': that class is the
               monospace id chip, so the deadline used to render as though it were a
               hash. And no *Complete takeover* button -- the poll completes it. -->
          <span v-if="takeoverPending" class="lm-note">{{ countdown }}</span>
          <button v-if="!takeoverPending" class="btn btn-secondary"
                  @click="takeover" :disabled="takingOver">
            {{ leaseUnheld ? 'Take the lease'
                           : (holderIsMe ? 'Continue in this tab' : 'Take over') }}
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
        <span v-if="operatorName">{{ operatorName }}</span>
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
