// UnderWeb Court Phase 1: rules and flows, run against the in-memory store (same constraints as the migration).
// Run: node --test tests/court/court.test.mjs   (from the repository root)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCourtHandler } from '../../supabase/functions/court/handler.ts';
import * as L from '../../supabase/functions/court/logic.ts';
import { createWorld, WORKER_TOKEN, GUILD, UID } from './fake-store.ts';

const D1 = '11111111111111111', D2 = '22222222222222222', D3 = '33333333333333333';

function app() {
  const w = createWorld();
  const h = createCourtHandler({ siteOrigin: 'https://underweb.cloud', guildId: GUILD, claimPepper: 'p'.repeat(48) }, w.store, w.auth);
  const call = async (body, opts = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.worker) headers.authorization = `Bearer ${WORKER_TOKEN}`;
    if (opts.badWorker) headers.authorization = `Bearer ${'cd'.repeat(32)}`;
    if (opts.origin) headers.origin = opts.origin;
    const res = await h.handle(new Request('https://x.test/court', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const get = async (params) => {
    const res = await h.handle(new Request(`https://x.test/court?${new URLSearchParams(params)}`));
    return { status: res.status, body: await res.json() };
  };
  return { w, call, get };
}

const fileAs = (a, token, defendantUserId, extra = {}) =>
  a.call({ action: 'file', defendant_user_id: defendantUserId, accusation_id: 'UW-C-001', damages_requested: 5000, ...extra }, { token });

// ---------------------------------------------------------------- public reads
test('public reads need no login, show only public cases, and hide private ones', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u2);
  assert.equal(filed.status, 200);
  const list = await a.get({ action: 'list' });
  assert.equal(list.body.cases.length, 0, 'a private case is not listed');
  const hidden = await a.get({ action: 'case', case_no: String(filed.body.case_no) });
  assert.equal(hidden.status, 404, 'a private case is not readable by the public');
  const reasons = await a.get({ action: 'reasons' });
  assert.ok(reasons.body.reasons.some((r) => r.id === 'UW-C-001'));
  assert.ok(!reasons.body.reasons.some((r) => r.id === 'UW-C-900'), 'disabled reasons are not offered');
});

// ---------------------------------------------------------------- linked members: file, respond, decline, cooldown
test('a linked member can file; the defendant alone can answer; decline ends the case; one filing per day', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u2);
  assert.equal(filed.status, 200);
  assert.equal((await a.call({ action: 'respond', case_no: filed.body.case_no, decision: 'accept' }, { token: 'tok-u1' })).body.error, 'NOT_THE_DEFENDANT');
  const declined = await a.call({ action: 'respond', case_no: filed.body.case_no, decision: 'decline' }, { token: 'tok-u2' });
  assert.equal(declined.body.status, 'declined');
  assert.equal((await a.call({ action: 'respond', case_no: filed.body.case_no, decision: 'accept' }, { token: 'tok-u2' })).body.error, 'NOT_WAITING_FOR_ANSWER');
  const again = await fileAs(a, 'tok-u1', UID.u3);
  assert.equal(again.body.error, 'FILING_COOLDOWN', 'a second filing in 24 hours is refused, even after a decline');
});

test('blocking stops future suits from that player, and ends the pending one', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u2);
  const blocked = await a.call({ action: 'block', case_no: filed.body.case_no }, { token: 'tok-u2' });
  assert.equal(blocked.status, 200);
  const retry = await fileAs(a, 'tok-u1', UID.u2);
  assert.equal(retry.body.error, 'NOT_ACCEPTING_FROM_YOU', 'the refusal does not reveal the block itself');
});

test('turning courtroom participation off refuses everyone, and turning it back on restores it', async () => {
  const a = app();
  await a.call({ action: 'accepting', accepting: false }, { token: 'tok-u3' });
  assert.equal((await fileAs(a, 'tok-u1', UID.u3)).body.error, 'NOT_ACCEPTING_FROM_YOU');
  await a.call({ action: 'accepting', accepting: true }, { token: 'tok-u3' });
  assert.equal((await fileAs(a, 'tok-u1', UID.u3)).status, 200);
});

