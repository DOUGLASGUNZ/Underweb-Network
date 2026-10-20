<template>
    <section aria-labelledby="vq-h">
        <div class="panel-head">
            <h2 id="vq-h">VRChat verification</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
        </div>
        <p class="muted small how">
            Open their VRChat profile and check the code is in their bio. Only approve if the code matches exactly — this is what proves they own the
            account.
        </p>
        <div v-if="loading" class="stack"><div v-for="i in 2" :key="i" class="skeleton" style="height: 100px"></div></div>
        <p v-else-if="error" class="error-text" role="alert">{{ error }}</p>
        <div v-else-if="!queue.length" class="notice">Nobody is waiting for verification.</div>
        <div v-else class="stack">
            <article v-for="c in queue" :key="c.id" class="panel claim">
                <div>
                    <strong>{{ nameOf(names, c.user_id) }}</strong>
                    <div class="muted small">claims {{ c.display_name || c.external_id }} · {{ relativeTime(c.verification_requested_at) }}</div>
                </div>
                <div class="code-row">
                    <span class="label">Code</span>
                    <code class="vcode">{{ c.verification_code }}</code>
                </div>
                <div class="cluster">
                    <a :href="c.profile_url" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Open VRChat profile ↗</a>
                    <button class="btn btn-sm btn-primary" type="button" :disabled="busy === c.id" @click="decide(c, true)">Code matches — verify</button>
                    <button class="btn btn-sm btn-danger" type="button" :disabled="busy === c.id" @click="decide(c, false)">Not found — deny</button>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { nameOf, resolveNames } from '../../lib/staff';
    import { relativeTime } from '../../lib/format';
    import { toast } from '../../lib/toast';

    const emit = defineEmits(['count']);
    const queue = ref([]);
    const names = ref({});
    const loading = ref(true);
    const error = ref('');
    const busy = ref('');

    async function load() {
        loading.value = true;
        error.value = '';
        const { data, error: err } = await supabase.rpc('uw_vrchat_verification_queue');
        if (err) {
            error.value = /permission/i.test(err.message) ? 'Verification reviews need Staff rank or above.' : friendlyError(err);
            loading.value = false;
            return;
        }
        queue.value = data || [];
        emit('count', queue.value.length);
        names.value = await resolveNames(queue.value.map((c) => c.user_id));
        loading.value = false;
    }

    async function decide(c, approve) {
        if (!approve && !window.confirm('Deny this claim? They can fix their bio and submit again.')) return;
        busy.value = c.id;
        const { error: err } = await supabase.rpc('uw_review_vrchat_connection', { p_connection_id: c.id, p_approve: approve });
        busy.value = '';
        if (err) {
            toast(friendlyError(err), 'error');
            return;
        }
        toast(approve ? `${nameOf(names.value, c.user_id)} is verified.` : 'Claim denied.', 'ok');
        queue.value = queue.value.filter((x) => x.id !== c.id);
        emit('count', queue.value.length);
    }

    onMounted(load);
</script>

<style scoped>
    .how {
        margin: -6px 0 14px;
        max-width: 640px;
    }
    .claim {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .code-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .vcode {
        font-family: var(--font-mono);
        font-size: 18px;
        color: var(--acid);
        letter-spacing: 0.08em;
    }
</style>
