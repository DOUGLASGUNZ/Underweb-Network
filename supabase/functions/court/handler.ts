// UnderWeb Court request handler. Pure HTTP-in, JSON-out, behind an injected store and auth port,
// so the same code runs in the edge function (real database) and in the tests (in-memory store).
// FICTIONAL ROLEPLAY ONLY. Silk is never touched in Phase 1.

import {
  DAMAGES_MAX, FILING_COOLDOWN_SECONDS, claimExpiry, communityVote, filingError, hashClaimCode, makeEvidence,
  normalizeClaimCode, publicLabel, publicationReady, randomClaimCode, respondError, resultChecksum, safeLabel, sha256Hex,
  validateResult, verdictText, type Choice, type PartyKind, type ResultPayload,
} from './logic.ts';

export interface Party { id: string; kind: PartyKind; ref_key: string; label: string; linked_user_id: string | null;
  discord_user_id: string | null; accepting_suits: boolean }
export interface CaseRow {
  id: string; case_no: number; plaintiff_party_id: string; defendant_party_id: string; accusation_id: string;
  accusation_text: string; damages_requested: number; origin: 'website' | 'discord' | 'vrchat_report';
  reported_by_party_id: string | null; countersuit_of: string | null;
  status: 'filed' | 'accepted' | 'declined' | 'verdict_guilty' | 'verdict_not_guilty' | 'dismissed' | 'settled';
  publication: 'private' | 'public'; publication_approved: boolean; poll_closed: boolean; removal_requested: boolean;
  settlement_amount: number | null; judge_party_id: string | null; verdict_at: string | null; created_at: string;
}
export interface Claim { guest_party_id: string; case_id: string; code_hash: string; expires_at: string; attempts: number;
  used_at: string | null; claimant_party_id: string | null }
export interface Tally { guilty: number; not_guilty: number }

/** Thrown by the store when a database constraint refuses a write. The code is one of our own, never raw SQL text. */
export class StoreError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export interface Store {
  listReasons(): Promise<{ id: string; text: string; rating: number; category: string }[]>;
  reasonEnabled(id: string): Promise<boolean>;
  ensureParty(p: { kind: PartyKind; ref_key: string; label: string; linked_user_id?: string; discord_user_id?: string }): Promise<Party>;
  partyById(id: string): Promise<Party | null>;
  partyByRef(ref: string): Promise<Party | null>;
  setAccepting(partyId: string, value: boolean): Promise<void>;
  profileFor(userId: string): Promise<{ label: string; isPublic: boolean } | null>;
  findMembers(query: string, limit: number): Promise<{ user_id: string; label: string }[]>;
  insertCase(row: Omit<CaseRow, 'id' | 'case_no' | 'created_at' | 'verdict_at'> & { verdict_at?: string | null }): Promise<CaseRow>;
  caseById(id: string): Promise<CaseRow | null>;
  caseByNo(no: number): Promise<CaseRow | null>;
  updateCase(id: string, patch: Partial<CaseRow>): Promise<CaseRow>;
  listPublicCases(limit: number): Promise<CaseRow[]>;
  listCasesForParty(partyId: string, limit: number): Promise<CaseRow[]>;
  listClaimedCasesFor(claimantPartyId: string, limit: number): Promise<CaseRow[]>;
  openCaseFor(partyId: string): Promise<CaseRow | null>;
  insertEvidence(caseId: string, rows: ReturnType<typeof makeEvidence>): Promise<void>;
  evidenceFor(caseId: string): Promise<{ slot: number; kind: string; title: string; body: string; label: string }[]>;
  setConsent(caseId: string, partyId: string, kind: 'participate' | 'publish', granted: boolean, source: 'web' | 'discord' | 'in_world_result'): Promise<void>;
  consentsFor(caseId: string): Promise<{ party_id: string; kind: string; granted: boolean }[]>;
  isBlocked(blockerId: string, blockedId: string): Promise<boolean>;
  addBlock(blockerId: string, blockedId: string): Promise<void>;
  communityVoteFor(caseId: string, partyId: string): Promise<{ choice: Choice; changes: number } | null>;
  saveCommunityVote(caseId: string, partyId: string, choice: Choice, changes: number): Promise<void>;
  tally(caseId: string): Promise<Tally>;
  insertVerdict(row: { case_id: string; judge_party_id: string; verdict: string; jury_guilty: number | null; jury_not_guilty: number | null; note: string | null }): Promise<void>;
  verdictFor(caseId: string): Promise<{ verdict: string } | null>;
  insertSubmission(row: { judge_party_id: string; local_ref: string; payload: unknown; checksum: string }): Promise<string>;
  attachSubmission(submissionId: string, caseId: string): Promise<void>;
  insertClaim(row: { guest_party_id: string; case_id: string; code_hash: string; expires_at: string }): Promise<void>;
  reissueClaim(guestPartyId: string, codeHash: string, expiresAt: string): Promise<void>;
  claimFor(guestPartyId: string): Promise<Claim | null>;
  redeemClaim(caseNo: number, codeHash: string, claimantPartyId: string): Promise<{ ok: true; guest_party_id: string } | { ok: false; error: string }>;
  queueAnnouncement(caseId: string, kind: 'poll' | 'verdict' | 'settlement'): Promise<void>;
  pendingAnnouncements(limit: number): Promise<{ id: string; case_id: string; kind: 'poll' | 'verdict' | 'settlement' }[]>;
  ackAnnouncement(id: string, messageId: string): Promise<void>;
  rateHit(bucket: string, max: number, windowSeconds: number): Promise<boolean>;
  workerOk(tokenHash: string, guildId: string): Promise<boolean>;
}

