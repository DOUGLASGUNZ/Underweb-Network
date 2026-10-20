<template>
    <section id="photos" class="card photos" aria-labelledby="ph-h">
        <p class="eyebrow">YOUR SHOWCASE</p>
        <h2 id="ph-h">YOUR PHOTOS &amp; WORK</h2>
        <p class="muted small">
            Post shots and work from UnderWeb nights. Staff approve everything first; then it goes where you ticked — the gallery, the hub's art wall,
            the Discord.
        </p>
        <UploadWork @uploaded="load" />
        <div v-if="loading" class="skeleton" style="height: 180px"></div>
        <div v-else-if="items.length" class="list">
            <article v-for="it in items" :key="it.id" class="item">
                <div class="thumb">
                    <img v-if="isPublic(it)" :src="it.media_url" alt="" loading="lazy" />
                    <span v-else>{{ it.media_type === 'video' ? 'VIDEO' : 'PENDING' }}</span>
                </div>
                <div class="info">
                    <strong>{{ it.title || 'Untitled' }}</strong>
                    <span class="chip" :class="statusClass(it)">{{ statusLabel(it) }}</span>
                    <template v-if="it.moderation_status === 'approved'">
                        <label v-if="it.media_type === 'image'" class="tick">
                            <input type="checkbox" :checked="it.show_in_hub" @change="wall(it, $event.target.checked)" />
                            In the gallery &amp; on the hub wall
                        </label>
                        <span v-if="it.discord_posted_at" class="posted">Posted to Discord ✓</span>
                        <button v-else class="btn btn-sm btn-soft" type="button" :disabled="busy === it.id" @click="share(it)">
                            {{ busy === it.id ? 'Posting…' : 'Post to Discord' }}
                        </button>
                    </template>
                    <span v-else-if="it.moderation_status === 'pending'" class="muted small">
                        {{ it.share_to_discord ? 'Goes to Discord when approved.' : 'Waiting for staff.' }}
                    </span>
                </div>
            </article>
        </div>
        <p class="muted small more">Tip: with UWX running, photos you take in VRChat can be sent here straight from the game.</p>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { account } from '../lib/account';
    import { supabase, SUPABASE_URL, friendlyError } from '../lib/supabase';
    import { toast } from '../lib/toast';
    import { setOnHubWall } from '../lib/hubCard';
    import UploadWork from './UploadWork.vue';

    const items = ref([]);
    const loading = ref(true);
    const busy = ref('');
    const isPublic = (it) => String(it.media_url || '').startsWith(`${SUPABASE_URL}/storage/v1/object/public/`) && it.media_type === 'image';
    const statusLabel = (it) => ({ approved: 'Approved', pending: 'Waiting for review', rejected: 'Not approved' })[it.moderation_status] || it.moderation_status;
    const statusClass = (it) => (it.moderation_status === 'approved' ? 'chip-acid' : it.moderation_status === 'rejected' ? 'chip-danger' : '');

    async function load() {
        const { data } = await supabase
            .from('creator_showcase')
            .select('id,title,media_url,media_type,moderation_status,show_in_hub,share_to_discord,discord_posted_at,created_at')
            .eq('user_id', account.userId.value)
            .order('created_at', { ascending: false })
            .limit(24);
        items.value = data || [];
        loading.value = false;
    }
    onMounted(load);

    async function wall(it, on) {
        try {
            await setOnHubWall(account.userId.value, it.id, on);
            it.show_in_hub = on;
            toast(on ? 'Added to the hub art wall.' : 'Removed from the hub art wall.', 'ok');
        } catch (e) {
            toast(friendlyError(e), 'error');
        }
    }

    async function share(it) {
        busy.value = it.id;
        const { data, error } = await supabase.functions.invoke('share-showcase-discord', { body: { media_id: it.id } });
        busy.value = '';
        if (error) {
            let msg = '';
            try {
                msg = (await error.context?.json())?.error || '';
            } catch {
                /* no body */
            }
            toast(msg || friendlyError(error), 'error');
            return;
        }
        it.discord_posted_at = new Date().toISOString();
        toast(data?.status === 'already_posted' ? 'Already in the Discord.' : 'Posted to the UnderWeb Discord.', 'ok');
    }
</script>

<style scoped>
    .photos .eyebrow {
        margin: 0;
        font-size: 12px;
    }
    .photos h2 {
        font-size: 32px;
        margin: 4px 0 6px;
    }
    .photos > p.small {
        margin: 0 0 16px;
    }
    .list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
        gap: 12px;
    }
    .item {
        display: flex;
        gap: 12px;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--panel-2);
    }
    .thumb {
        flex: none;
        width: 96px;
        height: 96px;
        border-radius: 8px;
        overflow: hidden;
        background: #0b1a10;
        display: grid;
        place-items: center;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--muted);
    }
    .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }
    .info strong {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .tick {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
    }
    .tick input {
        width: 18px;
        height: 18px;
        accent-color: var(--acid);
    }
    .posted {
        color: var(--acid);
        font-size: 14px;
        font-weight: 700;
    }
    .more {
        margin: 14px 0 0;
    }
</style>
