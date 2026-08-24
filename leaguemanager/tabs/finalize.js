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
 * ── THE LOG DERIVES; IT DOES NOT ACCUMULATE ───────────────────────────────────────
 *
 * `events.details["rr_publish"]` rides the cold-load composite read, so the rows come
 * from `session.rr_publish` (ticket 26 Q5). After an F5 the operator still sees what was
 * published, when, at which SHA, with the links live -- and ticket 23 Q7's `v-if`
 * teardown cannot lose it, **with no new `store.js` field**. Keying is latest-per-scope
 * (Q6), so at most three rows survive a reload; overwriting is not merely cheaper but
 * more honest, since two rows whose links point at the same URL can only serve the
 * newer content.
 */
const { ref, reactive, computed } = window.Vue;

import { api } from '../client.js';
import { ApiError, isNoChanges } from '../api.js';
import { session, applySession, isReadOnly, drawCommitted, eventId } from '../store.js';

const SCOPES = ['brackets', 'results', 'sleep'];

const SCOPE_LABEL = {
  brackets: 'Brackets — tonight’s groups and play order',
  results: 'Results — the session page, the index, and the brackets come down',
  sleep: 'Sleep — take the brackets down and leave the rest',
};

/**
 * **One link per visible change, not one per publish** (ticket 26 Q2).
 *
 * `results` is a FUSED scope -- ticket 16 Q3 folded sleep into it -- so one commit has
 * three independent outcomes: a new session page, an index that gained an entry, and
 * the brackets coming down. One link under-reports what the commit did, and the
 * brackets half matters on its own: stale groups from last week showing until Wednesday
 * is precisely the failure `sleep` was made separately callable to fix. The index is
 * worth its own link because it is rendered client-side from `index.json` by ~40 lines
 * of vanilla JS, and that renderer can fail while the session page is perfectly live.
 *
 * **Emitted in the SERVED form -- lowercase, extensionless -- so the operator does not
 * eat a 301.** Netlify rewrites the HTML it serves and 301s `.html` to lowercase
 * extensionless: `/results/RR_Results_2026May29.html` becomes
 * `/results/rr_results_2026may29`.
 */
function linksFor(scope, record) {
  if (scope === 'brackets' || scope === 'sleep') return [{ href: '/draw-brackets/', label: 'brackets' }];
  if (scope !== 'results') return [];
  const page = (record.files_written || [])
    .find((f) => /^results\/RR_Results_.*\.html$/i.test(f));
  const out = [];
  if (page) {
    out.push({
      href: '/' + page.replace(/\.html$/i, '').toLowerCase(),
      label: 'session page',
    });
  }
  out.push({ href: '/results', label: 'index' });
  out.push({ href: '/draw-brackets/', label: 'brackets' });
  return out;
}

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
        // NO_CHANGES IS A 200 AND A SUCCESS. An api.js that treated a `code` field as
        // failure would render the idempotent case as an error and print a Failed row
        // for a publish that did exactly the right thing.
        outcome[scope] = {
          tag: isNoChanges(body) ? 'No changes' : (dryRun.value ? 'Dry run' : 'Committed'),
          record: body,
          dryRun: dryRun.value,
        };
        if (!dryRun.value && !isNoChanges(body)) {
          // The persisted record is what the log derives from after a reload; mirror
          // it now so the row does not vanish until the next cold read.
          session.rrPublish = { ...session.rrPublish, [scope]: body };
        }
      } catch (err) {
        outcome[scope] = {
          tag: 'Failed',
          error: {
            text: err instanceof ApiError ? (err.detail || err.message) : String(err),
            remedy: err instanceof ApiError ? err.remedy : null,
            code: err instanceof ApiError ? err.code : null,
            // REF_CONFLICT carries GitHub's own words, which is the only place the
            // branch-protection failure mode says anything at all. Nothing detects it,
            // because ticket 26 ships no observer.
            github: err instanceof ApiError ? err.extras.github_message : null,
          },
        };
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

    const tagClass = (tag) => ({
      Sending: 'tag tag-outline',
      Committed: 'tag tag-accent',
      'No changes': 'tag tag-neutral',
      'Dry run': 'tag tag-outline',
      Failed: 'tag tag-danger',
    }[tag] || 'tag');

    const canApply = computed(() => !isReadOnly.value && drawCommitted.value && !busy.value);

    const applyReason = computed(() => {
      if (isReadOnly.value) return 'another operator holds the editor lease';
      if (!drawCommitted.value) return 'there is no draw yet';
      return '';
    });

    const canPublish = computed(() => !isReadOnly.value && !busy.value);

    return {
      SCOPES, SCOPE_LABEL, session, isReadOnly, drawCommitted,
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
          {{ busy === s ? 'Sending…' : 'Publish ' + s }}
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
                 brackets or results went up. -->
            <td><b>{{ r.scope }}</b></td>
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
