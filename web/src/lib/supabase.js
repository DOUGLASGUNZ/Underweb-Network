import { createClient } from '@supabase/supabase-js';

// Publishable (anon) key — safe in the browser. Everything it can do is limited by RLS.
// The service-role key must never appear in this app.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pxipclkptxpqukefwexh.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_g6XQVQvYVSWpIskA7r_1cQ_CaHkVnmc';

// Same storage key as the original site, so people stay signed in when the new site
// replaces the old one on underweb.cloud.
const STORAGE_KEY = 'underweb-auth-v1';
const LEGACY_KEY = 'sb-pxipclkptxpqukefwexh-auth-token';
try {
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_KEY)) {
        localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_KEY));
    }
} catch {
    /* storage unavailable (private mode) — sessions just won't persist */
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: STORAGE_KEY,
        // Implicit flow: a sign-in link works even if it's opened in a different
        // browser than the one that requested it (common on phones: email app → in-app browser).
        flowType: 'implicit'
    }
});

/** Where sign-in links send people back to. */
export function authRedirectUrl(path = '/auth/callback') {
    return `${window.location.origin}${path}`;
}

/** Turn a Supabase/PostgREST error into something a person can act on. */
export function friendlyError(error, fallback = 'Something went wrong. Try again.') {
    if (!error) return '';
    const msg = String(error.message || error.error_description || error || '');
    if (/fetch|network|Failed to fetch/i.test(msg)) return "Can't reach UnderWeb right now. Check your connection and try again.";
    if (/JWT|expired|invalid claim/i.test(msg)) return 'Your session expired. Sign in again.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
    if (/duplicate key|unique/i.test(msg)) return 'That’s already taken.';
    if (/permission denied|row-level security|not allowed|insufficient/i.test(msg)) return "You don't have permission to do that.";
    return msg || fallback;
}
