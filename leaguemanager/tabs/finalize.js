/**
 * The Finalize tab -- two gated steps above a log.
 *
 * ── FOUR TAGS, AND WHY THERE ARE FOUR ─────────────────────────────────────────────
 *
 * `Sending` / `Committed` / `No changes` / `Failed`. The design ships **two**
 * (`Sending`, `Success`) and **cannot express a failure at all**: its catch paths at
 * `League Manager.dc.html:963-965` and `:1062-1064` append no row, so a failed publish
 * is currently invisible. `Success` is also the word ticket 26 Q1 rules out -- the port
 * observes nothing and stops claiming instead.
 *
 * `No changes` earns its own tag rather than folding into `Committed`, which would print
 * a blank SHA and imply a deploy that will never arrive. Its links stay, and are in fact
 * **more** trustworthy than usual: the site already serves the right content.
 *
 * ── `pushedCheckMark` AND `pushedOpacity` ARE DELETED, NOT PORTED ─────────────────
 *
 *     :572    {{ pushedCheckMark }} Web Pages Submitted.
 *     :1498   pushedCheckMark: (s.pushLog.length > 0 && !s.pushing) ? '✓' : ''
 *
 * The checkmark derives from *"a log entry exists and we are not mid-push"* -- **true
 * even when the last entry is a failure**, which is weaker than legacy's `git push`
 * exit code. That is `#71` reproduced and made worse. Worse still, both lines at
 * `:571-575` use the SAME pair for two different operations ("Web Pages Submitted" and
 * "Json DB changes uploaded"), so they tick together regardless of which was requested.
 *
 * **`Committed` is terminal and there is no verified state, ever** (ticket 26 Q4). An
 * operator-clicked *"site is live"* checkmark was offered in both a transient and a
 * persisted form and declined both times: it records the operator's **belief**, and the
 * app cannot tell *I looked* from *I clicked*. `GET /rr/publish/status` never ships --
 * removed from ticket 12's surface, not deferred.
 *
 * ── `brackets` IS NOT ON THIS TAB ─────────────────────────────────────────────────
 *
 * It moved to the Draw List tab, **button and log row together**. A bracket publish is
 * gated on a committed draw and not on results at all -- `_gate`
 * (`rr_publish_service.py:317-344`) asks only that seats exist -- so Step 1 was never its
 * prerequisite, and putting it behind a tab whose first step is *generate results* implied
 * an order that does not exist.
 *
 * The one `SCOPES` list below drives the buttons AND the log, deliberately: Finalize
 * cannot report a scope it cannot publish, so the split cannot rot into a log that claims
 * an act this tab did not perform.
 *
 * ── THE LOG DERIVES; IT DOES NOT ACCUMULATE ───────────────────────────────────────
 *
 * `events.details["rr_publish"]` rides the cold-load composite read, so the rows come
 * from `session.rr_publish` (ticket 26 Q5). After an F5 the operator still sees what was
 * published, when, at which SHA, with the links live -- and ticket 23 Q7's `v-if`
 * teardown cannot lose it, **with no new `store.js` field**. Keying is latest-per-scope
 * (Q6), so at most TWO rows survive a reload here -- the third, `brackets`, is the Draw
 * List tab's, though the record itself still rides the same composite read. Overwriting is
 * not merely cheaper but more honest, since two rows whose links point at the same URL can
 * only serve the newer content.
 */
const { ref, reactive, computed } = window.Vue;

import { api } from '../client.js';
import { ApiError } from '../api.js';
import { session, applySession, isReadOnly, drawCommitted, eventId } from '../store.js';
import {
  SCOPE_LABEL, BUTTON_LABEL, SCOPE_NAME, linksFor, tagClass, outcomeOf, errorOf,
} from '../publish.js';

/** `brackets` is absent by design -- see the header. */
const SCOPES = ['results', 'sleep'];

