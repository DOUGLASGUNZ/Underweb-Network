// Features that haven't moved to the new site yet live on the classic site,
// served from /classic on the same domain. Links to it are labelled.
export const LEGACY_SITE = import.meta.env.VITE_LEGACY_SITE || '/classic';

export const DISCORD_INVITE = import.meta.env.VITE_DISCORD_INVITE || 'https://discord.gg/underweb';

export const ROLE_SIGILS = Object.freeze({
    owner: '/media/roles/owner.webp',
    director: '/media/roles/director.webp',
    event_lead: '/media/roles/event_lead.webp',
    artist_coordinator: '/media/roles/artist_coordinator.webp',
    moderator: '/media/roles/moderator.webp'
});
