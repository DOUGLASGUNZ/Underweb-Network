<template>
    <section class="wrap page">
        <div class="eyebrow">Staff</div>
        <h1 class="page-title">Staff tools</h1>
        <p class="muted intro">Everything here is also checked by the server — if your role can't do something, it won't go through even if a button shows.</p>

        <div class="tabs" role="tablist" aria-label="Staff sections">
            <RouterLink
                v-for="t in tabs"
                :key="t.id"
                :to="{ query: { tab: t.id } }"
                role="tab"
                class="tab"
                :aria-selected="tab === t.id"
                replace>
                {{ t.label }}<span v-if="counts[t.id]" class="count">{{ counts[t.id] }}</span>
            </RouterLink>
        </div>

        <KeepAlive>
            <RoleReviewPanel v-if="tab === 'roles'" @count="(n) => (counts.roles = n)" />
            <VerifyPanel v-else-if="tab === 'verify'" @count="(n) => (counts.verify = n)" />
            <EventPanel v-else-if="tab === 'events'" @count="(n) => (counts.events = n)" />
            <AvailabilityPanel v-else-if="tab === 'availability'" />
        </KeepAlive>

        <p class="muted small more">
            Moderation, partners, tickets and announcements are still on the <a :href="LEGACY_SITE" rel="noopener">current site ↗</a>.
        </p>
    </section>
</template>

<script setup>
    import { computed, reactive } from 'vue';
    import { useRoute } from 'vue-router';
    import RoleReviewPanel from '../../components/staff/RoleReviewPanel.vue';
    import VerifyPanel from '../../components/staff/VerifyPanel.vue';
    import EventPanel from '../../components/staff/EventPanel.vue';
    import AvailabilityPanel from '../../components/staff/AvailabilityPanel.vue';
    import { LEGACY_SITE } from '../../lib/config';

    const route = useRoute();
    const tabs = [
        { id: 'roles', label: 'Role applications' },
        { id: 'verify', label: 'VRChat checks' },
        { id: 'events', label: 'Events' },
        { id: 'availability', label: 'Availability' }
    ];
    const tab = computed(() => (tabs.some((t) => t.id === route.query.tab) ? route.query.tab : 'roles'));
    const counts = reactive({ roles: 0, verify: 0, events: 0 });
</script>

<style scoped>
    .intro {
        max-width: 680px;
    }
    .tabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        border-bottom: 1px solid var(--line);
        margin: 18px 0 20px;
    }
    .tab {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 14px;
        border-bottom: 2px solid transparent;
        color: var(--muted);
        font-family: var(--font-ui);
        font-weight: 700;
        white-space: nowrap;
    }
    .tab[aria-selected='true'] {
        color: var(--acid);
        border-bottom-color: var(--acid);
    }
    .count {
        background: var(--acid);
        color: var(--acid-ink);
        border-radius: 10px;
        font-size: 11px;
        padding: 0 7px;
        font-family: var(--font-mono);
    }
    .more {
        margin-top: 28px;
    }
    :deep(h2) {
        font-size: 20px;
    }
</style>
