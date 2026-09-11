/**
 * `member-form.js` -- the member edit form's two shapes, and the one rule about a PIN.
 *
 * These live outside `tabs/roster.js` for the same reason `publish.js` exists: the tab
 * imports `window.Vue`, which is the line `test/README.md:46` draws around `node --test`.
 * Extracting them is what makes them testable, and the PIN rule is the first thing on
 * that form that can be *wrong* rather than merely typed -- `POST /rr/login` refuses two
 * of the values an operator could plausibly enter.
 *
 * **The key-set test is the important one.** A PIN field on a form whose edit shape is
 * built from a partial literal is a carry-over waiting to happen: type a PIN for one
 * member, abandon it, edit another, save. `blankForm()` and `editFormFor()` returning the
 * same keys -- `token` always among them, always `''` -- is what makes that impossible
 * rather than merely unlikely.
 *
 * **The name below is invented, and the first one was not.** This file's first draft used a
 * surname that belongs to a real member, and `bttc_api`'s
 * `test_oracles.py::test_no_real_member_name_reaches_the_public_repo` caught it before the
 * commit -- the same guard, and the same mistake, as the seventh session's `search.test.js`.
 * This repository is public. Run that test before adding a name to any file under
 * `leaguemanager/`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UNSET_PIN, blankForm, editFormFor, pinProblem } from '../member-form.js';

describe('pinProblem -- what the desk may set as a PIN', () => {
  it('passes a plain six-digit PIN', () => {
    assert.equal(pinProblem('481902'), null);
  });

  it('treats blank as no change, not as an error', () => {
    // The field can NEVER display the current value: ticket 13 dropped `token` from
    // PlayerDbSearchResponse and from to_dict's 'all' list. Blank therefore has to mean
    // "leave it alone", and an empty form must not be an error the operator has to clear
    // before saving a name.
    assert.equal(pinProblem(''), null);
    assert.equal(pinProblem('   '), null);
    assert.equal(pinProblem(null), null);
    assert.equal(pinProblem(undefined), null);
  });

  it('refuses anything that is not exactly six digits', () => {
    for (const bad of ['12345', '1234567', '12 34 56', 'abcdef', '1234a6', '-12345']) {
      assert.ok(pinProblem(bad), bad + ' must be refused');
      assert.match(pinProblem(bad), /six digits/, bad + ' must say six digits');
    }
  });

  it('refuses a leading zero, which the server cannot store', () => {
    // `UpdatePlayerRequest.token` is Optional[int] and coerces before validating
    // (new_player_signup_service.py:161-180), so "012345" arrives as 12345, fails the
    // six-digit regex and 422s. Refusing it here buys a sentence the operator can act on
    // instead of a validation error from a field they filled in correctly.
    assert.ok(pinProblem('012345'));
    assert.match(pinProblem('012345'), /cannot start with/);
  });

  it('refuses the unset default, which is the whole reason this field exists', () => {
    // bttc_api/helpers/auth_helper.py:180 UNSET_TOKEN, enforced at :306. Setting it
    // writes a PIN that provably cannot sign in -- the exact state F30 was filed to fix.
    assert.equal(UNSET_PIN, '123456');
    assert.ok(pinProblem(UNSET_PIN));
    assert.match(pinProblem(UNSET_PIN), /sign in|sign-in/);
  });

  it('reports the six-digit rule before the more specific ones', () => {
    // Ordering matters only for the message. "12345" is short AND starts with a 1; the
    // operator needs to hear the rule they actually broke.
    assert.match(pinProblem('12345'), /six digits/);
    assert.match(pinProblem('0123456'), /six digits/);
  });
});

describe('the two form shapes -- carry-over is impossible by construction', () => {
  it('blankForm and editFormFor agree on every key', () => {
    const member = {
      user_id: 812, first_name: 'Ada', last_name: 'Brightwater', phone_number: '5105550100',
      email: 'ada@example.com', latest_rating: 1740, age_status: 'senior',
    };
    assert.deepEqual(Object.keys(blankForm()).sort(), Object.keys(editFormFor(member)).sort());
  });

  it('both carry token, and both carry it blank', () => {
    assert.equal(blankForm().token, '');
    assert.equal(editFormFor({ first_name: 'Ada', token: '481902' }).token, '');
  });

  it('editFormFor never reads a token off the member, because none is ever there', () => {
    // PlayerDbSearchResponse has no `token`, so `members.all` rows never carry one. The
    // assertion is against a row that does anyway: nothing may plumb it to the form.
    const form = editFormFor({ first_name: 'Ada', last_name: 'Brightwater', token: '999999' });
    assert.equal(form.token, '');
    assert.equal(JSON.stringify(form).includes('999999'), false);
  });

  it('editFormFor keeps the six fields the form has always edited', () => {
    const form = editFormFor({
      first_name: 'Ada', last_name: 'Brightwater', phone_number: '5105550100',
      email: 'ada@example.com', latest_rating: 1740, age_status: 'senior',
    });
    assert.equal(form.first_name, 'Ada');
    assert.equal(form.last_name, 'Brightwater');
    assert.equal(form.phone_number, '5105550100');
    assert.equal(form.email, 'ada@example.com');
    assert.equal(form.latest_rating, 1740);
    assert.equal(form.age_status, 'senior');
  });

  it('blanks NA and falls back to adult, exactly as the form did before', () => {
    // Both rules are transcribed from tabs/roster.js:149-154 and must not drift: the
    // server stores 'NA' for a missing email, and age_status is a <select> with three
    // options that must not be handed a fourth.
    assert.equal(editFormFor({ email: 'NA' }).email, '');
    assert.equal(editFormFor({ age_status: 'grandmaster' }).age_status, 'adult');
    assert.equal(editFormFor({}).age_status, 'adult');
    assert.equal(editFormFor({}).latest_rating, '');
    assert.equal(editFormFor({}).first_name, '');
  });
});
