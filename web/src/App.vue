<template>
    <a class="skip" href="#main">Skip to content</a>
    <AppHeader />
    <div v-if="account.isTimedOut.value" class="wrap" role="status">
        <div class="notice notice-caution timeout">
            <strong>You're in a timeout</strong>
            <span>
                {{ restriction?.reason ? `Reason: ${restriction.reason}. ` : '' }}You can look around, but posting and editing are paused
                <template v-if="restriction?.expires_at"> until {{ formatDateTime(restriction.expires_at) }}</template>.
            </span>
        </div>
    </div>
    <main id="main" tabindex="-1">
        <RouterView />
    </main>
    <AppFooter />
    <div class="toasts" aria-live="polite">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.message }}</div>
    </div>
</template>

<script setup>
    import { computed } from 'vue';
    import AppHeader from './components/AppHeader.vue';
    import AppFooter from './components/AppFooter.vue';
    import { account } from './lib/account';
    import { toasts } from './lib/toast';
    import { formatDateTime } from './lib/format';

    const restriction = computed(() => account.state.restriction);
</script>

<style>
    .skip {
        position: absolute;
        left: -9999px;
        top: 8px;
        z-index: 100;
        background: var(--acid);
        color: var(--acid-ink);
        padding: 8px 12px;
        border-radius: 4px;
    }
    .skip:focus {
        left: 8px;
    }
    main {
        min-height: calc(100vh - var(--header-h) - 120px);
    }
    main:focus {
        outline: none;
    }
    .timeout {
        margin-top: 16px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .toasts {
        position: fixed;
        bottom: max(16px, env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 80;
        width: min(92vw, 420px);
    }
    .toast {
        background: var(--panel-2);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        padding: 12px 14px;
        font-size: 14px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
    }
    .toast.ok {
        border-color: var(--acid);
    }
    .toast.error {
        border-color: var(--danger);
    }
</style>
