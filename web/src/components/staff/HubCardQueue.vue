<template>
    <section>
        <p class="muted small">Hub cards waiting for review. Approved cards go into the hub world at the next update (within the hour).</p>
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
    import { onMounted, ref } from 'vue';
    import { friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';
    import { loadHubCardQueue, reviewHubCard } from '../../lib/hubCard';

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
    onMounted(load);

    async function review(r, approve) {
        let note = null;
        if (!approve) {
            note = window.prompt('Why not? (shown to the creator, optional)');
            if (note === null) return;
        }
        busy.value = r.user_id;
        try {
            await reviewHubCard(r.user_id, approve, note);
            toast(approve ? 'Approved — it goes into the hub at the next update.' : 'Rejected.', 'ok');
            await load();
        } catch (e) {
            toast(friendlyError(e), 'error');
        }
        busy.value = '';
    }
</script>

<style scoped>
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
