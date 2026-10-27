import { createRouter, createWebHistory } from 'vue-router';
import { account, whenAccountReady } from './lib/account';

const routes = [
    { path: '/', name: 'home', component: () => import('./views/Home.vue') },
    { path: '/signin', name: 'signin', component: () => import('./views/SignIn.vue'), meta: { title: 'Sign in' } },
    { path: '/auth/callback', name: 'auth-callback', component: () => import('./views/AuthCallback.vue') },
    { path: '/welcome', name: 'welcome', component: () => import('./views/Welcome.vue'), meta: { auth: true, title: 'Set up your profile' } },
    { path: '/start', name: 'start', component: () => import('./views/StartHere.vue'), meta: { title: 'Start here' } },
    { path: '/events', name: 'events', component: () => import('./views/Events.vue'), meta: { title: 'Events' } },
    { path: '/gallery', name: 'gallery', component: () => import('./views/Gallery.vue'), meta: { title: 'Gallery' } },
    { path: '/partners', name: 'partners', component: () => import('./views/Partners.vue'), meta: { title: 'Partner groups' } },
    { path: '/creators', name: 'creators', component: () => import('./views/Creators.vue'), meta: { title: 'Creators' } },
    { path: '/discover', redirect: '/creators' },
    { path: '/u/:username', name: 'profile', component: () => import('./views/Profile.vue'), meta: { auth: true, onboarded: true, title: 'Profile' } },
    { path: '/me', name: 'me', component: () => import('./views/MyUnderWeb.vue'), meta: { auth: true, onboarded: true, title: 'My UnderWeb' } },
    { path: '/me/edit', name: 'profile-edit', component: () => import('./views/ProfileEdit.vue'), meta: { auth: true, onboarded: true, title: 'Edit profile' } },
    { path: '/connections', name: 'connections', component: () => import('./views/Connections.vue'), meta: { auth: true, onboarded: true, title: 'Connected accounts' } },
    { path: '/roles', name: 'roles', component: () => import('./views/Roles.vue'), meta: { auth: true, onboarded: true, access: true, title: 'Roles' } },
    { path: '/staff', name: 'staff', component: () => import('./views/staff/StaffHub.vue'), meta: { auth: true, onboarded: true, access: true, staff: true, title: 'Staff tools' } },
    {
        path: '/staff/media',
        name: 'world-media',
        component: () => import('./views/staff/WorldMedia.vue'),
        meta: { auth: true, onboarded: true, access: true, leadership: true, title: 'World Media Manager' }
    },
    { path: '/court', name: 'court', component: () => import('./views/court/CourtList.vue'), meta: { title: 'Court' } },
    { path: '/court/case/:no', name: 'court-case', component: () => import('./views/court/CourtCase.vue'), meta: { title: 'Court case' } },
    { path: '/court/file', name: 'court-file', component: () => import('./views/court/CourtFile.vue'), meta: { auth: true, onboarded: true, title: 'File a suit' } },
    { path: '/court/claim', name: 'court-claim', component: () => import('./views/court/CourtClaim.vue'), meta: { auth: true, onboarded: true, title: 'Claim a record' } },
    { path: '/court/judge', name: 'court-judge', component: () => import('./views/court/CourtJudge.vue'), meta: { auth: true, onboarded: true, access: true, staff: true, title: 'Court judge' } },
    { path: '/restricted', name: 'restricted', component: () => import('./views/Restricted.vue'), meta: { auth: true, title: 'Account restricted' } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFound.vue'), meta: { title: 'Not found' } }
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior(to, from, saved) {
        if (saved) return saved;
        if (to.hash) return { el: to.hash };
        return { top: 0 };
    }
});

// These guards decide what the UI shows. They are not the security boundary —
// the database's RLS policies and RPC checks are. A determined user who skips
// these screens still can't read or change anything the server doesn't allow.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.beforeEach(async (to) => {
    // Old-style creator links (hub QR codes, Discord posts): underweb.cloud/#profile=<id>
    if (to.path === '/' && to.hash.startsWith('#profile=')) {
        const id = to.hash.slice('#profile='.length);
        if (UUID.test(id)) return { path: `/u/${id}`, replace: true };
    }
    const m = to.meta;
    if (!m.auth) return true;
    await whenAccountReady();
    if (!account.signedIn.value) return { name: 'signin', query: { next: to.fullPath } };
    if (account.isBanned.value && to.name !== 'restricted') return { name: 'restricted' };
    if (m.onboarded && !account.onboarded.value && to.name !== 'welcome') return { name: 'welcome', query: { next: to.fullPath } };
    if (m.access && !account.hasAccess.value) return { name: 'connections', query: { locked: to.name } };
    if (m.leadership && !account.isLeadership.value) return { name: 'home' };
    return true;
});

router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · UnderWeb` : 'UnderWeb — Find your people in VRChat';
});

// After a new deploy, a tab opened earlier still points at the old page files,
// which no longer exist — clicking a link would silently do nothing. When that
// happens, load the page fresh (once) so the click goes through.
const STALE_CHUNK = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;
router.onError((err, to) => {
    if (!STALE_CHUNK.test(String(err?.message || err))) return;
    let last = 0;
    try {
        last = Number(sessionStorage.getItem('uw_chunk_reload') || 0);
        sessionStorage.setItem('uw_chunk_reload', String(Date.now()));
    } catch {
        /* storage blocked — still reload once */
    }
    if (Date.now() - last > 10000) window.location.assign(to?.fullPath || window.location.href);
});
