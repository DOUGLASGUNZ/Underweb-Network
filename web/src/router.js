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
    { path: '/creators', name: 'creators', component: () => import('./views/Creators.vue'), meta: { title: 'Creators' } },
    { path: '/discover', redirect: '/creators' },
    { path: '/u/:username', name: 'profile', component: () => import('./views/Profile.vue'), meta: { auth: true, onboarded: true, title: 'Profile' } },
    { path: '/me', name: 'me', redirect: () => (account.state.profile?.username ? `/u/${account.state.profile.username}` : '/welcome') },
    { path: '/me/edit', name: 'profile-edit', component: () => import('./views/ProfileEdit.vue'), meta: { auth: true, onboarded: true, title: 'Edit profile' } },
    { path: '/connections', name: 'connections', component: () => import('./views/Connections.vue'), meta: { auth: true, onboarded: true, title: 'Connected accounts' } },
    { path: '/roles', name: 'roles', component: () => import('./views/Roles.vue'), meta: { auth: true, onboarded: true, access: true, title: 'Roles' } },
    { path: '/staff', name: 'staff', component: () => import('./views/staff/StaffHub.vue'), meta: { auth: true, onboarded: true, access: true, staff: true, title: 'Staff tools' } },
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
router.beforeEach(async (to) => {
    const m = to.meta;
    if (!m.auth) return true;
    await whenAccountReady();
    if (!account.signedIn.value) return { name: 'signin', query: { next: to.fullPath } };
    if (account.isBanned.value && to.name !== 'restricted') return { name: 'restricted' };
    if (m.onboarded && !account.onboarded.value && to.name !== 'welcome') return { name: 'welcome', query: { next: to.fullPath } };
    if (m.access && !account.hasAccess.value) return { name: 'connections', query: { locked: to.name } };
    return true;
});

router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · UnderWeb` : 'UnderWeb — Find your people in VRChat';
});
