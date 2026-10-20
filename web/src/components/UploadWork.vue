<template>
    <form class="up" @submit.prevent="submit">
        <label class="drop" :class="{ has: file }">
            <input ref="input" type="file" accept="image/*,video/*" class="sr-only" @change="pick" />
            <img v-if="preview" :src="preview" alt="" />
            <span v-else-if="file">{{ file.name }}</span>
            <span v-else><strong>Choose a photo or video</strong><br /><small>Images up to 12 MB · videos up to 100 MB</small></span>
        </label>
        <div class="fields">
            <label class="field">
                <span>Title</span>
                <input v-model.trim="title" class="input" maxlength="120" placeholder="What is it?" />
            </label>
            <label class="field">
                <span>Caption <small class="muted">(optional)</small></span>
                <input v-model.trim="caption" class="input" maxlength="500" placeholder="Where, who, which night…" />
            </label>
            <label class="check">
                <input v-model="toDiscord" type="checkbox" />
                Post it to the UnderWeb Discord once it's approved
            </label>
            <label v-if="!isVideo" class="check">
                <input v-model="toWall" type="checkbox" />
                Show it in the public gallery and on the hub's art wall
            </label>
            <p v-if="error" class="error-text" role="alert">{{ error }}</p>
            <button class="btn btn-primary" type="submit" :disabled="!file || busy">{{ busy ? 'Uploading…' : 'Send for review' }}</button>
            <p class="hint">Staff check everything before it goes anywhere.</p>
        </div>
    </form>
</template>

<script setup>
    import { computed, onBeforeUnmount, ref } from 'vue';
    import { account } from '../lib/account';
    import { supabase, friendlyError } from '../lib/supabase';
    import { toast } from '../lib/toast';

    const emit = defineEmits(['uploaded']);
    const input = ref(null);
    const file = ref(null);
    const preview = ref('');
    const title = ref('');
    const caption = ref('');
    const toDiscord = ref(true);
    const toWall = ref(true);
    const busy = ref(false);
    const error = ref('');
    const isVideo = computed(() => Boolean(file.value?.type?.startsWith('video/')));

    function clearPreview() {
        if (preview.value) URL.revokeObjectURL(preview.value);
        preview.value = '';
    }
    onBeforeUnmount(clearPreview);

    function pick(e) {
        error.value = '';
        const f = e.target.files?.[0] || null;
        clearPreview();
        file.value = null;
        if (!f) return;
        const video = f.type.startsWith('video/');
        if (!f.type.startsWith('image/') && !video) return (error.value = 'Choose an image or a video.');
        if (f.size > (video ? 100 : 12) * 1024 * 1024) return (error.value = video ? 'Videos must be 100 MB or smaller.' : 'Images must be 12 MB or smaller.');
        file.value = f;
        if (!video) preview.value = URL.createObjectURL(f);
        if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').slice(0, 120);
    }

    async function submit() {
        if (!file.value || busy.value) return;
        busy.value = true;
        error.value = '';
        const uid = account.userId.value;
        const f = file.value;
        const video = isVideo.value;
        const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
        const id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
        const path = `${uid}/${Date.now()}-${id}.${ext}`;
        try {
            // Private bucket first; staff approval moves it to the public showcase.
            const up = await supabase.storage.from('creator-showcase-pending').upload(path, f, { upsert: false, contentType: f.type });
            if (up.error) throw up.error;
            const ins = await supabase.from('creator_showcase').insert({
                user_id: uid,
                media_url: `pending://${path}`,
                storage_path: path,
                media_type: video ? 'video' : 'image',
                title: title.value || 'Untitled Work',
                caption: caption.value,
                is_featured: false,
                sort_order: 0,
                moderation_status: 'pending',
                share_to_discord: toDiscord.value,
                show_in_hub: !video && toWall.value
            });
            if (ins.error) {
                await supabase.storage.from('creator-showcase-pending').remove([path]);
                throw ins.error;
            }
            toast('Sent — staff will review it.', 'ok');
            file.value = null;
            clearPreview();
            title.value = caption.value = '';
            if (input.value) input.value.value = '';
            emit('uploaded');
        } catch (e) {
            error.value = friendlyError(e);
        }
        busy.value = false;
    }
</script>

<style scoped>
    .up {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        padding: 16px;
        border: 1px dashed var(--line-strong);
        border-radius: 14px;
        margin-bottom: 16px;
    }
    .drop {
        flex: 1 1 200px;
        max-width: 280px;
        min-height: 170px;
        border-radius: 12px;
        background: var(--panel-2);
        border: 1px solid var(--line);
        display: grid;
        place-items: center;
        text-align: center;
        padding: 12px;
        cursor: pointer;
        overflow: hidden;
        color: var(--text-2);
    }
    .drop:hover,
    .drop:focus-within {
        border-color: var(--acid);
    }
    .drop img {
        width: 100%;
        height: 100%;
        max-height: 220px;
        object-fit: cover;
        border-radius: 8px;
    }
    .drop small {
        color: var(--muted);
    }
    .fields {
        flex: 999 1 280px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .check {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 15px;
    }
    .check input {
        margin-top: 3px;
        width: 18px;
        height: 18px;
        accent-color: var(--acid);
        flex: none;
    }
    .fields .btn {
        align-self: flex-start;
    }
    .hint {
        margin: 0;
    }
</style>
