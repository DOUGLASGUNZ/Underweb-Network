import { supabase, SUPABASE_URL } from './supabase';
import { account } from './account';

// Public-facing community data for the landing pages. Everything here is either
// readable by signed-out visitors (RLS allows it) or comes from the public hub-cards
// feed, which only ever contains staff-approved, opted-in work.

const HUB_FEED = `${SUPABASE_URL}/functions/v1/hub-cards`;
let hubFeed = null;

export async function loadHubFeed() {
    if (!hubFeed) {
        hubFeed = fetch(HUB_FEED)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
            .then((j) => j || { market: [], dj: [], wall: [] });
    }
    return hubFeed;
}

/** The next published event, or null. Members see the network calendar; visitors the public one. */
export async function nextEvent() {
    const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    if (account.signedIn.value && account.hasAccess.value) {
        const { data } = await supabase
            .from('network_events')
            .select('id,title,starts_at,ends_at,location,cover_url')
            .eq('status', 'published')
            .gte('starts_at', since)
            .order('starts_at')
            .limit(1);
        if (data?.[0]) return data[0];
    }
    const list = await publicEvents('upcoming');
    return list[0] || null;
}

/** Published events for visitors, via the public-events feed (no instance links, nothing private). */
export async function publicEvents(when = 'upcoming') {
    try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/public-events?when=${when === 'past' ? 'past' : 'upcoming'}`);
        const j = r.ok ? await r.json() : null;
        return j?.events || [];
    } catch {
        return [];
    }
}

/**
 * Recent approved photos and art. Verified members see everything staff approved;
 * visitors see the pieces their owners chose to show on the hub wall.
 */
export async function galleryItems(limit = 24) {
    if (account.signedIn.value && account.hasAccess.value) {
        const { data, error } = await supabase
            .from('creator_showcase')
            .select('id,user_id,title,media_url,media_type,reviewed_at')
            .eq('moderation_status', 'approved')
            .eq('media_type', 'image')
            .order('reviewed_at', { ascending: false })
            .limit(limit);
        if (!error && data) {
            const ids = [...new Set(data.map((d) => d.user_id))];
            const names = new Map();
            if (ids.length) {
                const { data: cps } = await supabase.from('creator_profiles').select('user_id,display_name').in('user_id', ids);
                for (const c of cps || []) if (c.display_name) names.set(c.user_id, c.display_name);
            }
            return data.map((d) => ({ id: d.id, title: d.title || 'Untitled', by: names.get(d.user_id) || 'UnderWeb member', byId: d.user_id, image_url: d.media_url }));
        }
    }
    const feed = await loadHubFeed();
    return (feed.wall || []).slice(0, limit);
}

/** Approved, public creator profiles (readable signed out). */
export async function publicCreators() {
    const { data } = await supabase
        .from('creator_profiles')
        .select('user_id,display_name,headline,primary_specialty,specialties,avatar_url,banner_url')
        .eq('public_visible', true)
        .order('updated_at', { ascending: false })
        .limit(12);
    return data || [];
}

/** Where a signed-in member is with setup. Each check reads real account state. */
export async function setupProgress() {
    if (!account.signedIn.value) return null;
    const uid = account.userId.value;
    const [prof, show] = await Promise.all([
        supabase.from('profiles').select('discord_user_id').eq('id', uid).maybeSingle(),
        supabase.from('creator_showcase').select('id', { count: 'exact', head: true }).eq('user_id', uid)
    ]);
    const { data: u } = await supabase.auth.getUser();
    const discord = Boolean(prof.data?.discord_user_id) || (u?.user?.identities || []).some((i) => i.provider === 'discord');
    return {
        account: true,
        profile: account.onboarded.value,
        vrchat: account.hasAccess.value,
        vrchatState: account.state.accessState,
        discord,
        showcase: (show.count || 0) > 0
    };
}
