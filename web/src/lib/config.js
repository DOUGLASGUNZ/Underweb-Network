// Features that haven't moved to the new site yet still live on the current one.
// Links to it are labelled so nobody hits a dead end while the rebuild finishes.
export const LEGACY_SITE = import.meta.env.VITE_LEGACY_SITE || 'https://www.underweb.cloud';

export const DISCORD_INVITE = import.meta.env.VITE_DISCORD_INVITE || '';

export const ROLE_SIGILS = Object.freeze({
    owner: '/media/roles/owner.webp',
    director: '/media/roles/director.webp',
    event_lead: '/media/roles/event_lead.webp',
    artist_coordinator: '/media/roles/artist_coordinator.webp',
    moderator: '/media/roles/moderator.webp'
});