export const FinalizeTab = {
  setup() {
    const busy = ref(null);              // the scope currently in flight, or null
    const sending = reactive({});        // scope -> true while a `Sending` row shows
    const outcome = reactive({});        // scope -> the last in-page result or failure
    const dryRun = ref(false);

    // ── step 1: generate results ────────────────────────────────────────────
    const resultsBanner = ref(null);

    async function generateResults() {
      busy.value = 'results-apply';
      resultsBanner.value = null;
      try {
        const body = await api.generateResults(eventId.value);
        session.resultsApplied = !!body.results_applied;
        session.resultsStale = !!body.results_stale;
        // **200 is not the same as applied.** The endpoint returns its own post-commit
        // read-back in this body, and on 2026-08-24 it came back FALSE alongside 64
        // fully computed rows -- while this banner said "Ratings applied for 64
        // players." and the night had not been recorded at all. The server now answers
        // 503 DB_BUSY in that case, so this branch should be unreachable; it stays
        // because the banner must never be able to claim more than the body does.
        if (!body.results_applied) {
          resultsBanner.value = {
            ok: false,
            text: 'The ratings did not save, so nothing was applied. Run Finalize again.',
          };
          return;
        }
        resultsBanner.value = {
          ok: true,
          text: 'Ratings applied for ' + (body.applied || []).length + ' players.',
        };
        // A pure recompute, so corrections are the ordinary flow replayed and
        // idempotency falls out free (ticket 12). Re-read so the standings the Results
        // tab renders are the ones just written.
        const s = await api.getSession(eventId.value);
        if (s) applySession(s);
      } catch (err) {
        resultsBanner.value = {
          ok: false,
          text: err instanceof ApiError ? (err.detail || err.message) : String(err),
          remedy: err instanceof ApiError ? err.remedy : null,
          code: err instanceof ApiError ? err.code : null,
        };
      } finally {
        busy.value = null;
      }
    }

    // ── step 2: publish ─────────────────────────────────────────────────────

    async function publish(scope) {
      busy.value = scope;
      sending[scope] = true;
      delete outcome[scope];
      try {
        const body = await api.publish(scope, { dryRun: dryRun.value, eventId: eventId.value });
        const out = outcomeOf(body, dryRun.value);
        outcome[scope] = out;
        // `Committed` is exactly "not a dry run, and something actually changed" -- a
        // `No changes` body has no commit to record and a dry run has no ref to point at.
        if (out.tag === 'Committed') {
          // The persisted record is what the log derives from after a reload; mirror
          // it now so the row does not vanish until the next cold read.
          session.rrPublish = { ...session.rrPublish, [scope]: body };
        }
      } catch (err) {
        outcome[scope] = { tag: 'Failed', error: errorOf(err) };
      } finally {
        busy.value = null;
        sending[scope] = false;
      }
    }

    // ── the log ─────────────────────────────────────────────────────────────

    const rows = computed(() => {
      const out = [];
      for (const scope of SCOPES) {
        if (sending[scope]) {
          out.push({ scope, tag: 'Sending', links: [], at: null, sha: null });
          continue;
        }
        const live = outcome[scope];
        if (live && live.tag === 'Failed') {
          out.push({ scope, tag: 'Failed', error: live.error, links: [], at: null, sha: null });
          continue;
        }
        if (live && live.tag === 'No changes') {
          out.push({
            scope, tag: 'No changes', links: linksFor(scope, live.record),
            at: live.record.published_at, sha: null,
          });
          continue;
        }
        if (live && live.tag === 'Dry run') {
          out.push({
            scope, tag: 'Dry run', links: [], at: live.record.published_at,
            sha: live.record.commit_sha, compare: live.record.compare_url,
            written: live.record.files_written, deleted: live.record.files_deleted,
          });
          continue;
        }
        // Nothing live for this scope: fall back to what the server persisted.
        const rec = session.rrPublish ? session.rrPublish[scope] : null;
        if (rec) {
          out.push({
            scope, tag: 'Committed', links: linksFor(scope, rec),
            at: rec.at || rec.published_at, sha: rec.commit_sha,
            written: rec.files_written, deleted: rec.files_deleted,
          });
        }
      }
      return out;
    });

    const canApply = computed(() => !isReadOnly.value && drawCommitted.value && !busy.value);

    const applyReason = computed(() => {
      if (isReadOnly.value) return 'another operator holds the editor lease';
      if (!drawCommitted.value) return 'there is no draw yet';
      return '';
    });

    const canPublish = computed(() => !isReadOnly.value && !busy.value);

    return {
      SCOPES, SCOPE_LABEL, BUTTON_LABEL, SCOPE_NAME, session, isReadOnly, drawCommitted,
      busy, dryRun, rows, tagClass,
      resultsBanner, generateResults, publish,
      canApply, applyReason, canPublish,
    };
  },

  template: `
  <div>
    <div class="card" style="margin-bottom:24px">
      <div class="card-kicker">Step 1 — generate results</div>
      <p class="text-muted">
        Applies the night once: ratings move, places are stored, history is written. It
        is a pure recompute, so re-running it after a correction is the ordinary flow
        replayed rather than a special case.
      </p>
      <div class="lm-actions">
        <button class="btn btn-primary" type="button" :disabled="!canApply"
                @click="generateResults">
          {{ busy === 'results-apply' ? 'Applying…' : 'Generate results' }}
        </button>
        <span class="lm-reason" v-if="!canApply">{{ applyReason }}</span>
        <span class="lm-saved" v-if="session.resultsApplied && !session.resultsStale">
          applied
        </span>
        <!-- No checkmark derived from "a log entry exists". See the header comment. -->
        <span class="lm-reason" v-if="session.resultsStale">
          a score changed since the last run — re-run before publishing
        </span>
      </div>
      <div v-if="resultsBanner" class="lm-banner" style="margin-top:12px">
        <span class="lm-who">
          {{ resultsBanner.text }}
          <span v-if="resultsBanner.remedy"><br />{{ resultsBanner.remedy }}</span>
        </span>
        <span v-if="resultsBanner.code" class="lm-code">{{ resultsBanner.code }}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <div class="card-kicker">Step 2 — publish</div>
      <p class="text-muted">
        One atomic commit per publish. The commit is synchronous; the site build is not,
        so a committed publish is not a live page — check the link when the build lands.
      </p>
      <div class="lm-actions">
        <button v-for="s in SCOPES" :key="s" class="btn btn-secondary" type="button"
                :disabled="!canPublish" @click="publish(s)">
          {{ busy === s ? 'Sending…' : BUTTON_LABEL[s] }}
        </button>
        <span class="lm-sp"></span>
        <!-- The dry run is the SAME CODE PATH with the ref update withheld -- and it is
             lease-gated too, because it creates real Git objects. -->
        <label style="font-size:12px">
          <input type="checkbox" v-model="dryRun" /> dry run (no ref update)
        </label>
      </div>
      <p class="text-muted" style="font-size:12px;margin-top:8px">
        <span v-for="s in SCOPES" :key="s" style="display:block">{{ SCOPE_LABEL[s] }}</span>
      </p>
    </div>

    <div class="card">
      <div class="card-kicker">Publish log</div>
      <p v-if="!rows.length" class="lm-empty">Nothing has been published for this event.</p>
      <table v-else class="lm-log">
        <tbody>
          <tr v-for="r in rows" :key="r.scope + r.tag">
            <td><span :class="tagClass(r.tag)">{{ r.tag }}</span></td>
            <!-- EVERY ROW NAMES ITS SCOPE. One message string cannot say whether
                 the results or the take-down went up. Through SCOPE_NAME, so the row and
                 the button above it use the same word for the same act. -->
            <td><b>{{ SCOPE_NAME[r.scope] || r.scope }}</b></td>
            <td>
              <div v-if="r.error">
                {{ r.error.text }}
                <div v-if="r.error.remedy" class="text-muted">{{ r.error.remedy }}</div>
                <div v-if="r.error.github" class="lm-code">GitHub said: {{ r.error.github }}</div>
              </div>
              <div v-else class="lm-links">
                <a v-for="l in r.links" :key="l.href" :href="l.href" target="_blank"
                   rel="noopener">{{ l.label }}</a>
                <span v-if="r.compare"><a :href="r.compare" target="_blank" rel="noopener">compare</a></span>
              </div>
              <div v-if="r.written && r.written.length" class="text-muted" style="font-size:11px">
                {{ r.written.length }} written<span v-if="r.deleted && r.deleted.length">,
                {{ r.deleted.length }} deleted</span>
              </div>
            </td>
            <td class="lm-sha">{{ r.sha ? r.sha.slice(0, 10) : '' }}</td>
            <td class="lm-sha">{{ r.at || '' }}</td>
            <!-- A Failed row carries the machine-readable code, so the runbook entry
                 and the screen say the same word. -->
            <td class="lm-code">{{ r.error ? r.error.code : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  `,
};