test('one open case per plaintiff; countersuits go only to the original defendant', async () => {
  const a = app();
  const first = await fileAs(a, 'tok-u1', UID.u3);
  await a.call({ action: 'respond', case_no: first.body.case_no, decision: 'accept' }, { token: 'tok-u3' });
  assert.equal((await fileAs(a, 'tok-u1', UID.u2)).body.error, 'OPEN_CASE_EXISTS');

  const wrongPerson = await a.call({ action: 'file', countersuit_case_no: first.body.case_no, accusation_id: 'UW-C-002', damages_requested: 100 }, { token: 'tok-u2' });
  assert.equal(wrongPerson.body.error, 'COUNTERSUIT_NOT_THE_DEFENDANT');
  const self = await a.call({ action: 'file', countersuit_case_no: first.body.case_no, accusation_id: 'UW-C-002', damages_requested: 100 }, { token: 'tok-u1' });
  assert.equal(self.body.error, 'SELF_SUIT');

  const counter = await a.call({ action: 'file', countersuit_case_no: first.body.case_no, accusation_id: 'UW-C-002', damages_requested: 100 }, { token: 'tok-u3' });
  assert.equal(counter.status, 200);
  const original = [...a.w.cases.values()].find((x) => x.case_no === first.body.case_no);
  const counterCase = [...a.w.cases.values()].find((x) => x.case_no === counter.body.case_no);
  assert.equal(counterCase.countersuit_of, original.id, 'the countersuit points at the original case');
});

// ---------------------------------------------------------------- Discord participants, community voting, publication
test('Discord participants file, answer and vote without any website account; votes are one per person with a change limit', async () => {
  const a = app();
  const filed = await a.call({ action: 'worker_file', discordUserId: D1, discordName: 'Dana', defendantDiscordId: D2, defendantName: 'Eli',
    accusation_id: 'UW-C-001', damages: 2000 }, { worker: true });
  assert.equal(filed.status, 200);
  const cn = filed.body.case_no;
  assert.equal((await a.call({ action: 'worker_status', case_no: cn }, { worker: true })).status, 404, 'private Discord case is not public');
  assert.equal((await a.call({ action: 'worker_respond', discordUserId: D2, discordName: 'Eli', case_no: cn, decision: 'accept' }, { worker: true })).body.status, 'accepted');

  assert.equal((await a.call({ action: 'worker_consent_publish', discordUserId: D1, case_no: cn, granted: true }, { worker: true })).body.publication, 'private');
  assert.equal((await a.call({ action: 'worker_consent_publish', discordUserId: D2, case_no: cn, granted: true }, { worker: true })).body.publication, 'private',
    'both consents alone do not publish: a judge must approve');
  const approved = await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' });
  assert.equal(approved.body.publication, 'public');

  const pub = await a.get({ action: 'case', case_no: String(cn) });
  assert.equal(pub.body.case.plaintiff, 'A Discord member', 'Discord names are never shown publicly');
  assert.equal(pub.body.case.defendant, 'A Discord member');

  const pending = await a.call({ action: 'worker_pending' }, { worker: true });
  assert.ok(pending.body.items.some((i) => i.kind === 'poll'), 'an open poll is queued for Discord');

  assert.equal((await a.call({ action: 'worker_vote', discordUserId: D1, case_no: cn, choice: 'guilty' }, { worker: true })).body.error, 'PARTY_CANNOT_VOTE');
  const D3votes = ['guilty', 'not_guilty', 'guilty', 'not_guilty'];
  for (const choice of D3votes) {
    const r = await a.call({ action: 'worker_vote', discordUserId: D3, case_no: cn, choice }, { worker: true });
    assert.equal(r.status, 200, `vote ${choice}`);
  }
  assert.equal((await a.call({ action: 'worker_vote', discordUserId: D3, case_no: cn, choice: 'guilty' }, { worker: true })).body.error, 'VOTE_CHANGE_LIMIT');
  const same = await a.call({ action: 'worker_vote', discordUserId: D3, case_no: cn, choice: 'not_guilty' }, { worker: true });
  assert.equal(same.body.unchanged, true);
  const view = await a.get({ action: 'case', case_no: String(cn) });
  assert.deepEqual(view.body.case.poll.tally, { guilty: 0, not_guilty: 1 }, 'the community tally is shown, and the jury is kept separate');

  await a.call({ action: 'verdict', case_no: cn, verdict: 'not_guilty' }, { token: 'tok-judge' });
  assert.equal((await a.call({ action: 'worker_vote', discordUserId: D2, case_no: cn, choice: 'guilty' }, { worker: true })).body.error, 'PARTY_CANNOT_VOTE');
  assert.equal((await a.call({ action: 'worker_vote', discordUserId: D1, case_no: cn, choice: 'guilty' }, { worker: true })).body.error, 'PARTY_CANNOT_VOTE');
  const late = await a.call({ action: 'worker_vote', discordUserId: '44444444444444444', case_no: cn, choice: 'guilty' }, { worker: true });
  assert.equal(late.body.error, 'POLL_CLOSED', 'the poll closes when the verdict is recorded');
});

