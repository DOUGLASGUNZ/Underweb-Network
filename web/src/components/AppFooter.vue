<template>
    <footer class="ftr">
        <div class="wrap ftr-in">
            <span class="muted small">UnderWeb Network · an 18+ VRChat creator and community network</span>
            <nav class="cluster small" aria-label="Footer">
                <RouterLink v-if="account.signedIn.value" to="/connections">Connected accounts</RouterLink>
                <a :href="LEGACY_SITE" rel="noopener">Help &amp; more tools (current site)</a>
                <a v-if="DISCORD_INVITE" :href="DISCORD_INVITE" rel="noopener">Discord</a>
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
        margin-top: 40px;
    }
    .ftr-in {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        padding-top: 22px;
        padding-bottom: calc(22px + env(safe-area-inset-bottom));
    }
</style>
