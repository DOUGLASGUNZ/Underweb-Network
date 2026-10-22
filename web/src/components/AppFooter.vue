<template>
    <footer class="ftr">
        <div class="wrap ftr-in">
            <span>The UnderWeb · an 18+ VRChat community</span>
            <nav class="links" aria-label="Footer">
                <a v-if="DISCORD_INVITE" :href="DISCORD_INVITE" rel="noopener">Discord</a>
                <RouterLink to="/start">Help</RouterLink>
                <RouterLink to="/partners">Partner groups</RouterLink>
                <RouterLink v-if="account.signedIn.value" to="/connections">Connected accounts</RouterLink>
                <a :href="LEGACY_SITE" rel="noopener" class="quiet">Classic site ↗</a>
            </nav>
        </div>
    </footer>
</template>

<script setup>
    import { account } from '../lib/account';
    import { DISCORD_INVITE, LEGACY_SITE } from '../lib/config';
</script>

<style scoped>
    .ftr {
        border-top: 1px solid var(--line);
        font-size: 14px;
        color: var(--muted);
    }
    .ftr-in {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 16px;
        padding-top: 28px;
        padding-bottom: calc(28px + env(safe-area-inset-bottom));
    }
    .links {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
    }
    .quiet {
        color: var(--muted);
    }
</style>
