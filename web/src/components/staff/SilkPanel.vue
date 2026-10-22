<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Silk</h2>
            <button class="btn btn-sm btn-ghost" type="button" @click="load">Refresh</button>
        </div>
        <p class="muted small" style="margin: 0">
            Members earn Silk automatically (hub visits through UWX, events, streaks, approved photos, verified recruits). Give or take Silk for prizes and fixes here — every
            change stays in the history with your reason.
        </p>
        <div v-if="!hubWorlds.length" class="notice notice-caution">
            No hub world is set, so hub visits don't count yet. In UWX, stand in the hub and use Command → Silk & hub check-ins → Add this world.
        </div>
        <p v-else class="muted small">Counting visits in: {{ hubWorlds.map((w) => w.name).join(', ') }}</p>

        <form class="panel stack" @submit.prevent="grant">
            <h3 class="label">Give or take Silk</h3>
            <div class="cluster">
                <input v-model.trim="username" class="input grow" placeholder="@username" required />
                <input v-model.number="amount" type="number" class="input amt" required placeholder="+100 or -50" />
            </div>
            <input v-model.trim="note" class="input" maxlength="200" required placeholder="Reason (e.g. Opening night costume contest)" />
            <button class="btn btn-primary btn-sm" type="submit" :disabled="busy || !amount">Save</button>
        </form>

        <div>
            <h3 class="label">Recent Silk</h3>
            <p v-if="error" class="error-text">{{ error }}</p>
            <div v-for="(r, i) in recent" :key="i" class="line">
                <span class="grow"><strong>{{ r.display_name || r.username || 'Member' }}</strong> <span class="muted small">{{ r.note || r.reason }}</span></span>
                <span class="muted small">{{ new Date(r.created_at).toLocaleString() }}</span>
                <strong :class="r.amount < 0 ? 'neg' : 'pos'">{{ r.amount > 0 ? '+' : '' }}{{ r.amount }}</strong>
            </div>
            <p v-if="!recent.length && !error" class="muted small">Nothing yet.</p>
        </div>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';

    const recent = ref([]);
    const hubWorlds = ref([]);
    const error = ref('');
    const username = ref('');
    const amount = ref(null);
    const note = ref('');
    const busy = ref(false);

    async function load() {
        const [{ data, error: err }, { data: worlds }] = await Promise.all([
            supabase.rpc('uw_silk_recent', { p_limit: 100 }),
            supabase.from('uw_hub_worlds').select('world_id,name').eq('active', true)
        ]);
        error.value = err ? (/does not exist|schema cache/i.test(err.message) ? 'One database step for Silk is still needed.' : friendlyError(err)) : '';
        recent.value = data || [];
        hubWorlds.value = worlds || [];
    }
    onMounted(load);

    async function grant() {
        busy.value = true;
        const { data, error: err } = await supabase.rpc('uw_silk_grant', { p_username: username.value, p_amount: amount.value, p_note: note.value });
        busy.value = false;
        if (err) return toast(friendlyError(err), 'error');
        toast(`Saved. ${username.value} now has ${data} Silk.`, 'ok');
        username.value = '';
        amount.value = null;
        note.value = '';
        load();
    }
</script>

<style scoped>
    .grow {
        flex: 1 1 200px;
        min-width: 0;
    }
    .amt {
        width: 140px;
    }
    .line {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        align-items: baseline;
        padding: 8px 0;
        border-top: 1px solid var(--line);
    }
    .pos {
        color: var(--acid);
    }
    .neg {
        color: var(--danger, #ff6b6b);
    }
    h3.label {
        margin-bottom: 8px;
    }
</style>
