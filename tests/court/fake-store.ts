// In-memory court store for tests. It enforces the same constraints as the migration:
// one open case per plaintiff, one verdict per case, unique submissions, unique votes, atomic claim redemption, fixed-window rate limits.
import { StoreError, type Claim, type CaseRow, type Party, type Store } from '../../supabase/functions/court/handler.ts';
import { sha256Hex } from '../../supabase/functions/court/logic.ts';

export const UID = {
  u1: '00000000-0000-4000-8000-000000000001',
  u2: '00000000-0000-4000-8000-000000000002',
  u3: '00000000-0000-4000-8000-000000000003',
  judge: '00000000-0000-4000-8000-000000000009',
} as const;

export const WORKER_TOKEN = 'ab'.repeat(32);
export const GUILD = '123456789012345678';

export function createWorld() {
  const parties = new Map<string, Party>();
  const cases = new Map<string, CaseRow>();
  const consents = new Map<string, { case_id: string; party_id: string; kind: string; granted: boolean; source: string }>();
  const blocks = new Set<string>();
  const claims = new Map<string, Claim & { case_id: string }>();
  const votes = new Map<string, { choice: 'guilty' | 'not_guilty'; changes: number }>();
  const verdicts = new Map<string, { verdict: string }>();
  const submissions = new Map<string, { id: string; judge: string; local_ref: string; case_id: string | null }>();
  const evidence = new Map<string, unknown[]>();
  const announcements = new Map<string, { id: string; case_id: string; kind: 'poll' | 'verdict' | 'settlement'; posted: boolean; message_id: string | null }>();
  const rate = new Map<string, { start: number; hits: number }>();
  const profiles = new Map<string, { label: string; isPublic: boolean }>();
  const reasons = new Map<string, { id: string; text: string; rating: number; category: string; enabled: boolean }>();
  const users = new Map<string, string>();   // token -> user id
  const judges = new Set<string>();          // user ids with a staff rank
  let caseNo = 0; let seq = 0;
  const id = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;

  reasons.set('UW-C-001', { id: 'UW-C-001', text: 'Said I was chopped in front of the huzz', rating: 0, category: 'Chaos', enabled: true });
  reasons.set('UW-C-002', { id: 'UW-C-002', text: 'Stole the last snack', rating: 0, category: 'Chaos', enabled: true });
  reasons.set('UW-C-900', { id: 'UW-C-900', text: 'Retired reason', rating: 0, category: 'Old', enabled: false });

  profiles.set(UID.u1, { label: 'Alex', isPublic: true });
  profiles.set(UID.u2, { label: 'Blake', isPublic: false });
  profiles.set(UID.u3, { label: 'Casey', isPublic: true });
  profiles.set(UID.judge, { label: 'Judge Jo', isPublic: true });
  users.set('tok-u1', UID.u1); users.set('tok-u2', UID.u2); users.set('tok-u3', UID.u3); users.set('tok-judge', UID.judge); users.set('tok-bad', 'nobody');
  judges.add(UID.judge);

  const sortByCreated = <T extends { created_at: string }>(rows: T[]) => rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const store: Store = {
    async listReasons() { return [...reasons.values()].filter((r) => r.enabled).map(({ enabled, ...r }) => r); },
    async reasonEnabled(rid) { return reasons.get(rid)?.enabled === true; },
    async ensureParty(p) {
      const existing = [...parties.values()].find((x) => x.ref_key === p.ref_key);
      if (existing) { existing.label = p.label; return existing; }
      const party: Party = { id: id(), kind: p.kind, ref_key: p.ref_key, label: p.label, linked_user_id: p.linked_user_id ?? null,
        discord_user_id: p.discord_user_id ?? null, accepting_suits: true };
      parties.set(party.id, party);
      return party;
    },
    async partyById(pid) { return parties.get(pid) ?? null; },
    async partyByRef(ref) { return [...parties.values()].find((x) => x.ref_key === ref) ?? null; },
    async setAccepting(pid, value) { parties.get(pid)!.accepting_suits = value; },
    async profileFor(uid) { return profiles.get(uid) ?? null; },
    async findMembers(q) {
      return [...profiles.entries()].filter(([uid, p]) => p.isPublic && (uid.includes(q) || p.label.toLowerCase().includes(q.toLowerCase())))
        .map(([uid, p]) => ({ user_id: uid, label: p.label }));
    },
    async insertCase(row) {
      if (row.plaintiff_party_id === row.defendant_party_id) throw new StoreError('CHECK_FAILED');
      if ((row.status === 'filed' || row.status === 'accepted') &&
          [...cases.values()].some((c) => c.plaintiff_party_id === row.plaintiff_party_id && (c.status === 'filed' || c.status === 'accepted'))) {
        throw new StoreError('OPEN_CASE_EXISTS');
      }
      caseNo += 1;
      const created: CaseRow = { ...row, id: id(), case_no: caseNo, created_at: new Date().toISOString(), verdict_at: row.verdict_at ?? null } as CaseRow;
      cases.set(created.id, created);
      return created;
    },
    async caseById(cid) { return cases.get(cid) ?? null; },
    async caseByNo(no) { return [...cases.values()].find((c) => c.case_no === no) ?? null; },
    async updateCase(cid, patch) {
      const c = cases.get(cid)!;
      Object.assign(c, patch);
      if (c.publication === 'private' && c.publication_approved) { /* allowed: approval kept, publication withdrawn */ }
      if (c.publication === 'public' && !c.publication_approved) throw new StoreError('CHECK_FAILED');
      return c;
    },
    async listPublicCases(limit) { return sortByCreated([...cases.values()].filter((c) => c.publication === 'public')).slice(0, limit); },
    async listCasesForParty(pid, limit) {
      return sortByCreated([...cases.values()].filter((c) => c.plaintiff_party_id === pid || c.defendant_party_id === pid)).slice(0, limit);
    },
    async listClaimedCasesFor(pid, limit) {
      const ids = new Set([...claims.values()].filter((c) => c.claimant_party_id === pid).map((c) => c.case_id));
      return sortByCreated([...cases.values()].filter((c) => ids.has(c.id))).slice(0, limit);
    },
    async openCaseFor(pid) {
      return [...cases.values()].find((c) => c.plaintiff_party_id === pid && (c.status === 'filed' || c.status === 'accepted')) ?? null;
    },
    async insertEvidence(cid, rows) { evidence.set(cid, rows); },
    async evidenceFor(cid) { return (evidence.get(cid) ?? []) as any[]; },
    async setConsent(cid, pid, kind, granted, source) {
      consents.set(`${cid}|${pid}|${kind}`, { case_id: cid, party_id: pid, kind, granted, source });
    },
    async consentsFor(cid) {
      return [...consents.values()].filter((c) => c.case_id === cid).map((c) => ({ party_id: c.party_id, kind: c.kind, granted: c.granted }));
    },
    async isBlocked(a, b) { return blocks.has(`${a}|${b}`); },
    async addBlock(a, b) { blocks.add(`${a}|${b}`); },
    async communityVoteFor(cid, pid) { return votes.get(`${cid}|${pid}`) ?? null; },
    async saveCommunityVote(cid, pid, choice, changes) { votes.set(`${cid}|${pid}`, { choice, changes }); },
    async tally(cid) {
      const mine = [...votes.entries()].filter(([k]) => k.startsWith(`${cid}|`)).map(([, v]) => v);
      return { guilty: mine.filter((v) => v.choice === 'guilty').length, not_guilty: mine.filter((v) => v.choice === 'not_guilty').length };
    },
    async insertVerdict(row) {
      if (verdicts.has(row.case_id)) throw new StoreError('VERDICT_EXISTS');
      verdicts.set(row.case_id, { verdict: row.verdict });
    },
    async verdictFor(cid) { return verdicts.get(cid) ?? null; },
    async insertSubmission(row) {
      const dup = [...submissions.values()].find((s) => s.judge === row.judge_party_id && s.local_ref === row.local_ref);
      if (dup) throw new StoreError('DUPLICATE_SUBMISSION');
      const sid = id();
      submissions.set(sid, { id: sid, judge: row.judge_party_id, local_ref: row.local_ref, case_id: null });
      return sid;
    },
    async attachSubmission(sid, cid) { submissions.get(sid)!.case_id = cid; },
    async insertClaim(row) {
      claims.set(row.guest_party_id, { ...row, attempts: 0, used_at: null, claimant_party_id: null } as any);
    },
    async reissueClaim(gid, hash, expires) {
      const c = claims.get(gid);
      if (c && !c.used_at) Object.assign(c, { code_hash: hash, expires_at: expires, attempts: 0 });
    },
    async claimFor(gid) { return claims.get(gid) ?? null; },
    async redeemClaim(no, hash, claimant) {
      // Mirrors public.court_redeem_claim: lock the case, match among open claims, count misses, mark used once.
      const c = [...cases.values()].find((x) => x.case_no === no);
      if (!c) return { ok: false, error: 'WRONG_CODE' };
      const open = [...claims.values()].filter((x) => x.case_id === c.id && !x.used_at);
      const match = open.find((x) => x.code_hash === hash);
      if (!match) { open.forEach((x) => (x.attempts += 1)); return { ok: false, error: 'WRONG_CODE' }; }
      if (match.attempts >= 5) return { ok: false, error: 'LOCKED' };
      if (Date.parse(match.expires_at) < Date.now()) return { ok: false, error: 'EXPIRED' };
      match.used_at = new Date().toISOString();
      match.claimant_party_id = claimant;
      return { ok: true, guest_party_id: match.guest_party_id };
    },
    async queueAnnouncement(cid, kind) {
      const key = `${cid}|${kind}`;
      if (![...announcements.values()].some((a) => `${a.case_id}|${a.kind}` === key)) {
        const aid = id();
        announcements.set(aid, { id: aid, case_id: cid, kind, posted: false, message_id: null });
      }
    },
    async pendingAnnouncements(limit) {
      return [...announcements.values()].filter((a) => !a.posted).slice(0, limit).map((a) => ({ id: a.id, case_id: a.case_id, kind: a.kind }));
    },
    async ackAnnouncement(aid, messageId) { const a = announcements.get(aid)!; a.posted = true; a.message_id = messageId; },
    async rateHit(bucket, max, windowSeconds) {
      const now = Date.now();
      const r = rate.get(bucket);
      if (!r || now - r.start > windowSeconds * 1000) { rate.set(bucket, { start: now, hits: 1 }); return 1 <= max; }
      r.hits += 1;
      return r.hits <= max;
    },
    async workerOk(hash, guild) { return guild === GUILD && hash === (await sha256Hex(WORKER_TOKEN)); },
  };

  const auth = {
    async userFromToken(token: string) { const uid = users.get(token); return uid && uid !== 'nobody' ? { id: uid } : null; },
    async isJudge(token: string) { const uid = users.get(token); return !!uid && judges.has(uid); },
  };

  return {
    store, auth, cases, claims, announcements, consents, parties, rate, announcementsList: () => [...announcements.values()],
    expireClaim(caseNo: number) {
      const c = [...cases.values()].find((x) => x.case_no === caseNo)!;
      for (const cl of claims.values()) if (cl.case_id === c.id) cl.expires_at = new Date(Date.now() - 1000).toISOString();
    },
    clearRate(bucket: string) { rate.delete(bucket); },
  };
}
