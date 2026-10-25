<template>
    <section>
        <div class="push">
            <p class="muted small" style="margin: 0">
                Approving starts a hub update right away — new cards show in the world about 5 minutes later (people already there may need to rejoin).
                <template v-if="lastRun"><br />Last update: {{ lastRunText }}</template>
            </p>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="pushing" @click="push(true)">{{ pushing ? 'Starting…' : 'Push to the world now' }}</button>
        </div>
        <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 96px"></div></div>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <div v-else-if="!rows.length" class="notice">Nothing waiting.</div>
        <article v-for="r in rows" :key="r.user_id" class="panel row">
            <img v-if="r.safeImage" :src="r.safeImage" alt="" />
            <div class="txt">
                <div class="cluster">
                    <strong>{{ r.name }}</strong>
                    <span class="chip">{{ r.kind === 'dj' ? 'Resident DJ' : 'Creator Market' }}</span>
                </div>
                <p>{{ r.headline || '—' }}</p>
                <p class="muted small link">{{ r.link_url || 'no link' }}<template v-if="r.extra_link_url"> · {{ r.extra_link_url }}</template></p>
            </div>
            <div class="cluster btns">
                <button class="btn btn-primary btn-sm" type="button" :disabled="busy === r.user_id" @click="review(r, true)">Approve</button>
                <button class="btn btn-danger btn-sm" type="button" :disabled="busy === r.user_id" @click="review(r, false)">Reject</button>
            </div>
        </article>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';
    import { hubPushStatus, loadHubCardQueue, pushHubToWorld, reviewHubCard } from '../../lib/hubCard';

    const emit = defineEmits(['count']);
    const rows = ref([]);
    const loading = ref(true);
    const error = ref('');
    const busy = ref('');

    async function load() {
        loading.value = true;
        try {
            rows.value = await loadHubCardQueue();
            error.value = '';
        } catch (e) {
            error.value = friendlyError(e);
        }
        emit('count', rows.value.length);
        loading.value = false;
    }
    onMounted(() => {
        load();
        refreshStatus();
    });

    const lastRun = ref(null);
    const pushing = ref(false);
    async function refreshStatus() {
        lastRun.value = await hubPushStatus().catch(() => null);
    }
    const lastRunText = computed(() => {
        const r = lastRun.value;
        if (!r) return '';
        if (r.status !== 'completed') return 'running now';
        const mins = Math.round((Date.now() - Date.parse(r.updated_at)) / 60000);
        const ago = mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
        return r.conclusion === 'success' ? `finished ${ago}` : `failed ${ago}`;
    });
    async function push(manual) {
        pushing.value = true;
        try {
            const status = await pushHubToWorld();
            if (manual) toast(status === 'already_queued' ? 'An update is already about to run.' : 'Hub update started — about 5 minutes.', 'ok');
        } catch (e) {
            toast(e.message, 'error');
        }
        pushing.value = false;
        setTimeout(refreshStatus, 4000);
    }

    async function review(r, approve) {
        let note = null;
        if (!approve) {
            note = window.prompt('Why not? (shown to the creator, optional)');
            if (note === null) return;
        }
        busy.value = r.user_id;
        try {
            await reviewHubCard(r.user_id, approve, note);
            toast(approve ? 'Approved — in the hub in about 5 minutes.' : 'Rejected.', 'ok');
            if (approve) void push(false);
            await load();
        } catch (e) {
            toast(friendlyError(e), 'error');
        }
        busy.value = '';
    }
</script>

<style scoped>
    .push {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        align-items: center;
        justify-content: space-between;
    }
    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: center;
        margin-top: 12px;
    }
    .row img {
        width: 96px;
        height: 96px;
        object-fit: cover;
        border-radius: 10px;
        border: 1px solid var(--line);
    }
    .txt {
        flex: 1 1 240px;
        min-width: 0;
    }
    .txt p {
        margin: 4px 0 0;
    }
    .link {
        overflow-wrap: anywhere;
    }
</style>
