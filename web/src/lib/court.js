// Client for the court edge function. Public reads need no login. Everything else uses the signed-in session.
// The server decides every permission. These helpers only show what the server returns.
import { supabase, SUPABASE_URL } from './supabase';

const MESSAGES = {
    AUTH_REQUIRED: 'Sign in to do that.',
    FORBIDDEN: "You're not allowed to do that.",
    NOT_FOUND: 'Not found.',
    INVALID_REQUEST: 'Something in that form is wrong. Check it and try again.',
    REQUEST_TOO_LARGE: 'That is too large to send.',
    REASON_NOT_IN_LIBRARY: 'Pick a charge from the list.',
    BAD_DAMAGES: 'Damages must be between 0 and 50,000.',
    SELF_SUIT: "You can't sue yourself.",
    OPEN_CASE_EXISTS: 'You already have an open case. Finish it first.',
    FILING_COOLDOWN: 'You can file once every 24 hours. Try again later.',
    NOT_ACCEPTING_FROM_YOU: "That player isn't taking suits from you right now.",
    COUNTERSUIT_NOT_THE_DEFENDANT: 'Only the person being sued can countersue this case.',
    COUNTERSUIT_TARGET_MISMATCH: "This countersuit doesn't match the case.",
    ORIGINAL_CASE_CLOSED: 'The original case is already closed.',
    NOT_THE_DEFENDANT: 'Only the defendant can answer this case.',
    NOT_WAITING_FOR_ANSWER: 'This case is no longer waiting for an answer.',
    CASE_NOT_OPEN: 'This case is not open for a verdict.',
    NEEDS_BOTH_CONSENTS: 'Both players must agree to publish before a judge can approve.',
    ALREADY_CLAIMED: 'This record has already been claimed.',
    WRONG_CODE: "That code doesn't match an open record. Check it and try again.",
    EXPIRED: 'That code has expired. Ask a judge for a new one.',
    LOCKED: 'Too many wrong codes on this record. Ask a judge for a new one.',
    RATE_LIMITED: 'Too many tries. Wait a while and try again.',
    CLAIM_CANNOT_CONSENT: 'Claimants can withdraw consent, but cannot grant it.',
    DUPLICATE_SUBMISSION: 'That result was already submitted.',
    CHECKSUM_MISMATCH: 'That result was changed after it was exported, so it was refused.',
    POLL_CLOSED: 'Voting is closed on this case.',
    PARTY_CANNOT_VOTE: 'The players in a case cannot vote on it.',
    VOTE_CHANGE_LIMIT: 'You have changed your vote the maximum number of times.',
    INTERNAL_ERROR: 'Something went wrong on our side. Try again in a moment.',
};

export function courtMessage(code) {
    if (MESSAGES[code]) return MESSAGES[code];
    if (String(code || '').startsWith('UNKNOWN_FIELD')) return 'The result has a field the court does not accept.';
    if (String(code || '').startsWith('BAD_')) return 'The result has a value out of range. Check it and try again.';
    return 'Something went wrong. Try again.';
}

export async function courtPublic(action, params = {}) {
    const qs = new URLSearchParams({ action, ...params });
    let response;
    try {
        response = await fetch(`${SUPABASE_URL}/functions/v1/court?${qs}`);
    } catch {
        throw new Error('NETWORK');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'UNKNOWN');
    return body;
}

export async function courtCall(action, body = {}) {
    const { data, error } = await supabase.functions.invoke('court', { body: { action, ...body } });
    if (error) {
        let code = 'UNKNOWN';
        try {
            const json = await error.context.json();
            code = json.error || code;
        } catch {
            /* the server did not return JSON */
        }
        throw new Error(code);
    }
    return data;
}

export const STATUS_LABELS = {
    filed: 'Waiting for an answer',
    accepted: 'Open',
    declined: 'Declined',
    verdict_guilty: 'Guilty',
    verdict_not_guilty: 'Not guilty',
    dismissed: 'Dismissed',
    settled: 'Settled (recorded only)',
};
