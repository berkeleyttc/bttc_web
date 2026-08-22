# `leaguemanager/test/`

Conformance tests for the two pure domain modules, `draw.js` and `play-order.js`.

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

## Not here yet

- **The CSS cases** (ticket 24 Q19) — the ban on bare `html`, `body`, `*` and `#id`
  selectors under `leaguemanager/`, and the `--lm-grid-*` / `--lm-sheet-*` prefix
  split. There is no `leaguemanager/` CSS yet. The failure they prevent is measured,
  not hypothetical: tickets 09 and 20 define six identically-named tokens at different
  units (`0.95833in` against `84px`).
- **The draft round-trip** (ticket 23 Q17) — serialise the uncommitted draw to
  `bttc_lm_draw_v1_<event_id>`, restore it, re-verify. There is no `store.js` yet.

Both belong to the session that writes them.
