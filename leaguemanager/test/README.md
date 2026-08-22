# `leaguemanager/test/`

Conformance tests for the pure domain modules — `draw.js`, `play-order.js` and
`print.js` — and for the printed surface's stylesheet.

```sh
node --test 'leaguemanager/test/*.test.js'
```

**Quote the glob.** Node 24 resolves a bare directory argument as a module path and
fails with `Cannot find module`; the quoted glob is what the runner expects.

## What this is

Ticket 05 put the draw, play order and table assignment **in the browser**, against the
recommendation, and named the cost: those are load-bearing algorithms with a second
implementation that can drift. This directory is what pays it.

The fixtures are emitted by Python oracles in the private `bttc_api` repo
(`tests/oracles/`), which run against the club's real Jul 17 session. **Python is the
definition of correct; the JS is the thing under test.** Ticket 07 designed nothing on
this surface — it is all transcription of the C# — so the required standard is **zero
declared divergences**. A failure here is a port bug, never a design difference.

Two real examples of what that catches, both demonstrated by mutation:

- writing `runningSum / distrib.length` instead of `Math.floor(...)`. The C# does
  `long / int`, so the efficiency average is integer division. JS has no integer
  division and the mistake is invisible by inspection.
- dropping `users.id` from `compareNameKeys`. The collation stops being a total order,
  which is precisely the non-determinism ticket 08's comparator exists to remove.

## No build step

No `package.json`, no `node_modules`, no bundler — `bttc_web`'s `CLAUDE.md` forbids
introducing one and ticket 05 may not reopen it. These are native ES modules, so
`node --test` and `<script type="module">` load **literally the same bytes**. Under a
classic-script alternative `draw.js` and `play-order.js` would have to exist in two
formats at once and the harness would be testing a copy.

`draw.js` and `play-order.js` have **zero** dependency on `ENV`, `bttc-utils.js`,
`window` or `fetch`. That is not incidental — it is what makes them importable here.
The line between "runs in `node --test`" and "runs only in a browser" is exactly the
line between the pure domain files and everything else, so the seven tab modules,
which import `window.Vue` from the CDN build, are not testable this way.

## `fixtures/`

Anonymised and date-stamped. Names are **rank-assigned synthetic labels in real
`name_key` order**, so lexicographic comparison of the labels reproduces the real
ordering by construction and both of the session's rating ties land on the side they
really did. Member ids travel real.

Before emitting, the oracle runs the draw twice — on the real roster and on the
relabelled one — and **refuses** unless the partition, the promotions, the play order
and the table labels come out identical. It then scans the serialised output against
every real name in the roster and refuses again on any hit. This repo is public and
the branch has an upstream.

Regenerate from a `bttc_api` checkout:

```sh
python3 tests/oracles/oracle_solutions.py  --emit-fixture
python3 tests/oracles/oracle_partition.py  --emit-fixture
python3 tests/oracles/oracle_play_order.py --emit-fixture
```

**Staleness is visible, not enforced** (ticket 24 Q16): the `_source` block records
what emitted a fixture and from which commit, and nothing here checks it. The nearest
thing to a check lives on the private side, in
`bttc_api/tests/test_oracles.py::test_the_emitted_fixtures_are_not_stale`, which
compares these files against what the oracles produce today whenever both repos are
checked out side by side.

## `css.test.js` — the printed surface's scoping rules

Ticket 24 Q19's two greppable cases, now that `print.css` exists. They enforce ticket 23
Q10 from the public side, where a developer editing the CSS will actually run them:

1. **No bare `html`, `body`, `*` or `#id` rule** anywhere under `leaguemanager/` —
   `.css` files and `<style>` blocks in `.html` alike. `#lm-app` itself is the one
   permitted top-level selector, because ticket 23 Q9 puts the `_ds` tokens on it
   precisely so they cannot reach the other four apps.
2. **The two grid token sets are prefixed apart** — `--lm-grid-*` for ticket 20's screen
   entry grid, `--lm-sheet-*` for the printed sheet — and no custom property is defined
   at two different values.

The failure they prevent is **measured**: tickets 09 and 20 both define `--cell-w`,
`--cell-half`, `--label-band`, `--box-band`, `--row-gap` and `--rule` at different units
(`0.95833in` against `84px`), and unprefixed, whichever stylesheet loads last silently
rescales the other grid.

A third case came out of building it, and it is the sharpest of the three. The preview
harness's rules are written `#lm-app.lm-print-preview …` — an id plus two classes — so a
plain `#lm-app …` reset inside `@media print` **loses** to them. The preview's 1.5rem of
padding survived onto the paper and pushed every artifact a fraction past 11in: Chrome
printed **6 pages for 4 artifacts**, one blank after each, at a MediaBox that was correct
either way. So `css.test.js` requires every `.lm-print-preview` selector to be reset at
its own specificity inside `@media print`.

The same properties are asserted from the private side too, in
`bttc_api/tests/test_print_surface.py`, which is what registers `print/score_sheet` and
`print/table_map` in the divergence register.

## Not here yet

- **The draft round-trip** (ticket 23 Q17) — serialise the uncommitted draw to
  `bttc_lm_draw_v1_<event_id>`, restore it, re-verify. There is no `store.js` yet.

It belongs to the session that writes it.
