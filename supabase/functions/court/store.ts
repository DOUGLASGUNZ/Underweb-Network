// Production store: the court tables and SQL helpers, through supabase-js with the service role.
// Only this file touches the database. Constraint violations become our own StoreError codes.
import { StoreError, type Claim, type CaseRow, type Party, type Store, type Tally } from './handler.ts';
import { makeEvidence } from './logic.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

function mapError(error: { code?: string; message?: string } | null, context: string): never | void {
  if (!error) return;
  const msg = error.message ?? '';
  if (error.code === '23505') {
    if (msg.includes('court_cases_one_open_per_plaintiff')) throw new StoreError('OPEN_CASE_EXISTS');
    if (msg.includes('court_verdicts_pkey')) throw new StoreError('VERDICT_EXISTS');
    if (msg.includes('court_submissions')) throw new StoreError('DUPLICATE_SUBMISSION');
  }
  throw new Error(`${context}: ${error.code ?? 'db'}`);
}

export function createSupabaseStore(db: Client): Store {
  const one = async <T>(q: Promise<{ data: T | null; error: any }>, ctx: string): Promise<T | null> => {
    const { data, error } = await q; mapError(error, ctx); return data ?? null;
  };
  const many = async <T>(q: Promise<{ data: T[] | null; error: any }>, ctx: string): Promise<T[]> => {
    const { data, error } = await q; mapError(error, ctx); return data ?? [];
  };
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, args); mapError(error, name); return data as T;
  };

  return {
    async listReasons() {
      return many(db.from('court_reasons').select('id,text,rating,category').eq('enabled', true).order('id'), 'reasons');
    },
    async reasonEnabled(id) {
      return (await one(db.from('court_reasons').select('id').eq('id', id).eq('enabled', true).maybeSingle(), 'reason')) !== null;
    },
    async ensureParty(p) {
      const row = { kind: p.kind, ref_key: p.ref_key, label: p.label, linked_user_id: p.linked_user_id ?? null, discord_user_id: p.discord_user_id ?? null };
      const saved = await one<Party>(db.from('court_parties').upsert(row, { onConflict: 'ref_key' }).select().single(), 'ensureParty');
      return saved!;
    },
    async partyById(id) { return one<Party>(db.from('court_parties').select().eq('id', id).maybeSingle(), 'partyById'); },
    async partyByRef(ref) { return one<Party>(db.from('court_parties').select().eq('ref_key', ref).maybeSingle(), 'partyByRef'); },
    async setAccepting(partyId, value) {
      mapError((await db.from('court_parties').update({ accepting_suits: value }).eq('id', partyId)).error, 'setAccepting');
    },
    async profileFor(userId) {
      const row = await one<{ display_name: string | null; username: string | null; public_profile: boolean }>(
        db.from('profiles').select('display_name,username,public_profile').eq('id', userId).maybeSingle(), 'profile');
      if (!row) return null;
      return { label: row.display_name || row.username || 'UnderWeb member', isPublic: row.public_profile === true };
    },
    async findMembers(query, limit) {
      const rows = await many<{ id: string; display_name: string | null; username: string | null }>(
        db.from('profiles').select('id,display_name,username').eq('public_profile', true)
          .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`).limit(limit), 'findMembers');
      return rows.map((r) => ({ user_id: r.id, label: r.display_name || r.username || 'UnderWeb member' }));
    },
    async insertCase(row) {
      return (await one<CaseRow>(db.from('court_cases').insert(row).select().single(), 'insertCase'))!;
    },
    async caseById(id) { return one<CaseRow>(db.from('court_cases').select().eq('id', id).maybeSingle(), 'caseById'); },
    async caseByNo(no) { return one<CaseRow>(db.from('court_cases').select().eq('case_no', no).maybeSingle(), 'caseByNo'); },
    async updateCase(id, patch) {
      return (await one<CaseRow>(db.from('court_cases').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single(), 'updateCase'))!;
    },
    async listPublicCases(limit) {
      return many<CaseRow>(db.from('court_cases').select().eq('publication', 'public').order('created_at', { ascending: false }).limit(limit), 'listPublic');
    },
    async listCasesForParty(partyId, limit) {
      return many<CaseRow>(db.from('court_cases').select()
        .or(`plaintiff_party_id.eq.${partyId},defendant_party_id.eq.${partyId}`).order('created_at', { ascending: false }).limit(limit), 'listForParty');
    },
    async listClaimedCasesFor(claimantPartyId, limit) {
      const claims = await many<{ case_id: string }>(db.from('court_claims').select('case_id').eq('claimant_party_id', claimantPartyId), 'claimedFor');
      if (!claims.length) return [];
      return many<CaseRow>(db.from('court_cases').select().in('id', claims.map((c) => c.case_id)).order('created_at', { ascending: false }).limit(limit), 'claimedCases');
    },
    async openCaseFor(partyId) {
      return one<CaseRow>(db.from('court_cases').select().eq('plaintiff_party_id', partyId).in('status', ['filed', 'accepted']).maybeSingle(), 'openCase');
    },
    async insertEvidence(caseId, rows) {
      if (!rows.length) return;
      mapError((await db.from('court_evidence').insert(rows.map((r) => ({ case_id: caseId, ...r })))).error, 'insertEvidence');
    },
    async evidenceFor(caseId) {
      return many(db.from('court_evidence').select('slot,kind,title,body,label').eq('case_id', caseId).order('slot'), 'evidence');
    },
    async setConsent(caseId, partyId, kind, granted, source) {
      mapError((await db.from('court_consents').upsert({ case_id: caseId, party_id: partyId, kind, granted, source, updated_at: new Date().toISOString() },
        { onConflict: 'case_id,party_id,kind' })).error, 'setConsent');
    },
    async consentsFor(caseId) {
      return many(db.from('court_consents').select('party_id,kind,granted').eq('case_id', caseId), 'consents');
    },
    async isBlocked(blockerId, blockedId) {
      return (await one(db.from('court_blocks').select('blocker_party_id').eq('blocker_party_id', blockerId).eq('blocked_party_id', blockedId).maybeSingle(), 'isBlocked')) !== null;
    },
    async addBlock(blockerId, blockedId) {
      mapError((await db.from('court_blocks').upsert({ blocker_party_id: blockerId, blocked_party_id: blockedId })).error, 'addBlock');
    },
    async communityVoteFor(caseId, partyId) {
      const row = await one<{ choice: 'guilty' | 'not_guilty'; changes: number }>(
        db.from('court_community_votes').select('choice,changes').eq('case_id', caseId).eq('voter_party_id', partyId).maybeSingle(), 'vote');
      return row ? { choice: row.choice, changes: row.changes } : null;
    },
    async saveCommunityVote(caseId, partyId, choice, changes) {
      mapError((await db.from('court_community_votes').upsert({ case_id: caseId, voter_party_id: partyId, choice, changes,
        updated_at: new Date().toISOString() }, { onConflict: 'case_id,voter_party_id' })).error, 'saveVote');
    },
    async tally(caseId): Promise<Tally> {
      const rows = await many<{ choice: string }>(db.from('court_community_votes').select('choice').eq('case_id', caseId), 'tally');
      return { guilty: rows.filter((r) => r.choice === 'guilty').length, not_guilty: rows.filter((r) => r.choice === 'not_guilty').length };
    },
    async insertVerdict(row) { mapError((await db.from('court_verdicts').insert(row)).error, 'insertVerdict'); },
    async verdictFor(caseId) { return one<{ verdict: string }>(db.from('court_verdicts').select('verdict').eq('case_id', caseId).maybeSingle(), 'verdictFor'); },
    async insertSubmission(row) {
      const saved = await one<{ id: string }>(db.from('court_submissions').insert(row).select('id').single(), 'insertSubmission');
      return saved!.id;
    },
    async attachSubmission(submissionId, caseId) {
      mapError((await db.from('court_submissions').update({ case_id: caseId }).eq('id', submissionId)).error, 'attachSubmission');
    },
    async insertClaim(row) { mapError((await db.from('court_claims').insert(row)).error, 'insertClaim'); },
    async reissueClaim(guestPartyId, codeHash, expiresAt) {
      mapError((await db.from('court_claims').update({ code_hash: codeHash, expires_at: expiresAt, attempts: 0, issued_at: new Date().toISOString() })
        .eq('guest_party_id', guestPartyId).is('used_at', null)).error, 'reissueClaim');
    },
    async claimFor(guestPartyId) { return one<Claim>(db.from('court_claims').select().eq('guest_party_id', guestPartyId).maybeSingle(), 'claimFor'); },
    async redeemClaim(caseNo, codeHash, claimantPartyId) {
      return rpc<{ ok: true; guest_party_id: string } | { ok: false; error: string }>('court_redeem_claim',
        { p_case_no: caseNo, p_code_hash: codeHash, p_claimant_party: claimantPartyId });
    },
    async queueAnnouncement(caseId, kind) {
      const { error } = await db.from('court_announcements').insert({ case_id: caseId, kind });
      if (error && error.code !== '23505') mapError(error, 'queueAnnouncement');
    },
    async pendingAnnouncements(limit) {
      return many(db.from('court_announcements').select('id,case_id,kind').is('posted_at', null).order('created_at').limit(limit), 'pending');
    },
    async ackAnnouncement(id, messageId) {
      mapError((await db.from('court_announcements').update({ posted_at: new Date().toISOString(), message_id: messageId }).eq('id', id)).error, 'ack');
    },
    async rateHit(bucket, max, windowSeconds) {
      return rpc<boolean>('court_rate_hit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
    },
    async workerOk(tokenHash, guildId) {
      return rpc<boolean>('court_worker_ok', { p_token_hash: tokenHash, p_guild: guildId });
    },
  };
}

export { makeEvidence };
