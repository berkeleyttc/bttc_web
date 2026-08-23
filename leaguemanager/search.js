/**
 * `search.js` -- the member search, transcribed from the C# and measured against it.
 *
 * Ticket 21 Q5 moved member search from the server to the client. `GET /rr/members`
 * returns all 1,143 once at app mount -- 52 KB raw, 14 KB gzipped, measured -- and the
 * operator's search box filters that array here. That **preserves ticket 12's "no new
 * search endpoint" literally** (a bulk read is not a search endpoint) while correcting
 * the premise underneath it: `/player/db/search` does exact, case-sensitive, per-field
 * equality -- no `LIKE`, no `COLLATE NOCASE` -- so it cannot do substring search and
 * never could.
 *
 * **Why this is a module of its own rather than a closure inside `tabs/roster.js`.**
 * The rules below are a transcription with measured expectations attached -- a bare
 * `"an"` matches 373 of 1,143 and `"o"` matches 494 -- and every tab module imports
 * `window.Vue`, which puts it out of `node --test`'s reach. A transcription with a
 * number attached to it and no test is exactly the drift the rest of this port spends
 * its length preventing. Same reasoning as `persist.js`; both are additions to ticket
 * 23 Q16's manifest rather than departures from it.
 *
 * **What does NOT ship**, all dropped deliberately (ticket 21 Q3):
 *
 * - the **100 ms barcode accommodation** (`RRPrepCode.cs:254-298`), where four digits
 *   typed slower than 100 ms selected phone-suffix search and six selected player-ID
 *   search. Barcodes are F4.
 * - the **mode selector** and the `ByPlayerID` branch as a distinct mode.
 * - the **`WaitlistTokens` magic words** that hijacked the box into a modal waitlist
 *   view at `:203`. A search box that sometimes is not a search box is a legacy
 *   affordance, not a requirement; the capability survives as a permanent segment in
 *   the right rail (ticket 30 Q11).
 * - **the case rule.** `AliasString.cs:86-93` made the comparison case-SENSITIVE iff
 *   the query's first character was uppercase. Forced out by ticket 21 Q1: once
 *   storage preserves what the member typed, stored casing is arbitrary and the rule
 *   selects on nothing. `NarrowMatches` and the load-bearing `Matches || NarrowMatches`
 *   disjunction leave with it -- the disjunction existed to catch the all-caps query
 *   the case rule rejected.
 * - **aliases.** `Aliases.txt` is dropped entirely (ticket 08), which is the other half
 *   of `Player.Matches`.
 *
 * What survives is below, and each piece is traced to the line it came from.
 */

/**
 * The letters-only form, **computed and never stored** (ticket 21 Q6).
 *
 * Legacy stored a shadow of every name -- `GenerateTrimmedAlias`, `AliasString.cs:60-67`
 * -- stripping spaces, apostrophes, hyphens, periods and digits. It is what lets `R.J.`
 * be found by typing `rj`, `O'brien` by `obrien` and `Van Oss` by `vanoss`. The client
 * already holds every name, so the capability is kept and the storage is not: **a
 * constraint on ticket 11, no new column.** Legacy did not persist it either
 * (`TrimmedAlias` is absent from every `.bttc` write) -- it recomputed it on every load
 * and every edit.
 *
 * `\p{L}` matches `Char.IsLetter`'s Unicode-category behaviour, so precomposed `é` is
 * kept and combining marks are dropped, exactly as the C# does. With 0 non-ASCII names
 * in the file today it is latent either way.
 */
export const bare = (s) => String(s ?? '').replace(/[^\p{L}]/gu, '').toLowerCase();

/**
 * One field against one term.
 *
 * **An empty term matches everything**, reproducing `AliasString.Matches`'s first line
 * (`:83-84`). That is not a quirk to tidy away: it is what makes `"Jones,"` mean *every
 * Jones* rather than *no one*, and the operator types exactly that on the way to
 * `"Jones, Bob"`.
 *
 * The bare arm is skipped when the query has no letters in it. Without that guard an
 * all-digit query would compute `bare(q) === ''`, and `String.includes('')` is true for
 * every string -- so typing a phone number would match all 1,143 members.
 */
export function matchField(value, term) {
  if (!term) return true;
  const v = String(value ?? '');
  if (v.toLowerCase().includes(term.toLowerCase())) return true;
  const bq = bare(term);
  return bq !== '' && bare(v).includes(bq);
}

/** Split on the first separator only, so `"Bob Van Oss"` is `["Bob", "Van Oss"]`. */
function splitOnce(text, sep) {
  const i = text.indexOf(sep);
  return [text.slice(0, i).trim(), text.slice(i + sep.length).trim()];
}

