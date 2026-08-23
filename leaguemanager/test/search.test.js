/**
 * The member search -- ticket 21 Q3, Q6 and Q7, as transcribed in `search.js`.
 *
 * **The transcription was checked against the real file before this test was written.**
 * Run over the 1,143 members of `RR_Results_2026Jul17.bttc`, `filterMembers` returns
 * **373** for a bare `"an"` and **494** for `"o"` -- the two numbers ticket 21 Q5
 * measured, reproduced exactly. That check cannot live here: this repository is public
 * and the member file is not, so what lands is the synthetic set below and the counts
 * are recorded as the reason to trust it. The same split the `fixtures/` directory
 * already makes.
 *
 * The names below are invented. Each one exists to pin a specific rule, and the
 * shapes are what matter: a two-word surname for the `vandreel` collapse, an
 * apostrophe for `omarden`, an apostrophe-hyphen-suffix string for `bare`, and a
 * pair differing only by a trailing period for the duplicate warning.
 *
 * **Corrected in the seventh session.** Three of these rows were NOT invented --
 * they were real members, carried over from the file while the surrounding prose
 * said otherwise, and `bttc_api`'s `test_oracles.py::test_no_real_member_name_reaches_the_public_repo`
 * had been failing on them since this file landed. That test scans this public tree
 * against the real roster, and it was right. Replaced in shape, not in meaning:
 * every assertion below pins exactly the rule it pinned before.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  bare, matchField, parseQuery, matchesMember, filterMembers, possibleDuplicates,
  RESULT_CAP,
} from '../search.js';

const M = (first, last, extra = {}) => ({
  first_name: first, last_name: last, bttc_id: '', phone_number: '', ...extra,
});

const PEOPLE = [
  M('Bob', 'Marsh', { bttc_id: '104822', phone_number: '5105551212' }),
  M('Roberta', 'Marshbury'),
  M('R.J.', 'Ng'),
  M('Ilse', 'Van Dreel'),
  M('Ivo', "O'Marden"),
  M('mary', 'mcdonald'),          // ticket 21 Q1: stored casing is arbitrary now
  M('MARY', 'MACDONALD'),
  M('Kit', 'Andersen', { phone_number: '4155559911' }),
  M('Dax Jr', 'Quillanverde'),
  M('Dax Jr.', 'Quillanverde'),     // the file's one real duplicate shape, invented
];

describe('one search box, no modes — ticket 21 Q3', () => {
  it('is a substring across BOTH name fields, OR’d', () => {
    // Player.Matches -> AliasString.Matches is Contains, not StartsWith. The PDL above
    // ApplyNewListFilter claims a capital letter switches to a prefix match; Char.IsUpper
    // appears only in the status-label string. ADR 0003.
    // 'arsh' is deliberately NOT a prefix of either name -- that is the whole point.
    const hits = filterMembers(PEOPLE, 'arsh').rows;
    assert.deepEqual(hits.map((m) => m.last_name), ['Marsh', 'Marshbury']);
  });

  it('is case-insensitive in both directions, because stored casing is arbitrary', () => {
    // Ticket 21 Q1 stopped title-casing names, which forced out AliasString.cs:86-93's
    // case-sensitive-iff-initial-caps rule: once storage preserves what the member
    // typed, the rule selects on nothing.
    assert.equal(filterMembers(PEOPLE, 'MARY').total, 2);
    assert.equal(filterMembers(PEOPLE, 'mary').total, 2);
    assert.equal(filterMembers(PEOPLE, 'McDonald').total, 1);
    assert.equal(filterMembers(PEOPLE, 'mcdonald').total, 1);
  });

  it('finds nothing for an empty or blank box rather than everything', () => {
    // AliasString.Matches returns TRUE for an empty match string, which is right
    // inside a two-term query and catastrophic as the whole query.
    assert.equal(filterMembers(PEOPLE, '').total, 0);
    assert.equal(filterMembers(PEOPLE, '   ').total, 0);
  });
});

describe('punctuation-insensitive, computed not stored — ticket 21 Q6', () => {
  it('finds R.J. from rj and Van Dreel from vandreel', () => {
    assert.equal(filterMembers(PEOPLE, 'rj').rows[0].last_name, 'Ng');
    assert.equal(filterMembers(PEOPLE, 'vandreel').rows[0].first_name, 'Ilse');
    assert.equal(filterMembers(PEOPLE, 'omarden').rows[0].first_name, 'Ivo');
  });

  it('strips by Unicode letter category, matching Char.IsLetter', () => {
    assert.equal(bare("O'Marden-Vale Jr."), 'omardenvalejr');
    assert.equal(bare('R.J.'), 'rj');
    assert.equal(bare('104822'), '');
  });

  it('does NOT let an all-digit query match every member through the bare arm', () => {
    // The trap: bare('5105551212') is '', and String.includes('') is true for every
    // string, so an unguarded bare arm would return all 1,143 for a phone number.
    const r = filterMembers(PEOPLE, '5105551212');
    assert.equal(r.total, 1);
    assert.equal(r.rows[0].last_name, 'Marsh');
  });
});

describe('the comma/space two-term split — RRPrepCode.cs:180-236', () => {
  it('reads a comma as "last, first"', () => {
    // A comma sets j = 1, so names[1] is the FIRST name.
    assert.equal(filterMembers(PEOPLE, 'Marsh, Bob').total, 1);
    assert.equal(filterMembers(PEOPLE, 'Bob, Marsh').total, 0);
  });

  it('reads a space as "first last"', () => {
    // No comma leaves j = 0, so names[0] is the FIRST name.
    assert.equal(filterMembers(PEOPLE, 'Bob Marsh').total, 1);
    assert.equal(filterMembers(PEOPLE, 'Marsh Bob').total, 0);
  });

  it('splits on the FIRST separator only, so a two-word surname survives', () => {
    assert.deepEqual(parseQuery('Ilse Van Dreel'), { kind: 'pair', first: 'Ilse', last: 'Van Dreel' });
    assert.equal(filterMembers(PEOPLE, 'Ilse Van Dreel').total, 1);
  });

  it('treats a trailing comma as "every Marsh", not as no one', () => {
    // AliasString.Matches:83-84 -- an empty match string matches everything. The
    // operator types exactly this on the way to "Marsh, Bob".
    assert.equal(filterMembers(PEOPLE, 'Marsh,').total, 2);
  });

  it('ANDs the two terms across the two fields', () => {
    assert.equal(filterMembers(PEOPLE, 'Roberta Marsh').total, 1);
    assert.equal(filterMembers(PEOPLE, 'Roberta Andersen').total, 0);
  });
});

describe('the digit arms — additional, never exclusive', () => {
  it('matches external_user_id EXACTLY', () => {
    assert.equal(filterMembers(PEOPLE, '104822').total, 1);
    assert.equal(filterMembers(PEOPLE, '10482').total, 0, 'a prefix is not a bttc_id match');
  });

  it('matches phone_number by CONTAINS, which is what a four-digit suffix needs', () => {
    // The mode machine that made four digits mean "phone suffix" is gone (F4 owns
    // barcodes); contains covers the same operator gesture with no timer.
    assert.equal(filterMembers(PEOPLE, '9911').total, 1);
  });

  it('is additional: a name containing the digits still matches', () => {
    const people = [...PEOPLE, M('7', 'Seven', { bttc_id: '999' })];
    assert.equal(filterMembers(people, '7').total, 1);
  });
});

describe('the cap and the count — this session’s call on ticket 21 Q5', () => {
  it('reports the true total while capping the rows', () => {
    // Measured on the real file: "an" matches 373 of 1,143 and "o" matches 494. The
    // count is what tells the operator the query is too broad; the cap is what keeps
    // the DOM small.
    const many = Array.from({ length: 400 }, (_, i) => M('Ann' + i, 'Person'));
    const r = filterMembers(many, 'ann');
    assert.equal(r.total, 400);
    assert.equal(r.rows.length, RESULT_CAP);
    assert.equal(r.capped, true);
  });

  it('does not claim to be capped when it is not', () => {
    const r = filterMembers(PEOPLE, 'Marsh,');
    assert.equal(r.capped, false);
    assert.equal(r.rows.length, r.total);
  });

  it('has no minimum query length — Ng, Yu and Xu are real surnames', () => {
    assert.equal(filterMembers(PEOPLE, 'ng').total > 0, true);
  });
});

describe('the duplicate warning — ticket 21 Q7', () => {
  it('stays silent until BOTH fields are non-empty — Form1.cs:2226', () => {
    // The guard that stops the empty-query-matches-everything trap from listing all
    // 1,143 in a panel meant to show two or three candidates.
    assert.deepEqual(possibleDuplicates(PEOPLE, 'Dax Jr', ''), []);
    assert.deepEqual(possibleDuplicates(PEOPLE, '', 'Quillanverde'), []);
    assert.deepEqual(possibleDuplicates(PEOPLE, '  ', '  '), []);
  });

  it('finds the file’s real duplicate shape once both are filled', () => {
    // "Dax Jr" / "Dax Jr." Quillanverde -- the shape of F5's first concrete
    // instance: one human, two rated rows, distinguished only by a trailing period.
    const hits = possibleDuplicates(PEOPLE, 'Dax Jr', 'Quillanverde');
    assert.equal(hits.length, 2);
  });

  it('is advisory only — it returns candidates and decides nothing', () => {
    // GenerateNewPlayer never consulted the panel either, and POST /rr/member never
    // 409s on a name. Same-name walk-ins are real: a father and a son.
    assert.equal(typeof possibleDuplicates(PEOPLE, 'Bob', 'Marsh'), 'object');
  });
});

describe('the rules that deliberately do NOT ship', () => {
  it('has no waitlist magic words hijacking the box', () => {
    // RRPrepCode.cs:203 intercepted WaitlistTokens before any name matching and
    // switched the list into a modal waitlist view. The capability survives as a
    // permanent segment in the right rail (ticket 30 Q11); the trigger does not.
    for (const word of ['waitlist', 'wait', 'wl']) {
      const r = filterMembers([...PEOPLE, M('Wait', 'Lister')], word);
      // It is an ordinary substring query and nothing else.
      assert.deepEqual(r.rows.map((m) => m.first_name),
        filterMembers([...PEOPLE, M('Wait', 'Lister')], word).rows.map((m) => m.first_name));
    }
    assert.equal(filterMembers(PEOPLE, 'waitlist').total, 0);
  });

  it('has no mode selector — parseQuery returns only empty, single or pair', () => {
    const kinds = new Set(['', 'bob', '1234', 'a,b', 'a b'].map((q) => parseQuery(q).kind));
    assert.deepEqual([...kinds].sort(), ['empty', 'pair', 'single']);
  });

  it('matchField treats an empty term as a match, which is the C# contract', () => {
    assert.equal(matchField('anything', ''), true);
    assert.equal(matchField('', 'x'), false);
    assert.equal(matchesMember(M('a', 'b'), { kind: 'empty' }), false);
  });
});
