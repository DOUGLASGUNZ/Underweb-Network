import { supabase, friendlyError } from './supabase';

const one = (data) => (Array.isArray(data) ? data[0] || null : data || null);

/** Find a member's user id from their exact username (needs network access). */
export async function resolveUsername(username) {
    const u = String(username || '').toLowerCase();
    const { data, error } = await supabase.rpc('uw_search_people', { p_query: u, p_limit: 10 });
    if (error) throw new Error(friendlyError(error));
    return (data || []).find((row) => String(row.username || '').toLowerCase() === u) || null;
}

/**
 * Everything a public profile page shows, loaded in parallel.
 * Each part fails soft: one missing table never blanks the whole page.
 */
export async function loadPublicProfile(userId) {
    const settled = await Promise.allSettled([
        supabase.rpc('uw_public_identity', { p_user_id: userId }),
        supabase
            .from('creator_profiles')
            .select('display_name,headline,bio,primary_specialty,specialties,skills,availability,collaboration_friendly,avatar_url,banner_url,shop_url,shop_label,timezone,public_visible')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase.from('profile_external_links').select('id,platform,label,url,sort_order').eq('user_id', userId).order('sort_order'),
        supabase
            .from('creator_showcase')
            .select('id,media_url,media_type,title,caption,is_featured,sort_order')
            .eq('user_id', userId)
            .eq('moderation_status', 'approved')
            .order('is_featured', { ascending: false })
            .order('sort_order'),
        supabase.rpc('uw_public_verified_vrchat', { p_user_id: userId }),
        supabase.rpc('uw_public_verified_discord', { p_user_id: userId }),
        supabase.from('user_titles').select('title_slug,is_selected').eq('user_id', userId),
        supabase.from('user_badges').select('badge_slug,is_showcased,awarded_at').eq('user_id', userId),
        supabase.rpc('uw_profile_milestones', { p_user_id: userId })
    ]);
    const val = (i) => (settled[i].status === 'fulfilled' && !settled[i].value.error ? settled[i].value.data : null);

    const identity = one(val(0));
    const creator = val(1);
    const titles = val(6) || [];
    const badges = val(7) || [];

    const roleSlugs = identity?.roles || [];
    const [roleDefs, titleDefs, badgeDefs] = await Promise.all([
        roleSlugs.length ? supabase.from('role_definitions').select('slug,name,authority_rank,category').in('slug', roleSlugs) : { data: [] },
        titles.length ? supabase.from('title_definitions').select('slug,name').in('slug', titles.map((t) => t.title_slug)) : { data: [] },
        badges.length ? supabase.from('badge_definitions').select('slug,name,rarity,description,icon_key').in('slug', badges.map((b) => b.badge_slug)) : { data: [] }
    ]);
    const titleName = Object.fromEntries((titleDefs.data || []).map((t) => [t.slug, t.name]));
    const selectedTitle = titles.find((t) => t.is_selected);

    return {
        userId,
        found: Boolean(identity || creator),
        identity,
        creator,
        displayName: creator?.display_name || identity?.display_name || identity?.username || 'UnderWeb member',
        username: identity?.username || '',
        underwebId: identity?.underweb_id || '',
        avatarUrl: creator?.avatar_url || identity?.avatar_url || '',
        bannerUrl: creator?.banner_url || '',
        roles: (roleDefs.data || []).sort((a, b) => b.authority_rank - a.authority_rank),
        title: selectedTitle ? titleName[selectedTitle.title_slug] || '' : '',
        badges: (badgeDefs.data || []).map((b) => ({ ...b, showcased: badges.find((x) => x.badge_slug === b.slug)?.is_showcased })),
        links: val(2) || [],
        showcase: val(3) || [],
        vrchat: one(val(4)),
        discord: one(val(5)),
        milestones: val(8) || []
    };
}

export async function uploadProfileImage(userId, file, kind) {
    if (!file) return null;
    if (!file.type?.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG, WebP or GIF).');
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${userId}/${kind}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('profile-media').upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) throw new Error(friendlyError(up.error));
    return supabase.storage.from('profile-media').getPublicUrl(path).data.publicUrl;
}

/** Is this person an active creator (any role in the creator category)? */
export async function isConfirmedCreator(userId) {
    const [roles, defs] = await Promise.all([
        supabase.from('user_roles').select('role_slug').eq('user_id', userId).eq('status', 'active'),
        supabase.from('role_definitions').select('slug').eq('active', true).eq('category', 'creator')
    ]);
    if (roles.error || defs.error) return false;
    const creatorSlugs = new Set((defs.data || []).map((d) => d.slug));
    return (roles.data || []).some((r) => creatorSlugs.has(r.role_slug));
}