test('publication needs both parties to consent and a judge to approve; neither the bot nor a player can skip it', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u3);
  const cn = filed.body.case_no;
  await a.call({ action: 'respond', case_no: cn, decision: 'accept' }, { token: 'tok-u3' });
  assert.equal((await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' })).body.error, 'NEEDS_BOTH_CONSENTS');
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u1' });
  assert.equal((await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' })).body.error, 'NEEDS_BOTH_CONSENTS', 'one side is not enough');
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u3' });
  assert.equal((await a.get({ action: 'list' })).body.cases.length, 0, 'both consents do not publish without a judge');
  assert.equal((await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-u1' })).body.error, 'FORBIDDEN', 'a player cannot approve');
  assert.equal((await a.call({ action: 'worker_approve_publication', case_no: cn }, { worker: true })).body.error, 'NOT_FOUND', 'the bot has no such action');
  await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' });
  assert.equal((await a.get({ action: 'list' })).body.cases.length, 1);

  await a.call({ action: 'consent_publish', case_no: cn, granted: false }, { token: 'tok-u3' });
  assert.equal((await a.get({ action: 'list' })).body.cases.length, 0, 'withdrawing consent pulls the case back to private');
});

test('a judge can take a public case off the record in one step, and it can be published again', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u3);
  const cn = filed.body.case_no;
  await a.call({ action: 'respond', case_no: cn, decision: 'accept' }, { token: 'tok-u3' });
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u1' });
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u3' });
  await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' });
  assert.equal((await a.get({ action: 'list' })).body.cases.length, 1);
  const off = await a.call({ action: 'unpublish', case_no: cn }, { token: 'tok-judge' });
  assert.equal(off.status, 200, 'the database rule (public needs approval) is respected');
  assert.equal((await a.get({ action: 'list' })).body.cases.length, 0);
  assert.equal((await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' })).body.publication, 'public', 'consents still stand, so approval publishes it again');
});

test('a removal request makes the case private at once, and it can be reviewed by a judge', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u3);
  const cn = filed.body.case_no;
  await a.call({ action: 'respond', case_no: cn, decision: 'accept' }, { token: 'tok-u3' });
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u1' });
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u3' });
  await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' });
  const r = await a.call({ action: 'request_removal', case_no: cn }, { token: 'tok-u3' });
  assert.equal(r.body.publication, 'private');
  assert.equal((await a.get({ action: 'list' })).body.cases.length, 0);
  await a.call({ action: 'unpublish', case_no: cn }, { token: 'tok-judge' });
});

// ---------------------------------------------------------------- verdicts, settlements, announcements
test('verdicts and settlements are announced only for public cases, and the Discord text never mentions anyone', async () => {
  const a = app();
  const private1 = await fileAs(a, 'tok-u1', UID.u3);
  await a.call({ action: 'respond', case_no: private1.body.case_no, decision: 'accept' }, { token: 'tok-u3' });
  assert.equal((await a.call({ action: 'verdict', case_no: private1.body.case_no, verdict: 'guilty' }, { token: 'tok-judge' })).status, 200);
  assert.equal(a.w.announcementsList().length, 0, 'a private verdict is not announced');

  const filed = await a.call({ action: 'worker_file', discordUserId: D1, discordName: 'Dana', defendantDiscordId: D2, defendantName: 'Eli',
    accusation_id: 'UW-C-001', damages: 900 }, { worker: true });
  const cn = filed.body.case_no;
  assert.equal((await a.call({ action: 'verdict', case_no: cn, verdict: 'guilty' }, { token: 'tok-judge' })).body.error, 'CASE_NOT_OPEN');
  assert.equal((await a.call({ action: 'settle', case_no: cn, amount: 1200 }, { token: 'tok-judge' })).body.status, 'settled');
  assert.equal(a.w.announcementsList().length, 0, 'nothing is announced until the case is public');
  await a.call({ action: 'worker_respond', discordUserId: D2, discordName: 'Eli', case_no: cn, decision: 'decline' }, { worker: true });
});

test('a public verdict is queued once, rendered without mentions, and acknowledged by the bot', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u3);
  const cn = filed.body.case_no;
  await a.call({ action: 'respond', case_no: cn, decision: 'accept' }, { token: 'tok-u3' });
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u1' });
  await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u3' });
  await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' });
  await a.call({ action: 'verdict', case_no: cn, verdict: 'guilty' }, { token: 'tok-judge' });
  const pending = await a.call({ action: 'worker_pending' }, { worker: true });
  const item = pending.body.items.find((i) => i.kind === 'verdict');
  assert.ok(item, 'the verdict is queued');
  assert.match(item.text, /GUILTY/);
  assert.doesNotMatch(item.text, /<@|@everyone|@here/);
  await a.call({ action: 'worker_ack', id: item.id, messageId: '55555555555555555' }, { worker: true });
  assert.equal((await a.call({ action: 'worker_pending' }, { worker: true })).body.items.some((i) => i.id === item.id), false, 'posted once');
});

