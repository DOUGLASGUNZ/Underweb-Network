<template>
    <header class="hdr">
        <div class="wrap hdr-in">
            <RouterLink to="/" class="brand" aria-label="UnderWeb home">
                <img src="/media/wordmark.webp" alt="UnderWeb Network" width="90" height="46" />
            </RouterLink>

            <nav class="nav" aria-label="Main">
                <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">{{ item.label }}</RouterLink>
                <a :href="LEGACY_SITE" class="nav-link legacy" rel="noopener">More<span class="sr-only"> (opens the current site)</span> ↗</a>
            </nav>

            <div class="hdr-actions">
                <template v-if="account.signedIn.value">
                    <RouterLink v-if="account.onboarded.value" to="/me" class="me" :aria-label="'Your profile, ' + account.displayName.value">
                        <Avatar :src="account.state.profile?.avatar_url" :name="account.displayName.value" :size="32" />
                        <span class="me-name">{{ account.displayName.value }}</span>
                    </RouterLink>
                    <RouterLink v-else to="/welcome" class="btn btn-sm btn-primary">Finish setup</RouterLink>
                </template>
                <RouterLink v-else to="/signin" class="btn btn-sm btn-primary">Sign in</RouterLink>
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
                    <RouterLink to="/me" class="drawer-link">My profile</RouterLink>
                    <RouterLink to="/me/edit" class="drawer-link">Edit profile</RouterLink>
                    <RouterLink to="/roles" class="drawer-link">Roles & applications</RouterLink>
                    <RouterLink to="/connections" class="drawer-link">Connected accounts</RouterLink>
                </template>
                <a :href="LEGACY_SITE" class="drawer-link" rel="noopener">More tools on the current site ↗</a>
                <button v-if="account.signedIn.value" type="button" class="drawer-link signout" @click="doSignOut">Sign out of this device</button>
            </nav>
        </div>
    </header>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import Avatar from './Avatar.vue';
    import { account, signOut } from '../lib/account';
    import { LEGACY_SITE } from '../lib/config';
    import { toast } from '../lib/toast';

    const open = ref(false);
    const route = useRoute();
    const router = useRouter();
    watch(() => route.fullPath, () => (open.value = false));

    const navItems = computed(() => {
        const items = [{ to: '/', label: 'Home' }];
        if (account.signedIn.value) {
            items.push({ to: '/discover', label: 'Discover' }, { to: '/events', label: 'Events' });
            if (account.isStaff.value) items.push({ to: '/staff', label: 'Staff' });
        }
        return items;
    });

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
        background: rgba(4, 7, 5, 0.92);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
    }
    .hdr-in {
        height: var(--header-h);
        display: flex;
        align-items: center;
        gap: 20px;
    }
    .brand img {
        display: block;
        height: 46px;
        width: auto;
    }
    .nav {
        display: none;
        gap: 2px;
        flex: 1;
    }
    .nav-link {
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        color: var(--text-2);
        font-family: var(--font-display);
        font-weight: 600;
        font-size: 13px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }
    .nav-link:hover {
        color: var(--text);
    }
    .nav-link.router-link-exact-active {
        color: var(--acid);
        background: var(--panel-2);
    }
    .nav-link.legacy {
        color: var(--muted);
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
        padding: 4px 10px 4px 4px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        min-height: 44px;
    }
    .me-name {
        display: none;
        font-family: var(--font-display);
        font-weight: 600;
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
        border-bottom: 1px solid var(--line);
        color: var(--text);
        font-family: var(--font-display);
        font-weight: 600;
        font-size: 16px;
        background: none;
        border-left: 0;
        border-right: 0;
        border-top: 0;
        text-align: left;
        cursor: pointer;
    }
    .drawer-link.router-link-exact-active {
        color: var(--acid);
    }
    .signout {
        color: #ff8a93;
    }
    @media (min-width: 900px) {
        .nav {
            display: flex;
        }
        .menu-btn {
            display: none;
        }
        .drawer {
            display: none;
        }
        .me-name {
            display: inline;
        }
    }
</style>
