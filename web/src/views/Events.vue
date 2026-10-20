<template>
    <section class="wrap page">
        <p class="eyebrow">WHAT'S ON</p>
        <h1 class="page-title">EVENTS</h1>
        <p class="lead">Music video nights, cinema and hangouts in the UnderWeb hub. Times are in your time zone ({{ zone }}).</p>

        <div v-if="!member" class="notice notice-acid lock">
            <div>
                <strong>{{ account.signedIn.value ? 'Verify your VRChat to see the full calendar.' : 'Members see the full calendar.' }}</strong>
                <p class="muted small" style="margin: 2px 0 0">Public nights are listed below. Members also get member-only nights and reminders.</p>
            </div>
            <RouterLink :to="account.signedIn.value ? '/start' : '/signin?new=1&next=/events'" class="btn btn-primary btn-sm">{{ account.signedIn.value ? 'Finish setup' : 'Create account' }}</RouterLink>
        </div>

        <div class="tabs" role="tablist" aria-label="Event timeframe">
            <button v-for="t in tabs" :key="t.id" role="tab" type="button" class="tab" :aria-selected="tab === t.id" @click="tab = t.id">{{ t.label }}</button>
        </div>

        <div v-if="loading" class="stack"><div v-for="i in 4" :key="i" class="skeleton" style="height: 96px"></div></div>
        <p v-else-if="error" class="error-text" role="alert">{{ error }}</p>
        <div v-else-if="!list.length" class="notice">
            {{ tab === 'upcoming' ? "Nothing's been posted yet — new nights show up here and in the Discord first." : 'No past events yet.' }}
        </div>
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

        <p v-if="account.isStaff.value" class="muted small more">
            Hosting? Propose events in <RouterLink to="/staff">Staff</RouterLink>; Event Control is on the <a :href="LEGACY_SITE" rel="noopener">classic site ↗</a>.
        </p>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import EventRow from '../components/EventRow.vue';
    import { supabase, friendlyError } from '../lib/supabase';
    import { localTimeZone } from '../lib/format';
    import { LEGACY_SITE } from '../lib/config';
    import { account } from '../lib/account';

    const member = computed(() => account.signedIn.value && account.hasAccess.value);

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
        if (!member.value) {
            // Public calendar: anything staff published (not drafts) is visible signed out.
            let pub = supabase.from('events').select('id,title,description,starts_at,ends_at,vrchat_world_name,artwork_url,group_scope,status').neq('status', 'cancelled');
            pub = which === 'upcoming' ? pub.gte('starts_at', cutoff).order('starts_at').limit(50) : pub.lt('starts_at', cutoff).order('starts_at', { ascending: false }).limit(30);
            const { data, error: err } = await pub;
            loading.value = false;
            if (err) {
                error.value = friendlyError(err);
                return;
            }
            events.value = { ...events.value, [which]: (data || []).map((e) => ({ ...e, location: e.vrchat_world_name, cover_url: e.artwork_url })) };
            return;
        }
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
    watch(member, () => {
        events.value = { upcoming: null, past: null };
        load(tab.value);
    });
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
        font: 700 15px var(--font-ui);
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
    .lock {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 20px;
    }
    .more {
        margin-top: 24px;
    }
</style>