/**
 * Parse the query into the shape `RepopulateAPLVWithFilter` is called with.
 *
 * `ApplyNewListFilter` (`RRPrepCode.cs:180-236`) fixes the assignment by **which
 * separator it found**, and does not try both orders:
 *
 * - a **comma** sets `j = 1`, so `names[1]` is the first name and `names[0]` the last
 *   -- `"Jones, Bob"` is *last, first*;
 * - a **space** with no comma leaves `j = 0`, so `names[0]` is the first name --
 *   `"Bob Jones"` is *first last*.
 *
 * Both AND across the two fields. Operator muscle memory, and nearly free.
 *
 * The PDL above that method claims a capital letter *"adjusts the search criteria to
 * look for that (sub)string at the beginning of the first or last name"*. **It does
 * not.** `Char.IsUpper` appears only in the construction of `searchmsg`, a status
 * label. ADR 0003: a commented feature with no executed statements behind it is a
 * candidate requirement, never a described behaviour.
 */
export function parseQuery(raw) {
  const target = String(raw ?? '').trim();
  if (!target) return { kind: 'empty' };
  if (target.includes(',')) {
    const [last, first] = splitOnce(target, ',');
    return { kind: 'pair', first, last };
  }
  const space = target.search(/\s/);
  if (space >= 0) {
    const [first, last] = splitOnce(target, target[space]);
    return { kind: 'pair', first, last };
  }
  return { kind: 'single', term: target };
}

/**
 * Does this member match?
 *
 * A single term is OR'd across the two name fields. All-digit queries **additionally**
 * match `external_user_id` exactly and `phone_number` by contains -- additionally, so a
 * member whose name contains those digits is still found. Digits never reach the pair
 * branch, because a bare number contains neither a comma nor a space.
 *
 * Why the digit arms matter more than they look: **F3 records that ~1,000 imported
 * members have no phone number at all**, which makes name search the primary door
 * lookup across 1,143 people. The digit arms are for the members who do.
 */
export function matchesMember(member, parsed) {
  if (parsed.kind === 'empty') return false;
  const first = member.first_name;
  const last = member.last_name;

  if (parsed.kind === 'pair') {
    return matchField(first, parsed.first) && matchField(last, parsed.last);
  }

  const term = parsed.term;
  if (matchField(first, term) || matchField(last, term)) return true;

  if (/^\d+$/.test(term)) {
    if (String(member.bttc_id ?? '') === term) return true;
    if (String(member.phone_number ?? '').includes(term)) return true;
  }
  return false;
}

/**
 * The cap, and the reason there is one.
 *
 * Ticket 21 Q5 measured the problem and handed the remedy to ticket 23, which did not
 * take it: **a bare `"an"` matches 373 of 1,143 and `"o"` matches 494.** Legacy hid
 * this behind the mode-switching that ticket 21 Q3 drops. Rendering 373 rows into a
 * list view at the door is the failure mode.
 *
 * The answer is **the count always, and the rows capped**. `total` is what tells the
 * operator the query is too broad; the cap is what keeps the DOM small. A minimum query
 * length was rejected on two grounds: `"an"` is only two characters and still matches
 * 373, so it does not solve the measured case; and `Ng`, `Yu` and `Xu` are real
 * surnames that would become unsearchable at the one moment it matters. Virtual
 * scrolling was rejected as the most machinery in a repo with no bundler, answering the
 * DOM-size problem while leaving the real one -- 373 rows is not a list a human reads
 * at a desk -- exactly where it was.
 */
export const RESULT_CAP = 50;

export function filterMembers(all, raw, cap = RESULT_CAP) {
  const parsed = parseQuery(raw);
  if (parsed.kind === 'empty') return { total: 0, rows: [], capped: false, parsed };
  const rows = [];
  let total = 0;
  for (const m of all) {
    if (!matchesMember(m, parsed)) continue;
    total += 1;
    if (rows.length < cap) rows.push(m);
  }
  return { total, rows, capped: total > rows.length, parsed };
}

/**
 * The duplicate warning, client-side and pre-commit (ticket 21 Q7).
 *
 * With all 1,143 names in the browser the warning can fire **while the operator is
 * still typing** -- which is exactly what legacy did, and the only moment at which a
 * warning can still change the outcome. `possible_duplicates` was therefore removed
 * from `POST /rr/member`'s response; computing it in both places would put the same
 * rule in JS and in Python and require them to agree forever.
 *
 * Two legacy rules reproduced exactly:
 *
 * 1. **Silent until BOTH fields are non-empty** (`Form1.cs:2226`). That is the guard
 *    that stops the empty-query-matches-everything trap from listing all 1,143 -- and
 *    it falls straight out of `matchField`'s "an empty term matches everything", which
 *    is why the guard has to be explicit rather than emergent.
 * 2. **The create button is never disabled.** `GenerateNewPlayer` never consulted the
 *    panel either. It is advisory, and same-name walk-ins are real -- the reference
 *    file has a father and son.
 */
export function possibleDuplicates(all, firstName, lastName, cap = 10) {
  const f = String(firstName ?? '').trim();
  const l = String(lastName ?? '').trim();
  if (!f || !l) return [];                       // rule 1, Form1.cs:2226
  const out = [];
  for (const m of all) {
    if (matchField(m.first_name, f) && matchField(m.last_name, l)) {
      out.push(m);
      if (out.length >= cap) break;
    }
  }
  return out;
}
