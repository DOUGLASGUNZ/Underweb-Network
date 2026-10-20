<template>
    <header class="hdr">
        <div class="wrap hdr-in">
            <RouterLink to="/" class="brand" aria-label="UnderWeb home">
                <span class="mark" aria-hidden="true">U</span>
                <span class="word">UNDERWEB</span>
            </RouterLink>

            <nav class="nav" aria-label="Main">
                <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">{{ item.label }}</RouterLink>
            </nav>

            <div class="hdr-actions">
                <template v-if="account.signedIn.value">
                    <RouterLink v-if="account.isStaff.value" to="/staff" class="nav-link staff-link">Staff</RouterLink>
                    <RouterLink v-if="account.onboarded.value" to="/me" class="me" :aria-label="'My UnderWeb, ' + account.displayName.value">
                        <Avatar :src="account.state.profile?.avatar_url" :name="account.displayName.value" :size="32" />
                        <span class="me-name">{{ account.displayName.value }}</span>
                    </RouterLink>
                    <RouterLink v-else to="/welcome" class="btn btn-sm btn-primary">Finish setup</RouterLink>
                </template>
                <template v-else>
                    <RouterLink to="/signin" class="nav-link signin-link">Sign in</RouterLink>
                    <RouterLink to="/signin?new=1" class="btn btn-sm btn-primary">Create account</RouterLink>
                </template>
                <button class="menu-btn" type="button" :aria-expanded="open" aria-controls="mobile-menu" aria-label="Menu" @click="open = !open">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path v-if="!open" d="M4 7h16M4 12h16M4 17h16" />
                        <path v-else d="M6 6l12 12M18 6L6 18" />
                    </svg>
                </button>
            </div>
        </div>

        <div v-if="open" id="mobile-menu" class="drawer">
            <nav class="wrap drawer-in" aria-label="Main (mobile)">
                <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="drawer-link">{{ item.label }}</RouterLink>
                <template v-if="account.signedIn.value">
                    <RouterLink to="/me" class="drawer-link">My UnderWeb</RouterLink>
                    <RouterLink to="/me/edit" class="drawer-link">Edit profile</RouterLink>
                    <RouterLink to="/connections" class="drawer-link">Connected accounts</RouterLink>
                    <RouterLink v-if="account.isStaff.value" to="/staff" class="drawer-link">Staff</RouterLink>
                    <button type="button" class="drawer-link signout" @click="doSignOut">Sign out of this device</button>
                </template>
                <RouterLink v-else to="/signin" class="drawer-link">Sign in</RouterLink>
            </nav>
        </div>
    </header>
</template>

<script setup>
    import { ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import Avatar from './Avatar.vue';
    import { account, signOut } from '../lib/account';
    import { toast } from '../lib/toast';

    const open = ref(false);
    const route = useRoute();
    const router = useRouter();
    watch(() => route.fullPath, () => (open.value = false));

    // Four places, same for everyone. Everything else lives under your name (My UnderWeb).
    const navItems = [
        { to: '/events', label: 'Events' },
        { to: '/gallery', label: 'Gallery' },
        { to: '/creators', label: 'Creators' },
        { to: '/start', label: 'Start here' }
    ];

    async function doSignOut() {
        await signOut();
        toast('Signed out on this device.', 'ok');
        router.push('/');
    }
</script>

<style scoped>
    .hdr {
        position: sticky;
        top: 0;
        z-index: 50;
        background: rgba(3, 8, 5, 0.94);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
    }
    .hdr-in {
        height: var(--header-h);
        display: flex;
        align-items: center;
        gap: 20px;
    }
    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
    }
    .mark {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border: 2px solid var(--acid);
        border-radius: 8px;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--acid);
    }
    .word {
        font-family: var(--font-display);
        font-size: 22px;
        letter-spacing: 0.06em;
    }
    .nav {
        display: none;
        gap: 2px;
        flex: 1;
        justify-content: center;
    }
    .nav-link {
        padding: 10px 14px;
        border-radius: var(--radius-sm);
        color: #c9dccf;
        font-weight: 600;
        font-size: 15px;
    }
    .nav-link:hover {
        color: var(--text);
    }
    .nav-link.router-link-active {
        color: var(--acid);
    }
    .staff-link,
    .signin-link {
        display: none;
    }
    .hdr-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .me {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
        padding: 4px 12px 4px 4px;
        border: 1px solid var(--line);
        border-radius: 999px;
        min-height: 42px;
    }
    .me-name {
        display: none;
        font-weight: 700;
        font-size: 14px;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .menu-btn {
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        cursor: pointer;
    }
    .drawer {
        border-top: 1px solid var(--line);
        background: var(--void);
    }
    .drawer-in {
        display: flex;
        flex-direction: column;
        padding-top: 8px;
        padding-bottom: 16px;
    }
    .drawer-link {
        display: block;
        padding: 14px 4px;
        border: 0;
        border-bottom: 1px solid var(--line);
        color: var(--text);
        font: 600 17px var(--font-ui);
        background: none;
        text-align: left;
        cursor: pointer;
    }
    .drawer-link.router-link-active {
        color: var(--acid);
    }
    .signout {
        color: #ff8a93;
    }
    @media (min-width: 940px) {
        .nav,
        .staff-link,
        .signin-link {
            display: flex;
        }
        .menu-btn,
        .drawer {
            display: none;
        }
        .me-name {
            display: inline;
        }
    }
</style>
