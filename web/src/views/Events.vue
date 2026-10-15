<template>
    <section class="wrap page">
        <div class="eyebrow">What's on</div>
        <h1 class="page-title">Events</h1>
        <p class="muted small">Times are shown in your time zone ({{ zone }}).</p>

        <div class="tabs" role="tablist" aria-label="Event timeframe">
            <button v-for="t in tabs" :key="t.id" role="tab" type="button" class="tab" :aria-selected="tab === t.id" @click="tab = t.id">{{ t.label }}</button>
        </div>

        <div v-if="loading" class="stack"><div v-for="i in 4" :key="i" class="skeleton" style="height: 96px"></div></div>
        <p v-else-if="error" class="error-text" role="alert">{{ error }}</p>
        <div v-else-if="!list.length" class="notice">{{ tab === 'upcoming' ? 'No upcoming events yet.' : 'No past events.' }}</div>
        <div v-else class="list">
            <article v-for="ev in list" :key="ev.id" class="panel event">
                <img v-if="ev.cover_url" :src="ev.cover_url" alt="" class="cover" loading="lazy" />
                <div class="event-main">
                    <EventRow :event="ev" />
                    <p v-if="ev.description" class="desc">{{ ev.description }}</p>
                    <span class="label">{{ scopeLabel(ev.group_scope) }}</span>
                </div>
            </article>
        </div>

        <p class="muted small more">
            Hosting? Event proposals and Event Control are still on the <a :href="LEGACY_SITE" rel="noopener">current site ↗</a> while they move over.
        </p>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import EventRow from '../components/EventRow.vue';
    import { supabase, friendlyError } from '../lib/supabase';
    import { localTimeZone } from '../lib/format';
    import { LEGACY_SITE } from '../lib/config';

    const tabs = [
        { id: 'upcoming', label: 'Upcoming' },
        { id: 'past', label: 'Past' }
    ];
    const tab = ref('upcoming');
    const events = ref({ upcoming: null, past: null });
    const loading = ref(false);
    const error = ref('');
    const zone = localTimeZone();
    const list = computed(() => events.value[tab.value] || []);
    const scopeLabel = (s) => (s === 'underweb' || !s ? 'UnderWeb' : String(s).replace(/_/g, ' '));

    async function load(which) {
        if (events.value[which]) return;
        loading.value = true;
        error.value = '';
        const cutoff = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
        let query = supabase.from('network_events').select('id,title,description,starts_at,ends_at,location,group_scope,status,cover_url');
        query =
            which === 'upcoming'
                ? query.eq('status', 'published').gte('starts_at', cutoff).order('starts_at').limit(50)
                : query.in('status', ['published', 'archived']).lt('starts_at', cutoff).order('starts_at', { ascending: false }).limit(30);
        const { data, error: err } = await query;
        loading.value = false;
        if (err) {
            error.value = friendlyError(err);
            return;
        }
        events.value = { ...events.value, [which]: data || [] };
    }

    watch(tab, load, { immediate: true });
</script>

<style scoped>
    .tabs {
        display: flex;
        gap: 4px;
        margin: 16px 0;
        border-bottom: 1px solid var(--line);
    }
    .tab {
        min-height: 44px;
        padding: 0 16px;
        background: none;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--muted);
        font-family: var(--font-display);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
    }
    .tab[aria-selected='true'] {
        color: var(--acid);
        border-bottom-color: var(--acid);
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .event {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        padding: 0;
        overflow: hidden;
    }
    .cover {
        width: 100%;
        max-width: 240px;
        aspect-ratio: 16 / 10;
        object-fit: cover;
        flex: 1 1 200px;
    }
    .event-main {
        flex: 999 1 320px;
        padding: 4px 18px 16px;
        min-width: 0;
    }
    .event-main :deep(.row-line) {
        border-top: 0;
    }
    .desc {
        color: var(--text-2);
        white-space: pre-line;
        margin: 0 0 8px;
    }
    .more {
        margin-top: 24px;
    }
</style>
