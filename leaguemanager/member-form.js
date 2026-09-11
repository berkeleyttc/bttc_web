/**
 * `member-form.js` -- the member record's two form shapes, and the PIN rule.
 *
 * **Why this is not inside `tabs/roster.js`.** The tab reads `window.Vue` at module top,
 * which puts it on the far side of `test/README.md:46`'s line -- `node --test` cannot
 * load it. `publish.js` hit this first and answered it the same way: extract the part
 * that is a *decision* rather than a rendering, and the extraction is what makes it
 * testable. Everything here is pure, and `test/member-form.test.js` reaches all of it.
 *
 * The form has always been one shape for two modes (ticket 30 Q13). Building both shapes
 * here, rather than from a literal at each call site, is what stops a PIN typed for one
 * member reaching another -- see `editFormFor`.
 */

/**
 * The PIN every member carries who never chose one.
 *
 * `bttc_api/helpers/auth_helper.py:180` `UNSET_TOKEN`, enforced at `:306`: `POST /rr/login`
 * refuses it outright. It is written by **both** creation paths --
 * `new_player_signup_service.py:418` for a public signup, `rr_session_service.py:1173` for
 * a walk-in the desk creates -- so it is the value most members hold, and the reason a
 * member promoted to director cannot sign in.
 *
 * **This literal is duplicated across the two repos and nothing enforces the agreement.**
 * Refusing it server-side in `UpdatePlayerRequest.validate_token` was offered and declined
 * (F30, 2026-09-10), so the file and line above are the only thread between them. If that
 * validator ever grows the rule, delete this comment, not the check -- the client still
 * owes the operator a message that says why.
 */
export const UNSET_PIN = '123456';

/**
 * The three brackets, and the `<select>`'s options (ticket 30 Q13).
 *
 * Exported so the tab renders exactly the list `editFormFor` falls back against. Two
 * copies would let the control offer a value the form silently rewrites to `adult`.
 */
export const AGE_OPTIONS = ['youth', 'adult', 'senior'];

/** The create form. Every key the edit form has, so the two cannot diverge. */
export function blankForm() {
  return {
    first_name: '', last_name: '', phone_number: '', email: '',
    latest_rating: '', age_status: 'adult', token: '',
  };
}

/**
 * The edit form, filled from a cached member row.
 *
 * **`token` is always `''`, and that is the point.** Ticket 13 dropped `token` from
 * `PlayerDbSearchResponse` and from `to_dict`'s `'all'` list, so no row in `members.all`
 * carries one and the field could not display a value even if it wanted to. The risk is
 * the other direction: this used to be a partial object literal inside `startEdit`, and a
 * partial literal assigned over a reactive form leaves whatever the *previous* member's
 * edit left behind. A PIN typed, abandoned, and saved onto someone else is a silent
 * lockout of two people at once. Returning a total shape is the fix; it is not a
 * convention anyone has to remember.
 *
 * `email === 'NA'` is blanked because that is what the server stores for "none", and an
 * unknown `age_status` falls back to `adult` because the control is a three-option
 * `<select>` (ticket 30 Q13).
 */
export function editFormFor(member) {
  const m = member || {};
  return {
    first_name: m.first_name ?? '',
    last_name: m.last_name ?? '',
    phone_number: m.phone_number ?? '',
    email: m.email === 'NA' ? '' : (m.email ?? ''),
    latest_rating: m.latest_rating ?? '',
    age_status: AGE_OPTIONS.includes(m.age_status) ? m.age_status : 'adult',
    token: '',
  };
}

/**
 * What is wrong with the PIN the operator typed, or `null` if nothing is.
 *
 * Returns a sentence rather than a code: this renders under the field, and every arm
 * names a rule the operator can act on. Three refusals, in the order the operator needs
 * to hear them:
 *
 * - **Not six digits.** `UpdatePlayerRequest.validate_token` requires `^\d{6}$`
 *   (`new_player_signup_service.py:176-180`). Checked first, so a short PIN is reported as
 *   short rather than as something more exotic.
 * - **A leading zero.** The field is `Optional[int]` and coerced *before* validation
 *   (`:161-168`), so `012345` reaches the validator as `12345` and 422s. Nothing in either
 *   repo can mint a leading-zero PIN -- signup coerces the same way -- so refusing them
 *   here excludes nobody who exists. `LoginRequest.token` is a `str` and would accept one,
 *   which is the asymmetry; widening the write side was offered and declined (F30).
 * - **The unset default.** See `UNSET_PIN`. Setting it looks like a PIN change and is a
 *   lockout, which is precisely the state this field was built to end.
 *
 * Blank is **not** a problem: it means unchanged.
 */
export function pinProblem(raw) {
  const pin = String(raw ?? '').trim();
  if (pin === '') return null;
  if (!/^\d{6}$/.test(pin)) {
    return 'A PIN is exactly six digits.';
  }
  if (pin[0] === '0') {
    return 'A PIN cannot start with 0 — the server stores it as a number and would drop the zero.';
  }
  if (pin === UNSET_PIN) {
    return 'That is the default PIN, and sign-in refuses it. Choose another.';
  }
  return null;
}
