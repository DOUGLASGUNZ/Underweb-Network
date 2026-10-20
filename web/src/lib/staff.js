import { supabase } from './supabase';

/**
 * Names for a list of user ids, for staff screens. Tries the staff resolver first
 * (added in 20261015010000_staff_tools.sql), falls back to the owner/director
 * resolver, then to public identities. Never throws — unknown ids show a short id.
 */
export async function resolveNames(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const out = {};
    if (!unique.length) return out;
    for (const fn of ['uw_staff_resolve_members', 'uw_moderation_resolve_members']) {
        const { data, error } = await supabase.rpc(fn, { p_user_ids: unique });
        if (!error && data) {
            data.forEach((r) => (out[r.id] = { name: r.display_name || r.username || '', username: r.username || '', avatar: r.avatar_url || '' }));
            if (unique.every((id) => out[id])) return out;
        }
    }
    await Promise.all(
        unique
            .filter((id) => !out[id])
            .map(async (id) => {
                const { data } = await supabase.rpc('uw_public_identity', { p_user_id: id });
                const row = Array.isArray(data) ? data[0] : data;
                if (row) out[id] = { name: row.display_name || row.username || '', username: row.username || '', avatar: row.avatar_url || '' };
            })
    );
    return out;
}

export const nameOf = (names, id) => names[id]?.name || names[id]?.username || `Member ${String(id).slice(0, 6)}`;

export const SCOPES = [
    ['underweb', 'UnderWeb'],
    ['symbiotes', 'Symbiotes'],
    ['both', 'Both']
];
export const scopeLabel = (s) => (SCOPES.find(([k]) => k === s) || [s, s ? String(s).replace(/_/g, ' ') : 'UnderWeb'])[1];

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const AVAILABILITY = [
    ['available', 'Available'],
    ['limited', 'Limited'],
    ['by_request', 'By request'],
    ['unavailable', 'Off']
];