export interface AuthPort {
  userFromToken(token: string): Promise<{ id: string } | null>;
  /** The caller's own session runs the existing role check, so judge status comes from the same role system as the staff tools. */
  isJudge(token: string): Promise<boolean>;
}

export interface HandlerSettings { siteOrigin: string; guildId: string; claimPepper: string; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^[0-9]{17,20}$/;
const ERROR_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, RATE_LIMITED: 429, FILING_COOLDOWN: 429,
  OPEN_CASE_EXISTS: 409, NOT_WAITING_FOR_ANSWER: 409, POLL_CLOSED: 409, VOTE_CHANGE_LIMIT: 409, ALREADY_CLAIMED: 409,
  DUPLICATE_SUBMISSION: 409, VERDICT_EXISTS: 409, NEEDS_BOTH_CONSENTS: 409, LOCKED: 409, EXPIRED: 409, CASE_NOT_OPEN: 409,
  CLAIM_CANNOT_CONSENT: 403,
  INTERNAL_ERROR: 500,
};

class Refuse extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function refuse(code: string): never { throw new Refuse(code); }

export function createCourtHandler(settings: HandlerSettings, store: Store, auth: AuthPort) {
  const cors = {
    'Access-Control-Allow-Origin': settings.siteOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  // ---------------------------------------------------------------- involvement
  /** 'party' = a side of the case. 'claimant' = a linked member who redeemed a guest's code (view and withdraw only). */
  async function involvement(c: CaseRow, actor: Party): Promise<'party' | 'claimant' | null> {
    if (actor.id === c.plaintiff_party_id || actor.id === c.defendant_party_id) return 'party';
    for (const gid of [c.plaintiff_party_id, c.defendant_party_id]) {
      const claim = await store.claimFor(gid);
      if (claim?.claimant_party_id === actor.id) return 'claimant';
    }
    return null;
  }

  // ---------------------------------------------------------------- views
  async function labelFor(p: Party): Promise<string> {
    if (p.kind === 'linked' && p.linked_user_id) {
      const prof = await store.profileFor(p.linked_user_id);
      return publicLabel({ kind: 'linked', label: prof?.label ?? p.label }, prof?.isPublic === true);
    }
    return publicLabel({ kind: p.kind, label: p.label }, false);
  }
  const pollOpen = (c: CaseRow) => c.publication === 'public' && !c.poll_closed && (c.status === 'filed' || c.status === 'accepted');

  async function caseView(c: CaseRow, viewer: 'public' | 'party') {
    const [plaintiff, defendant, tally, evidence] = await Promise.all([
      store.partyById(c.plaintiff_party_id), store.partyById(c.defendant_party_id),
      store.tally(c.id), viewer === 'public' && c.publication !== 'public' ? [] : store.evidenceFor(c.id),
    ]);
    return {
      case_no: c.case_no, accusation: c.accusation_text, damages_requested: c.damages_requested, status: c.status,
      publication: c.publication, origin: c.origin, created_at: c.created_at, settlement_amount: c.settlement_amount,
      plaintiff: plaintiff ? await labelFor(plaintiff) : 'Unknown party',
      defendant: defendant ? await labelFor(defendant) : 'Unknown party',
      poll: { open: pollOpen(c), tally },
      evidence,
    };
  }

  // ---------------------------------------------------------------- shared rules (website, linked and worker callers)
  async function fileCase(plaintiff: Party, defendant: Party, body: Record<string, unknown>, counterOf: CaseRow | null, origin: 'website' | 'discord') {
    const accusationId = String(body.accusation_id ?? '');
    const damages = body.damages_requested ?? body.damages;
    if (!(await store.reasonEnabled(accusationId))) refuse('REASON_NOT_IN_LIBRARY');
    if (typeof damages !== 'number' || !Number.isInteger(damages) || damages < 0 || damages > DAMAGES_MAX) refuse('BAD_DAMAGES');
    const reasons = await store.listReasons();
    const reason = reasons.find((r) => r.id === accusationId);
    if (!reason) refuse('REASON_NOT_IN_LIBRARY');
    const open = await store.openCaseFor(plaintiff.id);
    const err = filingError({
      plaintiffId: plaintiff.id, defendantId: defendant.id, defendantAccepting: defendant.accepting_suits,
      defendantBlocksPlaintiff: await store.isBlocked(defendant.id, plaintiff.id), reasonEnabled: true,
      damages: damages as number, plaintiffHasOpenCase: open !== null, filedWithinCooldown: false,
      countersuitOf: counterOf ? { defendantId: counterOf.defendant_party_id, plaintiffId: counterOf.plaintiff_party_id, status: counterOf.status } : null,
    });
    if (err) refuse(err);
    if (!(await store.rateHit(`court:file:${plaintiff.id}`, 1, FILING_COOLDOWN_SECONDS))) refuse('FILING_COOLDOWN');

    const created = await store.insertCase({
      plaintiff_party_id: plaintiff.id, defendant_party_id: defendant.id, accusation_id: accusationId,
      accusation_text: reason.text, damages_requested: damages as number, origin,
      reported_by_party_id: null, countersuit_of: counterOf?.id ?? null, status: 'filed', publication: 'private',
      publication_approved: false, poll_closed: false, removal_requested: false, settlement_amount: null,
      judge_party_id: null, verdict_at: null,
    }).catch((e) => { if (e instanceof StoreError && e.code === 'OPEN_CASE_EXISTS') refuse('OPEN_CASE_EXISTS'); throw e; });
    await store.insertEvidence(created.id, makeEvidence(plaintiff.label, defendant.label));
    await store.setConsent(created.id, plaintiff.id, 'participate', true, origin === 'discord' ? 'discord' : 'web');
    return created;
  }

  async function recomputePublication(c: CaseRow): Promise<CaseRow> {
    const consents = await store.consentsFor(c.id);
    const has = (party: string) => consents.some((x) => x.party_id === party && x.kind === 'publish' && x.granted);
    const ready = publicationReady({ plaintiff: has(c.plaintiff_party_id), defendant: has(c.defendant_party_id) }, c.publication_approved);
    const next = ready ? 'public' : 'private';
    if (next === c.publication) return c;
    return store.updateCase(c.id, { publication: next, updated_at: new Date().toISOString() } as Partial<CaseRow>);
  }

  async function queueIfPublic(c: CaseRow) {
    if (c.publication !== 'public') return;
    if (pollOpen(c)) await store.queueAnnouncement(c.id, 'poll');
    const v = await store.verdictFor(c.id);
    if (v && (v.verdict === 'settled')) await store.queueAnnouncement(c.id, 'settlement');
    else if (v) await store.queueAnnouncement(c.id, 'verdict');
  }

  async function partyFromWorker(body: Record<string, unknown>): Promise<Party> {
    if (typeof body.discordUserId !== 'string' || !SNOWFLAKE.test(body.discordUserId)) refuse('INVALID_REQUEST');
    return store.ensureParty({ kind: 'discord', ref_key: `d:${body.discordUserId}`, label: safeLabel(body.discordName ?? 'Discord member'),
      discord_user_id: body.discordUserId });
  }

  async function partyFromLinked(userId: string): Promise<Party> {
    const prof = await store.profileFor(userId);
    if (!prof) refuse('NOT_FOUND');
    return store.ensureParty({ kind: 'linked', ref_key: `u:${userId}`, label: prof.label, linked_user_id: userId });
  }

  async function caseFromBody(body: Record<string, unknown>): Promise<CaseRow> {
    const no = Number(body.case_no);
    if (!Number.isInteger(no) || no < 1) refuse('INVALID_REQUEST');
    const c = await store.caseByNo(no);
    if (!c) refuse('NOT_FOUND');
    return c;
  }

  // ---------------------------------------------------------------- actions
  const actions: Record<string, (body: Record<string, unknown>, ctx: { token: string; userId?: string; judge?: boolean; worker?: boolean }) => Promise<unknown>> = {
    // ---- public (no login) — GET or POST
    reasons: async () => ({ reasons: await store.listReasons() }),
    list: async () => {
      const cases = await store.listPublicCases(50);
      return { cases: await Promise.all(cases.map((c) => caseView(c, 'public'))) };
    },
    case: async (body) => {
      const c = await caseFromBody(body);
      if (c.publication !== 'public') refuse('NOT_FOUND');
      return { case: await caseView(c, 'public') };
    },

    // ---- linked member (login)
    mine: async (_b, ctx) => {
      const party = await partyFromLinked(ctx.userId!);
      const own = await store.listCasesForParty(party.id, 50);
      const claimed = await store.listClaimedCasesFor(party.id, 50);
      const seen = new Set<string>();
      const all = [...own, ...claimed].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
      return { cases: await Promise.all(all.map((c) => caseView(c, 'party'))) };
    },
    find: async (body) => {
      const q = String(body.q ?? '').trim();
      if (q.length < 2 || q.length > 40) refuse('INVALID_REQUEST');
      return { members: await store.findMembers(q, 5) };
    },
    file: async (body, ctx) => {
      const plaintiff = await partyFromLinked(ctx.userId!);
      if (!plaintiff) refuse('NOT_FOUND');
      const counter = body.countersuit_case_no ? await caseFromBody({ case_no: body.countersuit_case_no }) : null;
      let defendant: Party;
      if (counter) {
        const original = await store.partyById(counter.plaintiff_party_id);
        if (!original) refuse('NOT_FOUND');
        defendant = original!;
      } else {
        if (typeof body.defendant_user_id !== 'string' || !UUID.test(body.defendant_user_id)) refuse('INVALID_REQUEST');
        if (body.defendant_user_id === ctx.userId) refuse('SELF_SUIT');
        defendant = await partyFromLinked(body.defendant_user_id);
      }
      const c = await fileCase(plaintiff, defendant, body, counter, 'website');
      return { case_no: c.case_no, case_id: c.id };
    },
    respond: async (body, ctx) => respondCase(await partyFromLinked(ctx.userId!), body),
    block: async (body, ctx) => blockPlaintiff(await partyFromLinked(ctx.userId!), body),
    accepting: async (body, ctx) => {
      const party = await partyFromLinked(ctx.userId!);
      if (typeof body.accepting !== 'boolean') refuse('INVALID_REQUEST');
      await store.setAccepting(party.id, body.accepting as boolean);
      return { accepting: body.accepting };
    },
    consent_publish: async (body, ctx) => consentPublish(await partyFromLinked(ctx.userId!), body, 'web'),
    request_removal: async (body, ctx) => requestRemoval(await partyFromLinked(ctx.userId!), body),
    redeem: async (body, ctx) => {
      if (!(await store.rateHit(`court:claim:${ctx.userId}`, 10, 3600))) refuse('RATE_LIMITED');
      const code = normalizeClaimCode(body.code);
      if (!code) refuse('WRONG_CODE');
      const no = Number(body.case_no);
      if (!Number.isInteger(no) || no < 1) refuse('INVALID_REQUEST');
      const claimant = await partyFromLinked(ctx.userId!);
      const result = await store.redeemClaim(no, await hashClaimCode(code!, settings.claimPepper), claimant.id);
      if (!result.ok) refuse(result.error);
      return { ok: true, status: 'self_claimed', note: 'Claimed by code. This proves you have the code, not that you own a VRChat account.' };
    },
    case_private: async (body, ctx) => {
      const c = await caseFromBody(body);
      const party = await partyFromLinked(ctx.userId!);
      const role = await involvement(c, party);
      if (!role) refuse('FORBIDDEN');
      const side = c.plaintiff_party_id === party.id ? 'plaintiff' : c.defendant_party_id === party.id ? 'defendant' : 'claimant';
      const consents = await store.consentsFor(c.id);
      const mine = consents.find((x) => x.party_id === party.id && x.kind === 'publish');
      return { case: await caseView(c, 'party'), role: side, my_publish_consent: mine?.granted === true };
    },

    // ---- Discord participant (bot calls, Discord identity)
    worker_file: async (body) => {
      const plaintiff = await partyFromWorker(body);
      if (typeof body.defendantDiscordId !== 'string' || !SNOWFLAKE.test(body.defendantDiscordId)) refuse('INVALID_REQUEST');
      if (body.defendantDiscordId === body.discordUserId) refuse('SELF_SUIT');
      const defendant = await store.ensureParty({ kind: 'discord', ref_key: `d:${body.defendantDiscordId}`,
        label: safeLabel(body.defendantName ?? 'Discord member'), discord_user_id: body.defendantDiscordId as string });
      const c = await fileCase(plaintiff, defendant, body, null, 'discord');
      return { case_no: c.case_no, case_id: c.id, defendant_discord_id: body.defendantDiscordId };
    },
    worker_respond: async (body) => respondCase(await partyFromWorker(body), body),
    worker_block: async (body) => blockPlaintiff(await partyFromWorker(body), body),
    worker_accepting: async (body) => {
      const party = await partyFromWorker(body);
      if (typeof body.accepting !== 'boolean') refuse('INVALID_REQUEST');
      await store.setAccepting(party.id, body.accepting as boolean);
      return { accepting: body.accepting };
    },
    worker_consent_publish: async (body) => consentPublish(await partyFromWorker(body), body, 'discord'),
    worker_request_removal: async (body) => requestRemoval(await partyFromWorker(body), body),
    worker_vote: async (body) => {
      const voter = await partyFromWorker(body);
      const c = await caseFromBody(body);
      if (typeof body.choice !== 'string' || !['guilty', 'not_guilty'].includes(body.choice)) refuse('INVALID_REQUEST');
      if (c.publication !== 'public') refuse('NOT_FOUND');
      const isParty = [c.plaintiff_party_id, c.defendant_party_id].includes(voter.id);
      const existing = await store.communityVoteFor(c.id, voter.id);
      const rule = communityVote({ voterKind: voter.kind, isParty, pollOpen: pollOpen(c), existing, choice: body.choice as Choice });
      if (!rule.ok) refuse(rule.error);
      if (!(rule as any).unchanged) await store.saveCommunityVote(c.id, voter.id, body.choice as Choice, (rule as any).changes);
      return { ok: true, tally: await store.tally(c.id), unchanged: (rule as any).unchanged };
    },
    worker_status: async (body) => {
      const c = await caseFromBody(body);
      if (c.publication !== 'public') refuse('NOT_FOUND');
      return { case: await caseView(c, 'public') };
    },
    worker_pending: async () => {
      const items = await store.pendingAnnouncements(10);
      const out: unknown[] = [];
      for (const item of items) {
        const c = await store.caseById(item.case_id);
        if (!c || c.publication !== 'public' || c.removal_requested) continue;
        if (item.kind === 'poll' && !pollOpen(c)) continue;
        const view = await caseView(c, 'public');
        out.push({ id: item.id, kind: item.kind, case_no: c.case_no, accusation: c.accusation_text, plaintiff: view.plaintiff,
          defendant: view.defendant, verdict: c.status, settlement_amount: c.settlement_amount, damages_requested: c.damages_requested,
          tally: view.poll.tally, text: item.kind === 'poll' ? null : verdictText({ caseNo: c.case_no, accusation: c.accusation_text,
            verdict: c.status === 'verdict_guilty' ? 'guilty' : c.status === 'verdict_not_guilty' ? 'not_guilty' : c.status === 'settled' ? 'settled' : 'dismissed',
            damages: c.damages_requested, settlement: c.settlement_amount, plaintiff: view.plaintiff, defendant: view.defendant }) });
      }
      return { items: out };
    },
    worker_ack: async (body) => {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) refuse('INVALID_REQUEST');
      if (typeof body.messageId !== 'string' || !SNOWFLAKE.test(body.messageId)) refuse('INVALID_REQUEST');
      await store.ackAnnouncement(body.id as string, body.messageId as string);
      return { ok: true };
    },

    // ---- judges only (linked staff, checked with the caller's own session)
    submit_result: async (body, ctx) => {
      const judge = await partyFromLinked(ctx.userId!);
      const checked = await validateResult(body.result);
      if (!checked.ok) refuse(checked.error);
      const r = checked.value;
      if (!(await store.reasonEnabled(r.accusation_id))) refuse('REASON_NOT_IN_LIBRARY');
      const reason = (await store.listReasons()).find((x) => x.id === r.accusation_id)!;

      const submissionId = await store.insertSubmission({ judge_party_id: judge.id, local_ref: r.local_ref, payload: r, checksum: r.checksum })
        .catch((e) => { if (e instanceof StoreError && e.code === 'DUPLICATE_SUBMISSION') refuse('DUPLICATE_SUBMISSION'); throw e; });

      // Guests get fresh, random party refs for every result. Nothing is matched by display name.
      const newGuest = async (label: string) => store.ensureParty({ kind: 'guest', ref_key: `g:${randomHex32()}`, label });
      const plaintiff = await newGuest(r.plaintiff.label);
      const defendant = await newGuest(r.defendant.label);
      const statusFor: Record<ResultPayload['verdict'], CaseRow['status']> = {
        guilty: 'verdict_guilty', not_guilty: 'verdict_not_guilty', dismissed: 'dismissed', settled: 'settled',
      };
      const c = await store.insertCase({
        plaintiff_party_id: plaintiff.id, defendant_party_id: defendant.id, accusation_id: reason.id, accusation_text: reason.text,
        damages_requested: r.damages_requested, origin: 'vrchat_report', reported_by_party_id: judge.id, countersuit_of: null,
        status: statusFor[r.verdict], publication: 'private', publication_approved: false, poll_closed: true, removal_requested: false,
        settlement_amount: r.verdict === 'settled' ? (r.settlement_amount ?? null) : null, judge_party_id: judge.id,
        verdict_at: new Date().toISOString(),
      });
      await store.attachSubmission(submissionId, c.id);
      await store.insertEvidence(c.id, []); // guest cases carry no website exhibits; the in-world trial is the record
      await store.setConsent(c.id, plaintiff.id, 'publish', r.plaintiff.consent_publish, 'in_world_result');
      await store.setConsent(c.id, defendant.id, 'publish', r.defendant.consent_publish, 'in_world_result');
      await store.insertVerdict({ case_id: c.id, judge_party_id: judge.id, verdict: r.verdict,
        jury_guilty: r.jury.guilty, jury_not_guilty: r.jury.not_guilty, note: r.notes || null });

      // One-time claim codes. Returned to the judge only, once, to hand to each guest privately. Never posted.
      const codes: { side: 'plaintiff' | 'defendant'; label: string; code: string; expires_at: string }[] = [];
      for (const [side, party, label] of [['plaintiff', plaintiff, r.plaintiff.label], ['defendant', defendant, r.defendant.label]] as const) {
        const code = randomClaimCode();
        const expires = claimExpiry(Date.now());
        await store.insertClaim({ guest_party_id: party.id, case_id: c.id, code_hash: await hashClaimCode(code.replace('-', ''), settings.claimPepper), expires_at: expires });
        codes.push({ side, label, code, expires_at: expires });
      }
      return { case_no: c.case_no, claim_codes: codes, note: 'Show each code only to its guest, privately. Codes expire in 10 minutes and cannot be seen again.' };
    },
    approve_publication: async (body, ctx) => {
      await partyFromLinked(ctx.userId!);
      let c = await caseFromBody(body);
      const consents = await store.consentsFor(c.id);
      const both = [c.plaintiff_party_id, c.defendant_party_id].every((p) => consents.some((x) => x.party_id === p && x.kind === 'publish' && x.granted));
      if (!both) refuse('NEEDS_BOTH_CONSENTS');
      c = await store.updateCase(c.id, { publication_approved: true } as Partial<CaseRow>);
      c = await recomputePublication(c);
      await queueIfPublic(c);
      return { case_no: c.case_no, publication: c.publication };
    },
    unpublish: async (body, ctx) => {
      await partyFromLinked(ctx.userId!);
      // Withdraw publication and approval in one write. The database requires approval for any public case.
      const c = await store.updateCase((await caseFromBody(body)).id, { publication: 'private', publication_approved: false, removal_requested: false } as Partial<CaseRow>);
      return { case_no: c.case_no, publication: c.publication };
    },
    verdict: async (body, ctx) => {
      const judge = await partyFromLinked(ctx.userId!);
      let c = await caseFromBody(body);
      if (c.status !== 'accepted') refuse('CASE_NOT_OPEN');
      if (!['guilty', 'not_guilty', 'dismissed'].includes(String(body.verdict))) refuse('INVALID_REQUEST');
      const verdict = body.verdict as 'guilty' | 'not_guilty' | 'dismissed';
      const note = typeof body.note === 'string' ? safeLabel(body.note, 300) : null;
      await store.insertVerdict({ case_id: c.id, judge_party_id: judge.id, verdict, jury_guilty: null, jury_not_guilty: null, note });
      c = await store.updateCase(c.id, { status: verdict === 'guilty' ? 'verdict_guilty' : verdict === 'not_guilty' ? 'verdict_not_guilty' : 'dismissed',
        judge_party_id: judge.id, verdict_at: new Date().toISOString(), poll_closed: true } as Partial<CaseRow>);
      await queueIfPublic(c);
      return { case_no: c.case_no, status: c.status };
    },
    settle: async (body, ctx) => {
      const judge = await partyFromLinked(ctx.userId!);
      let c = await caseFromBody(body);
      if (!['filed', 'accepted'].includes(c.status)) refuse('CASE_NOT_OPEN');
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 0 || amount > DAMAGES_MAX) refuse('INVALID_REQUEST');
      await store.insertVerdict({ case_id: c.id, judge_party_id: judge.id, verdict: 'settled', jury_guilty: null, jury_not_guilty: null, note: 'Recorded only. No Silk moved.' });
      c = await store.updateCase(c.id, { status: 'settled', settlement_amount: amount, judge_party_id: judge.id,
        verdict_at: new Date().toISOString(), poll_closed: true } as Partial<CaseRow>);
      await queueIfPublic(c);
      return { case_no: c.case_no, status: c.status, settlement_amount: amount };
    },
    close_poll: async (body, ctx) => {
      await partyFromLinked(ctx.userId!);
      const c = await store.updateCase((await caseFromBody(body)).id, { poll_closed: true } as Partial<CaseRow>);
      return { case_no: c.case_no, poll_open: pollOpen(c) };
    },
    reissue_claim: async (body, ctx) => {
      await partyFromLinked(ctx.userId!);
      const c = await caseFromBody(body);
      const side = body.side === 'plaintiff' ? c.plaintiff_party_id : body.side === 'defendant' ? c.defendant_party_id : null;
      if (!side) refuse('INVALID_REQUEST');
      const existing = await store.claimFor(side!);
      if (!existing) refuse('NOT_FOUND');
      if (existing!.used_at) refuse('ALREADY_CLAIMED');
      const code = randomClaimCode();
      const expires = claimExpiry(Date.now());
      await store.reissueClaim(side!, await hashClaimCode(code.replace('-', ''), settings.claimPepper), expires);
      return { case_no: c.case_no, claim_code: code, expires_at: expires, note: 'Show this code only to its guest, privately.' };
    },
  };

  async function respondCase(actor: Party, body: Record<string, unknown>) {
    const c = await caseFromBody(body);
    const err = respondError(actor.id, c.defendant_party_id, c.status);
    if (err) refuse(err);
    if (body.decision !== 'accept' && body.decision !== 'decline') refuse('INVALID_REQUEST');
    if (body.decision === 'decline') {
      await store.setConsent(c.id, actor.id, 'participate', false, actor.kind === 'discord' ? 'discord' : 'web');
      await store.updateCase(c.id, { status: 'declined' } as Partial<CaseRow>);
      return { case_no: c.case_no, status: 'declined' };
    }
    if (!actor.accepting_suits) refuse('NOT_ACCEPTING_FROM_YOU');
    await store.setConsent(c.id, actor.id, 'participate', true, actor.kind === 'discord' ? 'discord' : 'web');
    await store.updateCase(c.id, { status: 'accepted' } as Partial<CaseRow>);
    return { case_no: c.case_no, status: 'accepted' };
  }

  async function blockPlaintiff(actor: Party, body: Record<string, unknown>) {
    const c = await caseFromBody(body);
    if (actor.id !== c.defendant_party_id) refuse('NOT_THE_DEFENDANT');
    await store.addBlock(actor.id, c.plaintiff_party_id);
    if (c.status === 'filed') await store.updateCase(c.id, { status: 'declined' } as Partial<CaseRow>);
    return { ok: true, case_no: c.case_no, note: 'You will not receive suits from this player.' };
  }

  async function consentPublish(actor: Party, body: Record<string, unknown>, source: 'web' | 'discord') {
    const c = await caseFromBody(body);
    const role = await involvement(c, actor);
    if (!role) refuse('FORBIDDEN');
    if (typeof body.granted !== 'boolean') refuse('INVALID_REQUEST');
    // A code proves possession, not identity, so a claimant may withdraw publish consent but never grant it.
    if (role === 'claimant' && body.granted === true) refuse('CLAIM_CANNOT_CONSENT');
    await store.setConsent(c.id, actor.id, 'publish', body.granted as boolean, source);
    const updated = await recomputePublication(c);
    if (updated.publication === 'public') await queueIfPublic(updated);
    return { case_no: c.case_no, publication: updated.publication };
  }

  async function requestRemoval(actor: Party, body: Record<string, unknown>) {
    const c = await caseFromBody(body);
    if (!(await involvement(c, actor))) refuse('FORBIDDEN');
    // Removal is immediate privately. A judge reviews it afterwards.
    await store.updateCase(c.id, { removal_requested: true, publication: 'private', publication_approved: false } as Partial<CaseRow>);
    return { case_no: c.case_no, publication: 'private', removal_requested: true };
  }

  // ---------------------------------------------------------------- routing
  async function run(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const action = url.searchParams.get('action') ?? 'list';
        if (!['reasons', 'list', 'case'].includes(action)) refuse('NOT_FOUND');
        const body = Object.fromEntries(url.searchParams.entries());
        return reply(await actions[action](body, { token: '' }));
      }
      if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);

      const raw = await request.text();
      if (raw.length > 16_384) refuse('REQUEST_TOO_LARGE');
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { refuse('INVALID_REQUEST'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('INVALID_REQUEST');
      const action = String(body.action ?? '');
      const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1] ?? '';

      // Worker calls: a 64-hex bot credential, checked by the same database function the Verify flow uses.
      if (action.startsWith('worker_')) {
        const hex = bearer.match(/^([0-9a-f]{64})$/)?.[1];
        if (!hex) refuse('AUTH_REQUIRED');
        if (request.headers.get('origin')) refuse('FORBIDDEN');
        if (!(await store.workerOk(await sha256Hex(hex!), settings.guildId))) refuse('AUTH_REQUIRED');
        const fn = actions[action];
        if (!fn) refuse('NOT_FOUND');
        return reply(await fn(body, { token: '', worker: true }));
      }

      if (['reasons', 'list', 'case'].includes(action)) return reply(await actions[action](body, { token: '' }));

      // Logged-in calls: a Supabase session token from the website.
      if (!bearer) refuse('AUTH_REQUIRED');
      const user = await auth.userFromToken(bearer);
      if (!user) refuse('AUTH_REQUIRED');
      const ctx = { token: bearer, userId: user!.id };
      if (!actions[action]) refuse('NOT_FOUND');
      if (['approve_publication', 'unpublish', 'verdict', 'settle', 'close_poll', 'reissue_claim', 'submit_result'].includes(action)) {
        if (!(await auth.isJudge(bearer))) refuse('FORBIDDEN');
      }
      return reply(await actions[action](body, ctx));
    } catch (error) {
      if (error instanceof Refuse) {
        const status = ERROR_STATUS[error.code] ?? 400;
        return reply({ error: error.code }, status);
      }
      if (error instanceof StoreError) return reply({ error: error.code }, ERROR_STATUS[error.code] ?? 409);
      return reply({ error: 'INTERNAL_ERROR' }, 500);
    }
  }

  return { handle: run };
}

function randomHex32(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
export { resultChecksum };