test('the judge check and the Discord credential are enforced on every gated action', async () => {
  const a = app();
  const filed = await fileAs(a, 'tok-u1', UID.u3);
  const cn = filed.body.case_no;
  assert.equal((await a.call({ action: 'verdict', case_no: cn, verdict: 'guilty' }, { token: 'tok-u1' })).body.error, 'FORBIDDEN');
  assert.equal((await a.call({ action: 'verdict', case_no: cn, verdict: 'guilty' }, { token: 'tok-bad' })).status, 401);
  assert.equal((await a.call({ action: 'verdict', case_no: cn, verdict: 'guilty' })).status, 401, 'no login is refused');
  assert.equal((await a.call({ action: 'worker_pending' }, { badWorker: true })).status, 401, 'a wrong bot credential is refused');
  assert.equal((await a.call({ action: 'worker_pending' }, { worker: true, origin: 'https://underweb.cloud' })).status, 403, 'bot calls from a browser origin are refused');
});

// ---------------------------------------------------------------- in-world results (guests, no registration)
function result(overrides = {}) {
  const base = {
    format_version: 1, local_ref: 'run-0001', accusation_id: 'UW-C-001', damages_requested: 3000, verdict: 'guilty',
    jury: { guilty: 4, not_guilty: 1 }, notes: 'Jury was split on the lighting.',
    plaintiff: { label: 'Vex', consent_publish: true }, defendant: { label: 'Mori', consent_publish: true },
    exported_at: '2026-10-27T12:00:00Z', ...overrides,
  };
  return base;
}
async function signed(obj) {
  const { checksum, ...rest } = obj;
  return { ...obj, checksum: await L.resultChecksum(rest) };
}

