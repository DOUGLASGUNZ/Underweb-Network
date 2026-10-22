// UWX Group Intelligence / Moderation Center data on the website.
// Same tables and server rules as the UWX desktop app — RLS and the uwx_* functions decide access.
import { supabase } from './supabase';

export const LEVELS = ['No access', 'Viewer', 'Moderator', 'Manager', 'Group owner'];

export const CASE_STATUSES = [
    ['open', 'Open'],
    ['under_review', 'Under Review'],
    ['escalated', 'Escalated'],
    ['resolved', 'Resolved'],
    ['dismissed', 'Dismissed'],
    ['appealed', 'Appealed']
];
export const statusLabel = (id) => CASE_STATUSES.find(([k]) => k === id)?.[1] || id;

export const CASE_CATEGORIES = [
    ['harassment', 'Harassment'],
    ['crashing', 'Crashing / malicious avatar'],
    ['threats', 'Threats'],
    ['doxxing', 'Doxxing / personal info'],
    ['nsfw', 'NSFW outside allowed spaces'],
    ['age_concern', 'Age concern (18+ community)'],
    ['hate', 'Hate speech'],
    ['spam', 'Spam / advertising'],
    ['impersonation', 'Impersonation'],
    ['ban_evasion', 'Ban evasion'],
    ['other', 'Other']
];
export const categoryLabel = (id) => CASE_CATEGORIES.find(([k]) => k === id)?.[1] || id;

const USER_ID = /usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** VRChat user id from a profile link or a pasted id, or '' */
export function vrcUserId(text) {
    const m = String(text || '').match(USER_ID);
    return m ? m[0].toLowerCase() : '';
}

/** Groups you have any UWX access to, with your level. Empty if the database step isn't applied. */
export async function myUwxGroups() {
    const { data, error } = await supabase.rpc('uwx_my_groups');
    if (error) return [];
    return data || [];
}

/** { [userId]: name } for people in a group you staff (profiles are private otherwise). */
export async function namesFor(groupId, ids) {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (!list.length) return {};
    const { data } = await supabase.rpc('uwx_names', { p_group: groupId, p_ids: list });
    return Object.fromEntries((data || []).map((r) => [r.user_id, r.display_name || r.username || 'Staff']));
}

export async function evidenceLink(path) {
    const { data, error } = await supabase.storage.from('uwx-evidence').createSignedUrl(path, 300);
    if (error) throw error;
    return data.signedUrl;
}

export function when(v) {
    const t = typeof v === 'number' ? v : Date.parse(v);
    return t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}
