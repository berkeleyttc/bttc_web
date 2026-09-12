/**
 * `publish.js` -- the publish decisions, as pure functions.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────────────
 *
 * `Publish brackets` moved to the Draw List tab, because publishing tonight's groups has
 * nothing to do with generating results: `_gate` (`rr_publish_service.py:317-344`) asks
 * only that seats exist and 409s `DRAW_MISSING` otherwise. The natural moment is the
 * moment the draw is committed.
 *
 * That leaves two tabs calling `POST /rr/publish`, and the rules below are exactly the
 * ones that must not drift apart between them. They live here rather than in a composable
 * because **this file does not reach `window.Vue`** -- `node --test` can import it, the
 * way it imports `persist.js`, and `test/README.md` draws that line deliberately. A
 * `usePublish()` factory would own `ref`/`reactive`, and the half worth testing would go
 * back to being untestable.
 *
 * Each tab keeps its own reactive state, which is not duplication but a different shape:
 * Finalize tracks two scopes and renders a log; the Draw List card tracks one and renders
 * a row.
 */
import { ApiError, isNoChanges } from './api.js';

/**
 * The prose under each button. `sleep` reads as what it does rather than as a mode name:
 * the operator never had to learn the word, and the button beside it says the same thing.
 * The wire value is still `sleep` -- this is a label, not a rename of the scope.
 */
export const SCOPE_LABEL = {
  brackets: 'Brackets — tonight’s groups and play order',
  results: 'Results — the session page, the index, and the brackets come down',
  sleep: 'Take down brackets — leave the results and the index as they are',
};

/** The button face. `'Publish ' + scope` cannot express the take-down. */
export const BUTTON_LABEL = {
  brackets: 'Publish brackets',
  results: 'Publish results',
  sleep: 'Take down brackets',
};

/**
 * The word the log prints in its scope column. Without this the row says `sleep` while the
 * button two inches above says *Take down brackets*, and one thing has two names.
 */
export const SCOPE_NAME = {
  brackets: 'brackets',
  results: 'results',
  sleep: 'take-down',
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
export function linksFor(scope, record) {
  if (scope === 'brackets' || scope === 'sleep') return [{ href: '/draw-brackets/', label: 'brackets' }];
  if (scope !== 'results') return [];
  const page = ((record && record.files_written) || [])
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

export function tagClass(tag) {
  return {
    Sending: 'tag tag-outline',
    Committed: 'tag tag-accent',
    'No changes': 'tag tag-neutral',
    'Dry run': 'tag tag-outline',
    'Taken down': 'tag tag-neutral',
    Failed: 'tag tag-danger',
  }[tag] || 'tag';
}

/**
 * A 200 body -> the row it becomes.
 *
 * **NO_CHANGES IS A 200 AND A SUCCESS.** An `api.js` that treated a `code` field as failure
 * would render the idempotent case as an error and print a `Failed` row for a publish that
 * did exactly the right thing. `No changes` earns its own tag rather than folding into
 * `Committed`, which would print a blank SHA and imply a deploy that will never arrive --
 * its links stay, and are in fact MORE trustworthy than usual, because the site already
 * serves the right content.
 */
export function outcomeOf(body, dryRun) {
  return {
    tag: isNoChanges(body) ? 'No changes' : (dryRun ? 'Dry run' : 'Committed'),
    record: body,
    dryRun: !!dryRun,
  };
}

/**
 * A thrown error -> the `Failed` row it becomes.
 *
 * `github` carries GitHub's own words on `REF_CONFLICT`, which is the only place the
 * branch-protection failure mode says anything at all. Nothing detects it, because ticket
 * 26 ships no observer.
 */
export function errorOf(err) {
  return {
    text: err instanceof ApiError ? (err.detail || err.message) : String(err),
    remedy: err instanceof ApiError ? err.remedy : null,
    code: err instanceof ApiError ? err.code : null,
    github: err instanceof ApiError ? err.extras.github_message : null,
  };
}

/**
 * Does this publish outcome mean the published bracket page now matches the committed
 * draw?  F40.
 *
 * `brackets_stale` is derived on the SERVER and rides `GET /rr/session`, which a publish
 * does not re-fetch (ticket 12 Q3 declined re-reading the whole evening after a write).
 * So the Draw List tab has to clear it locally or the warning survives its own remedy --
 * re-commit raises it, the operator publishes, and the line stays until an F5. That is
 * defect #10's shape: a stale flag whose documented remedy cannot clear it.
 *
 * **`No changes` counts, and `Dry run` does not.** A NO_CHANGES publish is the one case
 * where the page is provably current -- the tree the server would have written is the tree
 * already on the site -- and the server advances the record's `at` for exactly that reason.
 * A dry run moves no ref and touches no record, so it clears nothing.
 *
 * It reads `outcome.dryRun` rather than the tag because `outcomeOf` lets `isNoChanges` win
 * over `dryRun`: a rehearsal that finds an identical tree is tagged `No changes` while
 * having changed nothing at all. Tag-only logic would clear the flag on a rehearsal.
 */
export function clearsBracketsStale(outcome) {
  if (!outcome || outcome.dryRun) return false;
  return outcome.tag === 'Committed' || outcome.tag === 'No changes';
}

/**
 * Has the bracket page been taken down since it was last published?
 *
 * Both `sleep` and `results` write `/draw-brackets/` -- one removes it outright, the other
 * removes it as one of three outcomes. So a `brackets` record whose timestamp is older than
 * either of theirs describes a page that is no longer there, and its link would 404.
 *
 * Derived from two records that already ride the cold load, so it survives an F5 with no
 * new `store.js` field and no new endpoint.
 *
 * **`at` FIRST, and that is the whole correctness of the cold-load claim above.**
 * `rr_publish_service.py:557-568` writes two shapes from one moment: the record PERSISTED
 * into `events.details["rr_publish"][scope]` carries `at` and nothing else, while the
 * `POST /rr/publish` response body carries `at` **and** `published_at`. Only the response
 * shape ever reaches this function live; everything arriving through
 * `GET /rr/session` -> `store.js` is the persisted shape. Reading `published_at` alone --
 * as this did -- made every cold-load record read `null`, so `brackets` was falsy and the
 * function returned `false` unconditionally: after any F5 the operator saw `Committed` and
 * a live link to a page that had been deleted from the site. `finalize.js:243` already had
 * this right; this and `tabs/draw.js` did not.
 */
export function isTakenDown(rrPublish) {
  const pub = rrPublish || {};
  const at = (rec) => (rec && (rec.at || rec.published_at)) || null;
  const brackets = at(pub.brackets);
  if (!brackets) return false;
  return [at(pub.sleep), at(pub.results)].some((t) => !!t && t > brackets);
}

/**
 * Which notice the Draw List publish panel prints about the bracket page, so its two
 * warnings cannot both render. `bracketsStale` (server, `_brackets_state`) says the page
 * shows an earlier draw; `Taken down` (client, `isTakenDown` above) says the page is gone.
 * When both hold the first premise is false -- there is no page to be wrong -- so the
 * panel prints one sentence carrying both facts instead of two that contradict each
 * other on the way to the same click. Lives here, not in the tab, for the reason
 * `clearsBracketsStale` does.
 *
 * Returns `'down-and-stale'`, `'down'`, `'stale'`, or `null`.
 */
export function bracketsNotice(bracketsStale, publishRow) {
  const down = !!publishRow && publishRow.tag === 'Taken down';
  if (down && bracketsStale) return 'down-and-stale';
  if (down) return 'down';
  if (bracketsStale) return 'stale';
  return null;
}
