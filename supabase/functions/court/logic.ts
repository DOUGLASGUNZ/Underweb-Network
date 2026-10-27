// UnderWeb Court: pure rules. No database, no Deno APIs, so the same file runs in Node tests and in the edge function.
// FICTIONAL ROLEPLAY ONLY.

export const CLAIM_TTL_MS = 10 * 60 * 1000;
export const CLAIM_MAX_ATTEMPTS = 5;
export const CLAIM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O or U
export const DAMAGES_MAX = 50000;
export const COMMUNITY_MAX_CHANGES = 3;
export const FILING_COOLDOWN_SECONDS = 24 * 60 * 60;
export const JUDGE_MIN_RANK = 55; // matches STAFF_RANK in the website's account module (staff tools threshold)

export type PartyKind = 'linked' | 'discord' | 'guest';
export type Choice = 'guilty' | 'not_guilty';

// ---------------------------------------------------------------- hashing, codes, checksums
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Keyed hash for claim codes. The pepper lives only in the edge function's secrets. */
export async function hashClaimCode(normalizedCode: string, pepper: string): Promise<string> {
  if (pepper.length < 32) throw new Error('claim pepper too short');
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`court-claim:v1:${normalizedCode}`)));
}

/** 10 characters from a 32-symbol alphabet: 50 bits, no modulo bias (256 is a multiple of 32). Shown as XXXXX-XXXXX. */
export function randomClaimCode(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string {
  let s = '';
  for (const b of bytes) s += CLAIM_ALPHABET[b & 31];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** Accepts what people actually type: lowercase, spaces, dashes, and the look-alikes O/I/L/U. Returns null if malformed. */
export function normalizeClaimCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 10) return null;
  for (const ch of s) if (!CLAIM_ALPHABET.includes(ch)) return null;
  return s;
}

