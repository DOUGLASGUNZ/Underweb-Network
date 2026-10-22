<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Partner groups</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
        </div>
        <p class="muted small" style="margin: 0">
            Other VRChat groups asking to join the UWX Moderation Network (they apply at underweb.cloud/partners). Approving registers their group with its applicant
            as owner. UnderWeb staff roles get <strong>no</strong> access to a partner's cases — each group controls its own data and who it shares with.
        </p>
        <div v-if="loading" class="skeleton" style="height: 120px"></div>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <div v-else-if="!apps.length" class="notice">No applications yet.</div>
        <article v-for="a in apps" :key="a.id" class="panel app">
            <div class="grow">
                <strong>{{ a.group_name }}</strong>
                <a :href="`https://vrchat.com/home/group/${a.vrchat_group_id}`" target="_blank" rel="noopener" class="small"> VRChat group ↗</a>
                <p class="muted small">
                    {{ a.member_count ? `${a.member_count} members · ` : '' }}applied {{ when(a.created_at) }}<template v-if="a.applicant_role"> · applicant is {{ a.applicant_role }}</template>
                </p>
                <p v-if="a.reason" class="small">“{{ a.reason }}”</p>
                <p v-if="a.status !== 'pending'" class="small">
                    <span class="chip" :class="a.status === 'approved' ? 'chip-acid' : 'chip-danger'">{{ a.status }}</span> {{ a.review_note || '' }}
                </p>
            </div>
            <div v-if="a.status === 'pending'" class="cluster">
                <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="review(a, true)">Approve</button>
                <button class="btn btn-sm btn-ghost" type="button" :disabled="busy" @click="review(a, false)">Decline</button>
            </div>
        </article>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';
    import { when } from '../../lib/uwx';

    const emit = defineEmits(['count']);
    const apps = ref([]);
    const loading = ref(true);
    const error = ref('');
    const busy = ref(false);

    async function load() {
        loading.value = true;
        const { data, error: err } = await supabase.from('uwx_group_applications').select('*').order('created_at', { ascending: false }).limit(200);
        loading.value = false;
        error.value = err ? (/does not exist|schema cache/i.test(err.message) ? 'One database step for this is still needed.' : friendlyError(err)) : '';
        apps.value = data || [];
        emit('count', apps.value.filter((a) => a.status === 'pending').length);
    }
    onMounted(load);

    async function review(a, approve) {
        const note = window.prompt(approve ? `Approve ${a.group_name}? Optional note to them:` : `Decline ${a.group_name}? Reason (optional):`, '');
        if (note === null) return;
        busy.value = true;
        const { error: err } = await supabase.rpc('uwx_review_group_application', { p_id: a.id, p_approve: approve, p_note: note || null });
        busy.value = false;
        if (err) return toast(friendlyError(err), 'error');
        toast(approve ? `${a.group_name} is registered. Its owner sets up access in UWX → Group Intel.` : 'Declined.', 'ok');
        load();
    }
</script>

<style scoped>
    .app {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-start;
    }
    .app p {
        margin: 4px 0 0;
    }
    .grow {
        flex: 1 1 240px;
        min-width: 0;
    }
</style>
