<template>
    <section>
        <p class="muted small">Photos and work waiting for approval. Previews are private links that expire in 10 minutes. Approving publishes it to the showcase (and the Discord, if the poster asked).</p>
        <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 140px"></div></div>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <div v-else-if="!rows.length" class="notice">Nothing waiting.</div>
        <article v-for="r in rows" :key="r.id" class="panel row">
            <div class="media">
                <video v-if="r.preview && r.media_type === 'video'" :src="r.preview" controls playsinline></video>
                <img v-else-if="r.preview" :src="r.preview" alt="" />
                <span v-else class="muted small">Preview unavailable</span>
            </div>
            <div class="txt">
                <div class="cluster">
                    <strong>{{ r.title || 'Untitled' }}</strong>
                    <span v-if="r.share_to_discord" class="chip chip-acid">Wants Discord</span>
                </div>
                <p class="muted small">by {{ nameOf(names, r.user_id) }} · {{ formatDateTime(r.created_at) }}</p>
                <p v-if="r.caption">{{ r.caption }}</p>
            </div>
            <div class="cluster btns">
                <button class="btn btn-primary btn-sm" type="button" :disabled="busy === r.id" @click="approve(r)">Approve</button>
                <button class="btn btn-danger btn-sm" type="button" :disabled="busy === r.id" @click="deny(r)">Deny</button>
            </div>
        </article>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';
    import { formatDateTime } from '../../lib/format';
    import { nameOf, resolveNames } from '../../lib/staff';

    const emit = defineEmits(['count']);
    const rows = ref([]);
    const names = ref({});
    const loading = ref(true);
    const error = ref('');
    const busy = ref('');

    async function load() {
        loading.value = true;
        error.value = '';
        const { data, error: err } = await supabase.rpc('uw_showcase_review_queue');
        if (err) {
            error.value = /authority|permission|not allowed/i.test(err.message) ? 'Media review needs reviewer authority.' : friendlyError(err);
            rows.value = [];
        } else {
            const list = data || [];
            const signed = await Promise.all(
                list.map((x) =>
                    x.storage_path
                        ? supabase.storage.from('creator-showcase-pending').createSignedUrl(x.storage_path, 600).then((r) => r.data?.signedUrl || '')
                        : ''
                )
            );
            rows.value = list.map((x, i) => ({ ...x, preview: signed[i] }));
            names.value = await resolveNames(list.map((x) => x.user_id));
        }
        emit('count', rows.value.length);
        loading.value = false;
    }
    onMounted(load);

    async function approve(r) {
        if (!window.confirm('Approve this and publish it to the showcase?')) return;
        busy.value = r.id;
        const { data, error: err } = await supabase.functions.invoke('approve-showcase-media', { body: { media_id: r.id } });
        busy.value = '';
        if (err || !data?.ok) {
            let msg = data?.error || '';
            try {
                msg = msg || (await err?.context?.json())?.error || '';
            } catch {
                /* no body */
            }
            toast(msg || 'Approval failed.', 'error');
            return;
        }
        toast(data?.discord === 'posted' ? 'Approved and posted to Discord.' : 'Approved and published.', 'ok');
        load();
    }

    async function deny(r) {
        const reason = window.prompt('Why not? (optional, shown to the poster)');
        if (reason === null) return;
        busy.value = r.id;
        const { error: err } = await supabase.rpc('uw_review_showcase_media', { p_media_id: r.id, p_approve: false, p_reason: reason });
        busy.value = '';
        if (err) return toast(friendlyError(err), 'error');
        toast('Denied. It stays private.', 'ok');
        load();
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
    .media {
        width: 200px;
        max-width: 100%;
        aspect-ratio: 16 / 10;
        border-radius: 10px;
        overflow: hidden;
        background: #0b1a10;
        display: grid;
        place-items: center;
    }
    .media img,
    .media video {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .txt {
        flex: 1 1 240px;
        min-width: 0;
    }
    .txt p {
        margin: 4px 0 0;
    }
</style>