test('a guest case needs no registration: the result is checked, private by default, and public only after both guests consent and a judge approves', async () => {
  const a = app();
  const submitted = await a.call({ action: 'submit_result', result: await signed(result()) }, { token: 'tok-judge' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.claim_codes.length, 2, 'one claim code per guest, shown once to the judge');
  const cn = submitted.body.case_no;
  assert.equal((await a.get({ action: 'case', case_no: String(cn) })).status, 404, 'private until approved');

  assert.equal((await a.call({ action: 'submit_result', result: await signed(result()) }, { token: 'tok-judge' })).body.error, 'DUPLICATE_SUBMISSION');
  const tampered = { ...(await signed(result({ local_ref: 'run-0002' }))), damages_requested: 50000 };
  assert.equal((await a.call({ action: 'submit_result', result: tampered }, { token: 'tok-judge' })).body.error, 'CHECKSUM_MISMATCH');
  const extra = { ...(await signed(result({ local_ref: 'run-0003' }))), wallet: 'x' };
  assert.match((await a.call({ action: 'submit_result', result: extra }, { token: 'tok-judge' })).body.error, /UNKNOWN_FIELD/);
  assert.equal((await a.call({ action: 'submit_result', result: await signed(result({ local_ref: 'run-0004' })) }, { token: 'tok-u1' })).body.error, 'FORBIDDEN');

  const noConsent = await signed(result({ local_ref: 'run-0005', defendant: { label: 'Mori', consent_publish: false } }));
  const nc = await a.call({ action: 'submit_result', result: noConsent }, { token: 'tok-judge' });
  assert.equal((await a.call({ action: 'approve_publication', case_no: nc.body.case_no }, { token: 'tok-judge' })).body.error, 'NEEDS_BOTH_CONSENTS',
    'the judge cannot publish when a guest did not consent');

  await a.call({ action: 'approve_publication', case_no: cn }, { token: 'tok-judge' });
  const pub = await a.get({ action: 'case', case_no: String(cn) });
  assert.equal(pub.body.case.plaintiff, 'Vex (unverified guest)', 'guest labels are always marked unverified');
  assert.equal(pub.body.case.damages_requested, 3000);
});

test('claim codes: single use, wrong codes lock after five misses, expired codes need a judge, and claimants cannot grant consent', async () => {
  const a = app();
  const sub = await a.call({ action: 'submit_result', result: await signed(result()) }, { token: 'tok-judge' });
  const cn = sub.body.case_no;
  const plaintiffCode = sub.body.claim_codes.find((c) => c.side === 'plaintiff').code;
  assert.match(plaintiffCode, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);

  assert.equal((await a.call({ action: 'redeem', case_no: cn, code: 'ZZZZZ-ZZZZZ' }, { token: 'tok-u2' })).body.error, 'WRONG_CODE');
  const ok = await a.call({ action: 'redeem', case_no: cn, code: plaintiffCode.toLowerCase().replace('-', ' ') }, { token: 'tok-u2' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'self_claimed');
  assert.equal((await a.call({ action: 'redeem', case_no: cn, code: plaintiffCode }, { token: 'tok-u3' })).body.error, 'WRONG_CODE', 'a used code cannot be claimed again');

  assert.equal((await a.call({ action: 'case_private', case_no: cn }, { token: 'tok-u2' })).status, 200, 'the claimant sees their own case');
  assert.equal((await a.call({ action: 'case_private', case_no: cn }, { token: 'tok-u3' })).status, 403, 'nobody else does');
  assert.equal((await a.call({ action: 'consent_publish', case_no: cn, granted: true }, { token: 'tok-u2' })).body.error, 'CLAIM_CANNOT_CONSENT');
  assert.equal((await a.call({ action: 'consent_publish', case_no: cn, granted: false }, { token: 'tok-u2' })).status, 200, 'claimants can withdraw');
  assert.equal((await a.call({ action: 'reissue_claim', case_no: cn, side: 'plaintiff' }, { token: 'tok-judge' })).body.error, 'ALREADY_CLAIMED');
  const mine = await a.call({ action: 'mine' }, { token: 'tok-u2' });
  assert.ok(mine.body.cases.some((c) => c.case_no === cn), 'a claimed case appears in the claimant history');

  const sub2 = await a.call({ action: 'submit_result', result: await signed(result({ local_ref: 'run-lock' })) }, { token: 'tok-judge' });
  const cn2 = sub2.body.case_no;
  const defCode = sub2.body.claim_codes.find((c) => c.side === 'defendant').code;
  for (let i = 0; i < 5; i++) assert.equal((await a.call({ action: 'redeem', case_no: cn2, code: 'AAAAA-BBBBB' }, { token: 'tok-u3' })).body.error, 'WRONG_CODE');
  assert.equal((await a.call({ action: 'redeem', case_no: cn2, code: defCode }, { token: 'tok-u3' })).body.error, 'LOCKED', 'five misses lock the case, even with the right code');
  const fresh = await a.call({ action: 'reissue_claim', case_no: cn2, side: 'defendant' }, { token: 'tok-judge' });
  assert.equal((await a.call({ action: 'redeem', case_no: cn2, code: fresh.body.claim_code }, { token: 'tok-u3' })).status, 200, 'a judge reissue unlocks it');

  const sub3 = await a.call({ action: 'submit_result', result: await signed(result({ local_ref: 'run-exp' })) }, { token: 'tok-judge' });
  a.w.expireClaim(sub3.body.case_no);
  const expiredCode = sub3.body.claim_codes[0].code;
  assert.equal((await a.call({ action: 'redeem', case_no: sub3.body.case_no, code: expiredCode }, { token: 'tok-u3' })).body.error, 'EXPIRED');
  const again = await a.call({ action: 'reissue_claim', case_no: sub3.body.case_no, side: 'plaintiff' }, { token: 'tok-judge' });
  assert.equal((await a.call({ action: 'redeem', case_no: sub3.body.case_no, code: again.body.claim_code }, { token: 'tok-u3' })).status, 200);
});

test('claim redemption is rate limited per account', async () => {
  const a = app();
  const sub = await a.call({ action: 'submit_result', result: await signed(result({ local_ref: 'run-rate' })) }, { token: 'tok-judge' });
  for (let i = 0; i < 10; i++) await a.call({ action: 'redeem', case_no: sub.body.case_no, code: 'AAAAA-BBBBB' }, { token: 'tok-u2' });
  assert.equal((await a.call({ action: 'redeem', case_no: sub.body.case_no, code: 'AAAAA-BBBBB' }, { token: 'tok-u2' })).body.error, 'RATE_LIMITED');
});

// ---------------------------------------------------------------- pure rules
test('claim codes: format, normalisation, keyed hashing', async () => {
  const code = L.randomClaimCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(L.normalizeClaimCode(code.toLowerCase()), code.replace('-', ''));
  assert.equal(L.normalizeClaimCode(' 0O1l-ILIL00 '), '0011111100', 'look-alikes are mapped');
  assert.equal(L.normalizeClaimCode('ABC'), null);
  assert.equal(L.normalizeClaimCode('ABCDEU1234'), null, 'U is not in the alphabet');
  const h1 = await L.hashClaimCode('ABCDE12345', 'p'.repeat(40));
  assert.equal(h1, await L.hashClaimCode('ABCDE12345', 'p'.repeat(40)));
  assert.notEqual(h1, await L.hashClaimCode('ABCDE12345', 'q'.repeat(40)), 'a different pepper gives a different hash');
  await assert.rejects(L.hashClaimCode('ABCDE12345', 'short'));
  const seen = new Set(Array.from({ length: 500 }, () => L.randomClaimCode()));
  assert.equal(seen.size, 500, 'no collisions in a small sample');
});

test('canonical JSON is key-order independent, so the bot and the in-world exporter agree on checksums', () => {
  assert.equal(L.canonicalJson({ b: 1, a: { d: [2, 1], c: 'x' } }), '{"a":{"c":"x","d":[2,1]},"b":1}');
  assert.equal(L.canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});

test('result validation: strict fields, ranges and labels', async () => {
  assert.equal((await L.validateResult(await signed(result()))).ok, true);
  assert.equal((await L.validateResult({ ...(await signed(result())), damages_requested: 4000 })).error, 'CHECKSUM_MISMATCH', 'an edit after export is caught');
  assert.equal((await L.validateResult(await signed({ ...result(), damages_requested: 60000 }))).error, 'BAD_DAMAGES');
  assert.equal((await L.validateResult(await signed({ ...result(), verdict: 'silk' }))).error, 'BAD_VERDICT');
  assert.equal((await L.validateResult(await signed({ ...result(), verdict: 'settled' }))).error, 'BAD_SETTLEMENT');
  assert.equal((await L.validateResult(await signed({ ...result(), settlement_amount: 5 }))).error, 'SETTLEMENT_ONLY_WHEN_SETTLED');
  const labelled = await L.validateResult(await signed(result({ plaintiff: { label: '@everyone <@1234>', consent_publish: true } })));
  assert.equal(labelled.ok, true);
  assert.doesNotMatch(labelled.value.plaintiff.label, /@|<|>/);
});

test('community votes: discord only, not parties, poll must be open, one change rule', () => {
  const base = { voterKind: 'discord', isParty: false, pollOpen: true, existing: null, choice: 'guilty' };
  assert.deepEqual(L.communityVote(base), { ok: true, changes: 0, unchanged: false });
  assert.equal(L.communityVote({ ...base, voterKind: 'linked' }).error, 'DISCORD_ONLY');
  assert.equal(L.communityVote({ ...base, isParty: true }).error, 'PARTY_CANNOT_VOTE');
  assert.equal(L.communityVote({ ...base, pollOpen: false }).error, 'POLL_CLOSED');
  assert.deepEqual(L.communityVote({ ...base, existing: { choice: 'guilty', changes: 2 } }), { ok: true, changes: 2, unchanged: true });
  assert.deepEqual(L.communityVote({ ...base, existing: { choice: 'not_guilty', changes: 2 } }), { ok: true, changes: 3, unchanged: false });
  assert.equal(L.communityVote({ ...base, existing: { choice: 'not_guilty', changes: 3 } }).error, 'VOTE_CHANGE_LIMIT');
});

test('filing order and publication rules', () => {
  const ok = { plaintiffId: 'a', defendantId: 'b', defendantAccepting: true, defendantBlocksPlaintiff: false, reasonEnabled: true,
    damages: 10, plaintiffHasOpenCase: false, filedWithinCooldown: false, countersuitOf: null };
  assert.equal(L.filingError(ok), null);
  assert.equal(L.filingError({ ...ok, plaintiffId: 'b' }), 'SELF_SUIT');
  assert.equal(L.filingError({ ...ok, defendantBlocksPlaintiff: true }), 'NOT_ACCEPTING_FROM_YOU');
  assert.equal(L.filingError({ ...ok, damages: 50001 }), 'BAD_DAMAGES');
  assert.equal(L.filingError({ ...ok, filedWithinCooldown: true }), 'FILING_COOLDOWN');
  assert.equal(L.publicationReady({ plaintiff: true, defendant: true }, false), false, 'a judge must approve');
  assert.equal(L.publicationReady({ plaintiff: true, defendant: false }, true), false, 'both must consent');
  assert.equal(L.publicationReady({ plaintiff: true, defendant: true }, true), true);
});

test('public labels hide Discord names and mark guests unverified', () => {
  assert.equal(L.publicLabel({ kind: 'discord', label: 'Dana' }, true), 'A Discord member');
  assert.equal(L.publicLabel({ kind: 'linked', label: 'Alex' }, false), 'An UnderWeb member');
  assert.equal(L.publicLabel({ kind: 'linked', label: 'Alex' }, true), 'Alex');
  assert.equal(L.publicLabel({ kind: 'guest', label: 'Vex' }, false), 'Vex (unverified guest)');
});

test('fictional exhibits are labelled and contain no receipts, balances or account details', () => {
  const ev = L.makeEvidence('Alex', 'Blake');
  assert.equal(ev.length, 6);
  for (const e of ev) {
    assert.equal(e.label, 'FICTIONAL ROLEPLAY EXHIBIT');
    assert.doesNotMatch(`${e.title} ${e.body}`, /receipt|balance|silk|ledger|payment|card|account|\$/i);
  }
});

test('the court never moves Silk in Phase 1', () => {
  const src = readFileSync(new URL('../../supabase/functions/court/handler.ts', import.meta.url), 'utf8')
    + readFileSync(new URL('../../supabase/functions/court/store.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /silk\.(add|spend|grant|award)|uw_silk|uw_silk_/i);
});
