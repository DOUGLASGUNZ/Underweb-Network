import { computed, reactive } from 'vue';
import { supabase, friendlyError } from './supabase';

// The signed-in person, as the server sees them. Every permission shown in the UI
// comes from here, and every one of them is also enforced by RLS/RPC checks on the
// server — hiding a button is only a convenience, never the protection.

export const STAFF_RANK = 55; // event_staff and above
export const LEADERSHIP_RANK = 80; // admin, director, owner

const state = reactive({
    loading: true,
    session: null,
    profile: null,
    identity: null,
    roles: [], // [{ slug, name, rank, category, scope }]
    accessState: 'signed_out', // signed_out | not_connected | unverified | pending | needs_attention | granted
    restriction: null, // { restriction_type, reason, expires_at } | null
    error: ''
});

let readyResolve;
let readyPromise = new Promise((resolve) => (readyResolve = resolve));
let loadSeq = 0;

async function loadAccount(session) {
    const seq = ++loadSeq;
    state.session = session;
    state.error = '';
    if (!session) {
        Object.assign(state, { profile: null, identity: null, roles: [], accessState: 'signed_out', restriction: null, loading: false });
        readyResolve?.();
        return;
    }
    state.loading = true;
    const uid = session.user.id;
    const [profileRes, rolesRes, accessRes, restrictionRes, identityRes] = await Promise.all([
        supabase.from('profiles').select('id,username,display_name,avatar_url,bio,timezone,public_profile,onboarding_complete').eq('id', uid).maybeSingle(),
        supabase.from('user_roles').select('role_slug,group_scope,status').eq('user_id', uid),
        supabase.rpc('uw_network_access_state'),
        supabase.rpc('uw_my_active_restriction'),
        supabase.rpc('uw_my_identity')
    ]);
    if (seq !== loadSeq) return; // a newer auth change superseded this load

    if (profileRes.error) state.error = friendlyError(profileRes.error);
    state.profile = profileRes.data || null;

    const active = (rolesRes.data || []).filter((r) => String(r.status || '').toLowerCase() === 'active');
    if (active.length) {
        const slugs = [...new Set(active.map((r) => r.role_slug))];
        const defs = await supabase.from('role_definitions').select('slug,name,authority_rank,category').in('slug', slugs);
        const bySlug = Object.fromEntries((defs.data || []).map((d) => [d.slug, d]));
        state.roles = active
            .map((r) => ({
                slug: r.role_slug,
                scope: r.group_scope,
                name: bySlug[r.role_slug]?.name || r.role_slug,
                rank: bySlug[r.role_slug]?.authority_rank ?? 0,
                category: bySlug[r.role_slug]?.category || ''
            }))
            .sort((a, b) => b.rank - a.rank);
    } else {
        state.roles = [];
    }

    state.accessState = accessRes.error ? 'unknown' : accessRes.data || 'unknown';
    const restriction = Array.isArray(restrictionRes.data) ? restrictionRes.data[0] : restrictionRes.data;
    state.restriction = restriction || null;
    const identity = Array.isArray(identityRes.data) ? identityRes.data[0] : identityRes.data;
    state.identity = identity || null;

    state.loading = false;
    readyResolve?.();
}

let started = false;
export function startAccount() {
    if (started) return readyPromise;
    started = true;
    supabase.auth.getSession().then(({ data }) => loadAccount(data.session));
    supabase.auth.onAuthStateChange((event, session) => {
        // TOKEN_REFRESHED fires often; only reload when who-you-are could have changed.
        if (event === 'TOKEN_REFRESHED') {
            state.session = session;
            return;
        }
        if (event === 'INITIAL_SESSION') return; // handled by getSession above
        void loadAccount(session);
    });
    // Re-check roles/restrictions when the tab comes back, so a ban or new role
    // shows up without a full reload.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.session) void loadAccount(state.session);
    });
    return readyPromise;
}

export function whenAccountReady() {
    return readyPromise;
}

export async function refreshAccount() {
    const { data } = await supabase.auth.getSession();
    await loadAccount(data.session);
}

export async function signOut() {
    // Local scope: signs out this browser only, not your other devices.
    await supabase.auth.signOut({ scope: 'local' });
}

const maxRank = computed(() => state.roles.reduce((max, r) => Math.max(max, r.rank), 0));
const has = (slug) => state.roles.some((r) => r.slug === slug);

export const account = {
    state,
    signedIn: computed(() => Boolean(state.session)),
    userId: computed(() => state.session?.user?.id || ''),
    email: computed(() => state.session?.user?.email || ''),
    onboarded: computed(() => Boolean(state.profile?.username && state.profile?.display_name && state.profile?.onboarding_complete)),
    hasAccess: computed(() => state.accessState === 'granted'),
    maxRank,
    isStaff: computed(() => maxRank.value >= STAFF_RANK),
    isLeadership: computed(() => maxRank.value >= LEADERSHIP_RANK),
    isOwner: computed(() => has('owner')),
    isBanned: computed(() => ['ban', 'banned', 'suspend', 'suspension'].includes(String(state.restriction?.restriction_type || '').toLowerCase())),
    isTimedOut: computed(() => ['timeout', 'mute'].includes(String(state.restriction?.restriction_type || '').toLowerCase())),
    displayName: computed(() => state.profile?.display_name || state.profile?.username || state.session?.user?.email || ''),
    has
};