/** Stable JSON: sorted keys at every level. The bot and Unity exporter must produce the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function resultChecksum(payloadWithoutChecksum: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson(payloadWithoutChecksum));
}

// ---------------------------------------------------------------- labels
/** Strips control characters, mention syntax and markdown, and trims length. Labels are never matched on. */
export function safeLabel(input: unknown, max = 64): string {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[@`*_~|<>\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || 'Unnamed').slice(0, max);
}

// ---------------------------------------------------------------- result payload (in-world export, format_version 1)
export interface ResultPayload {
  format_version: 1;
  local_ref: string;
  accusation_id: string;
  damages_requested: number;
  verdict: 'guilty' | 'not_guilty' | 'dismissed' | 'settled';
  settlement_amount?: number;
  jury: { guilty: number; not_guilty: number };
  notes: string;
  plaintiff: { label: string; consent_publish: boolean };
  defendant: { label: string; consent_publish: boolean };
  exported_at: string;
  checksum: string;
}

const RESULT_KEYS = new Set(['format_version', 'local_ref', 'accusation_id', 'damages_requested', 'verdict', 'settlement_amount',
  'jury', 'notes', 'plaintiff', 'defendant', 'exported_at', 'checksum']);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Strict validation. Unknown keys are rejected, so a typo never silently drops data.
 * The checksum catches edits after export. It does not prove the judge's account of events is true.
 */
export async function validateResult(input: unknown): Promise<{ ok: true; value: ResultPayload } | { ok: false; error: string }> {
  if (!isObj(input)) return { ok: false, error: 'RESULT_NOT_OBJECT' };
  for (const k of Object.keys(input)) if (!RESULT_KEYS.has(k)) return { ok: false, error: `UNKNOWN_FIELD:${k}` };
  if (input.format_version !== 1) return { ok: false, error: 'UNSUPPORTED_FORMAT' };
  if (typeof input.local_ref !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.local_ref)) return { ok: false, error: 'BAD_LOCAL_REF' };
  if (typeof input.accusation_id !== 'string' || input.accusation_id.length < 1 || input.accusation_id.length > 32) return { ok: false, error: 'BAD_ACCUSATION' };
  if (!isInt(input.damages_requested, 0, DAMAGES_MAX)) return { ok: false, error: 'BAD_DAMAGES' };
  if (!['guilty', 'not_guilty', 'dismissed', 'settled'].includes(input.verdict as string)) return { ok: false, error: 'BAD_VERDICT' };
  if (input.verdict === 'settled') {
    if (!isInt(input.settlement_amount, 0, DAMAGES_MAX)) return { ok: false, error: 'BAD_SETTLEMENT' };
  } else if (input.settlement_amount !== undefined) return { ok: false, error: 'SETTLEMENT_ONLY_WHEN_SETTLED' };
  if (!isObj(input.jury) || !isInt(input.jury.guilty, 0, 999) || !isInt(input.jury.not_guilty, 0, 999)) return { ok: false, error: 'BAD_JURY' };
  if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 300)) return { ok: false, error: 'BAD_NOTES' };
  for (const side of ['plaintiff', 'defendant'] as const) {
    const p = input[side];
    if (!isObj(p) || typeof p.label !== 'string' || typeof p.consent_publish !== 'boolean') return { ok: false, error: `BAD_${side.toUpperCase()}` };
    for (const k of Object.keys(p)) if (k !== 'label' && k !== 'consent_publish') return { ok: false, error: `UNKNOWN_FIELD:${side}.${k}` };
  }
  if (typeof input.exported_at !== 'string' || Number.isNaN(Date.parse(input.exported_at))) return { ok: false, error: 'BAD_EXPORTED_AT' };
  if (typeof input.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(input.checksum)) return { ok: false, error: 'BAD_CHECKSUM' };

  const { checksum, ...rest } = input;
  if ((await resultChecksum(rest)) !== checksum) return { ok: false, error: 'CHECKSUM_MISMATCH' };

  const value: ResultPayload = {
    format_version: 1,
    local_ref: input.local_ref,
    accusation_id: input.accusation_id,
    damages_requested: input.damages_requested as number,
    verdict: input.verdict as ResultPayload['verdict'],
    jury: { guilty: input.jury.guilty as number, not_guilty: input.jury.not_guilty as number },
    notes: safeLabel(input.notes ?? '', 300),
    plaintiff: { label: safeLabel((input.plaintiff as any).label), consent_publish: (input.plaintiff as any).consent_publish },
    defendant: { label: safeLabel((input.defendant as any).label), consent_publish: (input.defendant as any).consent_publish },
    exported_at: input.exported_at,
    checksum: checksum as string,
  };
  if (value.verdict === 'settled') value.settlement_amount = input.settlement_amount as number;
  return { ok: true, value };
}

// ---------------------------------------------------------------- filing, responding, publishing
export interface FilingFacts {
  plaintiffId: string;
  defendantId: string;
  defendantAccepting: boolean;
  defendantBlocksPlaintiff: boolean;
  reasonEnabled: boolean;
  damages: number;
  plaintiffHasOpenCase: boolean;
  filedWithinCooldown: boolean;
  countersuitOf?: { defendantId: string; plaintiffId: string; status: string } | null;
}
/** Returns an error code, or null when the filing may proceed. Messages stay generic so blocks are not revealed. */
export function filingError(f: FilingFacts): string | null {
  if (f.plaintiffId === f.defendantId) return 'SELF_SUIT';
  if (!f.reasonEnabled) return 'REASON_NOT_IN_LIBRARY';
  if (!isInt(f.damages, 0, DAMAGES_MAX)) return 'BAD_DAMAGES';
  if (!f.defendantAccepting || f.defendantBlocksPlaintiff) return 'NOT_ACCEPTING_FROM_YOU';
  if (f.plaintiffHasOpenCase) return 'OPEN_CASE_EXISTS';
  if (f.filedWithinCooldown) return 'FILING_COOLDOWN';
  if (f.countersuitOf) {
    const c = f.countersuitOf;
    if (c.defendantId !== f.plaintiffId) return 'COUNTERSUIT_NOT_THE_DEFENDANT';
    if (c.plaintiffId !== f.defendantId) return 'COUNTERSUIT_TARGET_MISMATCH';
    if (!['filed', 'accepted'].includes(c.status)) return 'ORIGINAL_CASE_CLOSED';
  }
  return null;
}

/** Only the defendant can answer, and only while the case is waiting for an answer. Decline ends the case. */
export function respondError(actorId: string, defendantId: string, status: string): string | null {
  if (actorId !== defendantId) return 'NOT_THE_DEFENDANT';
  if (status !== 'filed') return 'NOT_WAITING_FOR_ANSWER';
  return null;
}

/** Public display: both parties must have granted publish, and a judge must approve. Nothing else makes a case public. */
export function publicationReady(publishByParty: { plaintiff: boolean; defendant: boolean }, approved: boolean): boolean {
  return publishByParty.plaintiff === true && publishByParty.defendant === true && approved === true;
}

// ---------------------------------------------------------------- community poll (Discord only, separate from the jury)
export interface VoteFacts {
  voterKind: PartyKind;
  isParty: boolean;
  pollOpen: boolean;
  existing: { choice: Choice; changes: number } | null;
  choice: Choice;
}
export function communityVote(v: VoteFacts): { ok: true; changes: number; unchanged: boolean } | { ok: false; error: string } {
  if (v.voterKind !== 'discord') return { ok: false, error: 'DISCORD_ONLY' };
  if (v.isParty) return { ok: false, error: 'PARTY_CANNOT_VOTE' };
  if (!v.pollOpen) return { ok: false, error: 'POLL_CLOSED' };
  if (!v.existing) return { ok: true, changes: 0, unchanged: false };
  if (v.existing.choice === v.choice) return { ok: true, changes: v.existing.changes, unchanged: true };
  if (v.existing.changes >= COMMUNITY_MAX_CHANGES) return { ok: false, error: 'VOTE_CHANGE_LIMIT' };
  return { ok: true, changes: v.existing.changes + 1, unchanged: false };
}

// ---------------------------------------------------------------- guest claims
export function claimExpiry(now: number): string {
  return new Date(now + CLAIM_TTL_MS).toISOString();
}

/** Public label for a party. Discord users are never named publicly. Guests are always marked unverified. */
export function publicLabel(p: { kind: PartyKind; label: string }, linkedProfilePublic: boolean): string {
  if (p.kind === 'linked') return linkedProfilePublic ? safeLabel(p.label) : 'An UnderWeb member';
  if (p.kind === 'discord') return 'A Discord member';
  return `${safeLabel(p.label)} (unverified guest)`;
}

// ---------------------------------------------------------------- fictional exhibits (generated once per website case)
// Deliberately not realistic records: no receipts, ledgers, balances, account or payment details of any kind.
const EXHIBITS: { slot: number; kind: 'chat_log' | 'witness_statement' | 'incident_report' | 'defense' | 'surprise'; title: string; lines: string[] }[] = [
  { slot: 1, kind: 'chat_log', title: 'Exhibit A: Chat log (fictional)', lines: [
    '[21:14] {defendant}: did you SEE what they did at the bar',
    '[21:15] {plaintiff}: i said i was SORRY',
    '[21:15] {defendant}: a sorry with no follow-up is not a sorry',
  ] },
  { slot: 2, kind: 'witness_statement', title: 'Exhibit B: Witness statement (fictional)', lines: [
    'I was standing near the couch. I saw everything and I will not say what.',
    'Signed: a witness who may or may not exist.',
  ] },
  { slot: 3, kind: 'incident_report', title: 'Exhibit C: Incident report (fictional)', lines: [
    'Incident: the lobby, 2 minutes after the DJ set ended.',
    'Parties: {plaintiff} and {defendant}. Severity: unclear. Vibes: tense.',
  ] },
  { slot: 4, kind: 'defense', title: 'Exhibit D: Defense statement (fictional)', lines: [
    '{defendant} states that the events were a misunderstanding, a joke, and mostly the fault of the lighting.',
  ] },
  { slot: 5, kind: 'chat_log', title: 'Exhibit E: Chat log, follow-up (fictional)', lines: [
    '[09:02] {plaintiff}: so are we good or what',
    '[09:40] {defendant}: we will see in court',
  ] },
  { slot: 6, kind: 'surprise', title: 'Exhibit F: Surprise evidence (fictional)', lines: [
    'A photo of {defendant} asleep in the Chillout. Admissibility: disputed.',
  ] },
];

export function makeEvidence(plaintiff: string, defendant: string) {
  const fill = (lines: string[]) => lines
    .map((l) => l.replaceAll('{plaintiff}', safeLabel(plaintiff, 40)).replaceAll('{defendant}', safeLabel(defendant, 40)))
    .join('\n');
  return EXHIBITS.map((e) => ({ slot: e.slot, kind: e.kind, title: e.title, body: fill(e.lines), label: 'FICTIONAL ROLEPLAY EXHIBIT' }));
}

// ---------------------------------------------------------------- Discord announcement text (never mentions anyone)
export function verdictText(c: { caseNo: number; accusation: string; verdict: string; damages: number; settlement?: number | null;
  plaintiff: string; defendant: string; jury?: { guilty: number; not_guilty: number } | null }): string {
  const outcome: Record<string, string> = {
    guilty: 'GUILTY', not_guilty: 'NOT GUILTY', dismissed: 'DISMISSED', settled: 'SETTLED (recorded only, no Silk moved)',
  };
  const lines = [
    `**UnderWeb Court, case #${c.caseNo}** (fictional roleplay)`,
    `${c.plaintiff} v. ${c.defendant}`,
    `Charge: ${safeLabel(c.accusation, 200)}`,
    `Verdict: **${outcome[c.verdict] ?? safeLabel(c.verdict, 40)}**`,
  ];
  if (c.verdict === 'settled' && c.settlement != null) lines.push(`Settlement recorded: ${c.settlement} (fictional)`);
  if (c.verdict === 'guilty') lines.push(`Damages requested: ${c.damages} (fictional)`);
  if (c.jury) lines.push(`Jury: ${c.jury.guilty} guilty, ${c.jury.not_guilty} not guilty`);
  return lines.join('\n');
}
