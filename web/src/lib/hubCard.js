import { supabase, SUPABASE_URL } from './supabase';

// Hub creator cards (Creator Market / Resident DJ) — same table and rules as the old site.
// The database is the real gate: images must be the owner's own uploads, links https-only,
// any edit sends the card back to pending, and only media reviewers can approve.

const STORAGE = `${SUPABASE_URL}/storage/v1/object/public/`;

export const ownImage = (url, uid) =>
    typeof url === 'string' && (url.startsWith(`${STORAGE}creator-showcase/${uid}/`) || url.startsWith(`${STORAGE}profile-media/${uid}/`));

/** '' for empty, the normalized URL for a valid https link, null for anything else. */
export function httpsUrl(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    try {
        const u = new URL(v);
        return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
    } catch {
        return null;
    }
}

const notReady = (e) => !!e && /hub_creator_cards|show_in_hub/.test(e.message || '');

export async function loadMyHubCard(uid) {
    const [cardR, profR, showR, revR, likeR] = await Promise.all([
        supabase.from('hub_creator_cards').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('creator_profiles').select('avatar_url,banner_url,display_name,shop_url,shop_label').eq('user_id', uid).maybeSingle(),
        supabase
            .from('creator_showcase')
            .select('id,title,media_url,media_type,moderation_status,show_in_hub')
            .eq('user_id', uid)
            .eq('moderation_status', 'approved')
            .order('created_at', { ascending: false }),
        supabase.rpc('uw_can_review_media'),
        supabase.rpc('hub_my_likes')
    ]);
    if (notReady(cardR.error)) return { notReady: true };
    const profile = profR.data || {};
    const photos = (showR.data || []).filter((x) => x.media_type === 'image' && ownImage(x.media_url, uid));
    const images = [
        ...(ownImage(profile.banner_url, uid) ? [{ url: profile.banner_url, label: 'Profile banner' }] : []),
        ...(ownImage(profile.avatar_url, uid) ? [{ url: profile.avatar_url, label: 'Profile picture' }] : []),
        ...photos.map((p) => ({ url: p.media_url, label: p.title || 'Showcase' }))
    ];
    // ♥ from the hub's Creator Room (your card + your art-wall pieces); null if the likes migration isn't there
    const lk = Array.isArray(likeR?.data) ? likeR.data[0] : likeR?.data;
    const likes = lk && !likeR.error ? { total: Number(lk.total) || 0, week: Number(lk.this_week) || 0 } : null;
    return { notReady: false, card: cardR.data || null, profile, photos, images, reviewer: revR.data === true, likes };
}

export async function saveHubCard(uid, form) {
    const link = httpsUrl(form.link_url);
    const extra = httpsUrl(form.extra_link_url);
    if (link === null || extra === null) throw new Error('Links must start with https://');
    if (!ownImage(form.image_url, uid)) throw new Error('Pick one of your images for the card.');
    const row = {
        user_id: uid,
        kind: form.kind === 'dj' ? 'dj' : 'market',
        image_url: form.image_url,
        headline: String(form.headline || '').trim().slice(0, 60),
        link_url: link || null,
        link_label: String(form.link_label || '').trim().slice(0, 40),
        extra_link_url: extra || null
    };
    const { error } = await supabase.from('hub_creator_cards').upsert(row, { onConflict: 'user_id' });
    if (error) throw error;
}

export async function setHubCardEnabled(uid, enabled) {
    const { error } = await supabase.from('hub_creator_cards').update({ enabled }).eq('user_id', uid);
    if (error) throw error;
}

export async function removeHubCard(uid) {
    const { error } = await supabase.from('hub_creator_cards').delete().eq('user_id', uid);
    if (error) throw error;
}

export async function setOnHubWall(uid, showcaseId, on) {
    const { error } = await supabase.from('creator_showcase').update({ show_in_hub: on }).eq('id', showcaseId).eq('user_id', uid);
    if (error) throw error;
}

export async function loadHubCardQueue() {
    const { data, error } = await supabase.from('hub_creator_cards').select('*').eq('status', 'pending').order('updated_at', { ascending: true });
    if (error) return notReady(error) ? [] : Promise.reject(error);
    const rows = data || [];
    const ids = rows.map((r) => r.user_id);
    let names = {};
    if (ids.length) {
        const { data: cp } = await supabase.from('creator_profiles').select('user_id,display_name').in('user_id', ids);
        names = Object.fromEntries((cp || []).map((c) => [c.user_id, c.display_name]));
    }
    return rows.map((r) => ({ ...r, name: names[r.user_id] || 'Member', safeImage: ownImage(r.image_url, r.user_id) ? r.image_url : '' }));
}

export async function reviewHubCard(userId, approve, note) {
    const { error } = await supabase.rpc('uw_review_hub_card', { p_user_id: userId, p_approve: approve, p_note: note || null });
    if (error) throw error;
}

/** Staff: start the hub-world update now instead of waiting for GitHub's (often hours-late) schedule. */
export async function pushHubToWorld() {
    const { data, error } = await supabase.functions.invoke('hub-cards-publish', { body: {} });
    if (error) {
        let code = '';
        try {
            code = (await error.context?.json())?.error || '';
        } catch {
            /* no body */
        }
        throw new Error(code === 'not_configured' || code === 'github_failed' ? "The hub update couldn't be started (GitHub permission). Tell Darko." : 'Could not start the hub update.');
    }
    return data?.status || 'started';
}

/** Staff: when the hub-world update last ran. */
export async function hubPushStatus() {
    const { data } = await supabase.functions.invoke('hub-cards-publish', { body: { status: true } });
    return data?.last_run || null;
}
