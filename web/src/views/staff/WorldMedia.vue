<template>
    <section class="wrap page">
        <div class="eyebrow">Staff · Worlds</div>
        <h1 class="page-title">World Media Manager</h1>
        <p class="muted intro">
            Put images on posters, frames and screens in your VRChat worlds. Changes are drafts until you press <strong>Publish</strong>; worlds pick
            them up on the next load or refresh (usually within ~10 minutes — GitHub Pages caches files that long).
        </p>

        <div v-if="!MEDIA_BASE_URL" class="notice notice-caution">
            The public media host isn't configured on this site yet (<code>VITE_MEDIA_BASE_URL</code>). You can set everything up and save drafts;
            publishing needs the host.
        </div>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <!-- Worlds -->
        <div class="worlds">
            <div class="tabs" role="tablist" aria-label="Worlds">
                <button v-for="w in worlds" :key="w.id" type="button" role="tab" class="tab" :aria-selected="w.id === worldId" @click="worldId = w.id">
                    {{ w.name }}
                </button>
                <button type="button" class="tab add" @click="showNewWorld = !showNewWorld">+ World</button>
            </div>
            <form v-if="showNewWorld" class="panel inline-form" @submit.prevent="createWorld">
                <label class="field"><span>Name</span><input v-model.trim="newWorld.name" class="input" required maxlength="80" placeholder="UnderWeb Hub" /></label>
                <label class="field"><span>Short id</span><input v-model.trim="newWorld.slug" class="input" required pattern="[a-z0-9][a-z0-9-]{1,40}" placeholder="hub" /></label>
                <label class="field"><span>VRChat world id (optional)</span><input v-model.trim="newWorld.vrchat_world_id" class="input" placeholder="wrld_…" /></label>
                <button class="btn btn-primary btn-sm" type="submit" :disabled="busy">Add world</button>
            </form>
        </div>

        <div v-if="loading" class="skeleton" style="height: 240px"></div>

        <template v-else-if="world">
            <div class="world-bar">
                <div>
                    <strong>{{ world.name }}</strong>
                    <span class="muted small"> · {{ slots.length }} slots · {{ pendingCount }} unpublished change{{ pendingCount === 1 ? '' : 's' }}</span>
                </div>
                <div class="cluster">
                    <button class="btn btn-sm" type="button" @click="showNewSlot = !showNewSlot">+ Slot</button>
                    <button class="btn btn-primary btn-sm" type="button" :disabled="publishing" @click="publish">
                        {{ publishing ? 'Publishing…' : 'Publish to world' }}
                    </button>
                </div>
            </div>

            <form v-if="showNewSlot" class="panel inline-form" @submit.prevent="createSlot">
                <label class="field"><span>Slot ID</span><input v-model="newSlot.slot_key" class="input mono" required placeholder="MAIN_ENTRANCE_01" @input="newSlot.slot_key = newSlot.slot_key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')" /></label>
                <label class="field"><span>Label</span><input v-model.trim="newSlot.label" class="input" placeholder="Entrance poster" /></label>
                <label class="field"><span>Room</span><input v-model.trim="newSlot.room" class="input" placeholder="Lobby" /></label>
                <label class="field">
                    <span>Shape</span>
                    <select v-model="newSlot.aspect" class="select">
                        <option v-for="a in aspects" :key="a" :value="a">{{ a }}</option>
                    </select>
                </label>
                <label class="field">
                    <span>Type</span>
                    <select v-model="newSlot.kind" class="select">
                        <option value="single">Single image</option>
                        <option value="gallery">Rotating gallery</option>
                    </select>
                </label>
                <label v-if="newSlot.kind === 'gallery'" class="field"><span>Images (max 20)</span><input v-model.number="newSlot.gallery_size" class="input" type="number" min="2" max="20" /></label>
                <label v-if="newSlot.kind === 'gallery'" class="field"><span>Seconds each</span><input v-model.number="newSlot.rotate_seconds" class="input" type="number" min="3" max="600" /></label>
                <button class="btn btn-primary btn-sm" type="submit" :disabled="busy">Add slot</button>
            </form>

            <p v-if="!slots.length" class="notice">No slots yet. Add one for each poster, frame or screen, using the same Slot ID you give it in Unity.</p>

            <!-- Slots -->
            <div class="slots">
                <article v-for="slot in slots" :key="slot.id" class="panel slot" :class="{ open: openSlotId === slot.id }">
                    <button type="button" class="slot-head" :aria-expanded="openSlotId === slot.id" @click="openSlotId = openSlotId === slot.id ? '' : slot.id">
                        <div class="thumb" :style="{ aspectRatio: `${slot.aspect_w} / ${slot.aspect_h}` }">
                            <img v-if="thumbFor(slot.id, 1)" :src="thumbFor(slot.id, 1)" alt="" loading="lazy" />
                            <span v-else class="muted small">Empty</span>
                        </div>
                        <div class="slot-meta">
                            <span class="mono">{{ slot.slot_key }}</span>
                            <strong>{{ slot.label || 'Untitled slot' }}</strong>
                            <span class="muted small">{{ slot.room || 'No room' }} · {{ slot.aspect_w }}:{{ slot.aspect_h }}{{ slot.kind === 'gallery' ? ` · gallery of ${slot.gallery_size}` : '' }}</span>
                        </div>
                        <span class="chip" :class="statusOf(slot).cls">{{ statusOf(slot).label }}</span>
                    </button>

                    <div v-if="openSlotId === slot.id" class="slot-body">
                        <div v-for="pos in positions(slot)" :key="pos" class="pos">
                            <div class="pos-head">
                                <span class="label">{{ slot.kind === 'gallery' ? `Image ${pos}` : 'Image' }}</span>
                                <span v-if="currentFor(slot.id, pos)?.caption" class="muted small">“{{ currentFor(slot.id, pos).caption }}”</span>
                                <span v-if="currentFor(slot.id, pos)?.ends_at" class="muted small">until {{ formatDateTime(currentFor(slot.id, pos).ends_at) }}</span>
                            </div>
                            <div class="cluster">
                                <button class="btn btn-sm" type="button" @click="startAssign(slot, pos)">{{ currentFor(slot.id, pos) ? 'Replace' : 'Choose image' }}</button>
                                <button v-if="currentFor(slot.id, pos)" class="btn btn-sm btn-ghost" type="button" @click="unpublish(slot, pos)">Remove</button>
                            </div>
                            <details v-if="historyFor(slot.id, pos).length > 1" class="history">
                                <summary class="small">History ({{ historyFor(slot.id, pos).length }})</summary>
                                <div v-for="h in historyFor(slot.id, pos)" :key="h.id" class="hist-row">
                                    <img v-if="assetThumb(h.asset_id)" :src="assetThumb(h.asset_id)" alt="" />
                                    <span class="muted small">{{ formatDateTime(h.created_at) }}{{ h.unpublished_at ? ' · removed' : '' }}{{ h.starts_at ? ` · from ${formatDateTime(h.starts_at)}` : '' }}</span>
                                    <button class="btn btn-sm btn-ghost" type="button" @click="restore(h)">Use again</button>
                                </div>
                            </details>
                        </div>
                        <div class="unity small">
                            <span class="label">Unity</span>
                            <p class="muted">Give the poster's <code>UnderWebMediaSlot</code> component Slot ID <code>{{ slot.slot_key }}</code>, then run <em>Tools → UnderWeb → Bake media URLs</em>.</p>
                            <code v-if="MEDIA_BASE_URL" class="url">{{ slotImageUrl(world.slug, slot.slot_key, 1) }}</code>
                        </div>
                        <button class="btn btn-sm btn-danger" type="button" @click="deleteSlot(slot)">Delete slot</button>
                    </div>
                </article>
            </div>

            <!-- Library -->
            <section class="library" aria-labelledby="lib-h">
                <div class="panel-head">
                    <h2 id="lib-h">Media library</h2>
                    <label class="btn btn-sm btn-primary">
                        Upload images
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="sr-only" @change="upload" />
                    </label>
                </div>
                <div class="cluster filters">
                    <button v-for="[k, l] in [['', 'All'], ...CATEGORIES]" :key="k" type="button" class="chip filter" :class="{ 'chip-acid': libFilter === k }" @click="libFilter = k">{{ l }}</button>
                </div>
                <label class="field upcat">
                    <span>Category for new uploads</span>
                    <select v-model="uploadCategory" class="select">
                        <option v-for="[k, l] in CATEGORIES" :key="k" :value="k">{{ l }}</option>
                    </select>
                </label>
                <p v-if="uploadStatus" class="muted small">{{ uploadStatus }}</p>
                <div v-if="target" class="notice notice-acid">
                    Pick an image for <strong>{{ target.slot.slot_key }}</strong>{{ target.slot.kind === 'gallery' ? ` · image ${target.position}` : '' }}.
                    <button class="btn btn-sm btn-ghost" type="button" @click="target = null">Cancel</button>
                </div>
                <div class="lib-grid">
                    <button v-for="a in libraryShown" :key="a.id" type="button" class="lib-item" :class="{ pickable: !!target }" @click="target && openPreview(a)">
                        <img v-if="assetThumb(a.id)" :src="assetThumb(a.id)" :alt="a.title || 'Library image'" loading="lazy" />
                        <span class="small">{{ a.title || '(untitled)' }}</span>
                    </button>
                </div>
                <p v-if="!library.length" class="muted small">No images yet. Upload group photos, posters, avatar or shader showcases.</p>
            </section>

            <!-- Activity -->
            <section class="panel activity">
                <h2 class="label">Publishing activity</h2>
                <div v-for="l in log" :key="l.id" class="row-line small">
                    <strong>{{ l.action === 'scheduled_publish' ? 'Scheduled publish' : 'Published' }}</strong>
                    <span class="muted"> · {{ formatDateTime(l.created_at) }} · {{ l.detail?.images_uploaded ?? 0 }} image(s)</span>
                    <div v-for="w in l.detail?.warnings || []" :key="w" class="error-text">{{ w }}</div>
                </div>
                <p v-if="!log.length" class="muted small">Nothing published yet.</p>
            </section>
        </template>

        <!-- Preview / assign dialog -->
        <dialog ref="dialogEl" class="preview" @close="closePreview">
            <form v-if="preview" method="dialog" class="stack" @submit.prevent="saveAssignment">
                <h2>Preview on {{ preview.slot.slot_key }}</h2>
                <div class="preview-frame" :style="{ aspectRatio: `${preview.slot.aspect_w} / ${preview.slot.aspect_h}` }">
                    <img v-if="preview.url" :src="preview.url" alt="How this will look in the world" />
                    <span v-else class="muted small">Rendering…</span>
                </div>
                <div class="cluster">
                    <button type="button" class="btn btn-sm" :class="{ 'btn-primary': preview.mode === 'fill' }" @click="setPreview({ mode: 'fill' })">Fill (crop)</button>
                    <button type="button" class="btn btn-sm" :class="{ 'btn-primary': preview.mode === 'fit' }" @click="setPreview({ mode: 'fit' })">Fit (bars)</button>
                </div>
                <label v-if="preview.mode === 'fill'" class="field"><span>Move left / right</span><input type="range" min="-1" max="1" step="0.05" :value="preview.offsetX" @change="setPreview({ offsetX: +$event.target.value })" /></label>
                <label v-if="preview.mode === 'fill'" class="field"><span>Move up / down</span><input type="range" min="-1" max="1" step="0.05" :value="preview.offsetY" @change="setPreview({ offsetY: +$event.target.value })" /></label>
                <label class="field"><span>Caption (optional, shown if the world supports it)</span><input v-model="preview.caption" class="input" maxlength="120" /></label>
                <div class="grid2">
                    <label class="field"><span>Show from (optional)</span><input v-model="preview.startsAt" class="input" type="datetime-local" /></label>
                    <label class="field"><span>Until (optional)</span><input v-model="preview.endsAt" class="input" type="datetime-local" /></label>
                </div>
                <p class="hint">{{ preview.width }}×{{ preview.height }} JPEG · {{ preview.kb }} KB</p>
                <p v-if="preview.error" class="error-text">{{ preview.error }}</p>
                <div class="cluster">
                    <button class="btn btn-primary" type="submit" :disabled="busy || !preview.blob">Save draft</button>
                    <button class="btn btn-ghost" type="button" @click="dialogEl.close()">Cancel</button>
                </div>
            </form>
        </dialog>
    </section>
</template>

<script setup>
    import { computed, onMounted, reactive, ref, watch } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { formatDateTime } from '../../lib/format';
    import { toast } from '../../lib/toast';
    import { CATEGORIES, MEDIA_BASE_URL, normaliseUpload, publishWorld, renderForSlot, signedUrls, slotImageUrl, uploadAsset } from '../../lib/worldMedia';

    const aspects = ['16:9', '9:16', '4:3', '3:4', '1:1', '2:3', '3:2', '21:9'];
    const loading = ref(true);
    const busy = ref(false);
    const publishing = ref(false);
    const error = ref('');
    const worlds = ref([]);
    const worldId = ref('');
    const slots = ref([]);
    const assignments = ref([]);
    const published = ref([]);
    const library = ref([]);
    const log = ref([]);
    const thumbs = ref({});
    const openSlotId = ref('');
    const showNewWorld = ref(false);
    const showNewSlot = ref(false);
    const newWorld = reactive({ name: '', slug: '', vrchat_world_id: '' });
    const newSlot = reactive({ slot_key: '', label: '', room: '', aspect: '16:9', kind: 'single', gallery_size: 6, rotate_seconds: 12 });
    const libFilter = ref('');
    const uploadCategory = ref('event');
    const uploadStatus = ref('');
    const target = ref(null);
    const preview = ref(null);
    const dialogEl = ref(null);

    const world = computed(() => worlds.value.find((w) => w.id === worldId.value) || null);
    const libraryShown = computed(() => library.value.filter((a) => !libFilter.value || a.category === libFilter.value));
    const assetById = computed(() => Object.fromEntries(library.value.map((a) => [a.id, a])));

    const positions = (slot) => Array.from({ length: slot.kind === 'gallery' ? slot.gallery_size : 1 }, (_, i) => i + 1);
    const now = () => Date.now();
    function currentFor(slotId, pos) {
        return assignments.value
            .filter((a) => a.slot_id === slotId && a.position === pos && !a.unpublished_at)
            .filter((a) => (!a.starts_at || new Date(a.starts_at).getTime() <= now()) && (!a.ends_at || new Date(a.ends_at).getTime() > now()))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    }
    const historyFor = (slotId, pos) => assignments.value.filter((a) => a.slot_id === slotId && a.position === pos).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const assetThumb = (assetId) => thumbs.value[assetById.value[assetId]?.storage_path] || '';
    const thumbFor = (slotId, pos) => {
        const c = currentFor(slotId, pos);
        return c ? assetThumb(c.asset_id) : '';
    };
    function statusOf(slot) {
        const want = positions(slot).map((p) => currentFor(slot.id, p)?.asset_id || '');
        const live = positions(slot).map((p) => published.value.find((x) => x.slot_id === slot.id && x.position === p)?.asset_id || '');
        if (want.every((x) => !x) && live.every((x) => !x)) return { label: 'EMPTY', cls: '' };
        if (want.join() !== live.join()) return { label: 'DRAFT CHANGES', cls: 'chip-caution' };
        return { label: 'LIVE', cls: 'chip-acid' };
    }
    const pendingCount = computed(() => slots.value.filter((s) => statusOf(s).label === 'DRAFT CHANGES').length);

    async function loadWorlds() {
        const { data, error: err } = await supabase.from('world_media_worlds').select('*').order('created_at');
        if (err) throw err;
        worlds.value = data || [];
        if (!worldId.value && worlds.value.length) worldId.value = worlds.value[0].id;
    }

    async function loadWorld() {
        if (!worldId.value) return;
        const { data: s, error: e1 } = await supabase.from('world_media_slots').select('*').eq('world_id', worldId.value).order('sort_order').order('slot_key');
        if (e1) throw e1;
        slots.value = s || [];
        const ids = slots.value.map((x) => x.id);
        const [a, p, l] = await Promise.all([
            ids.length ? supabase.from('world_media_assignments').select('*').in('slot_id', ids) : { data: [] },
            ids.length ? supabase.from('world_media_published').select('*').in('slot_id', ids) : { data: [] },
            supabase.from('world_media_publish_log').select('*').eq('world_id', worldId.value).order('created_at', { ascending: false }).limit(15)
        ]);
        assignments.value = a.data || [];
        published.value = p.data || [];
        log.value = l.data || [];
    }

    async function loadLibrary() {
        const { data, error: err } = await supabase.from('world_media_assets').select('*').eq('archived', false).order('created_at', { ascending: false }).limit(300);
        if (err) throw err;
        library.value = data || [];
        thumbs.value = { ...thumbs.value, ...(await signedUrls(library.value.map((x) => x.storage_path))) };
    }

    async function guard(fn) {
        error.value = '';
        busy.value = true;
        try {
            await fn();
        } catch (e) {
            error.value = friendlyError(e, String(e?.message || e));
        } finally {
            busy.value = false;
        }
    }

    onMounted(() =>
        guard(async () => {
            await Promise.all([loadWorlds(), loadLibrary()]);
            await loadWorld();
            loading.value = false;
        }).finally(() => (loading.value = false))
    );
    watch(worldId, () => guard(loadWorld));

    const createWorld = () =>
        guard(async () => {
            const { data, error: err } = await supabase
                .from('world_media_worlds')
                .insert({ name: newWorld.name, slug: newWorld.slug.toLowerCase(), vrchat_world_id: newWorld.vrchat_world_id || null })
                .select('*')
                .single();
            if (err) throw err;
            worlds.value.push(data);
            worldId.value = data.id;
            Object.assign(newWorld, { name: '', slug: '', vrchat_world_id: '' });
            showNewWorld.value = false;
        });

    const createSlot = () =>
        guard(async () => {
            const [aw, ah] = newSlot.aspect.split(':').map(Number);
            const { error: err } = await supabase.from('world_media_slots').insert({
                world_id: worldId.value,
                slot_key: newSlot.slot_key,
                label: newSlot.label,
                room: newSlot.room,
                kind: newSlot.kind,
                gallery_size: newSlot.kind === 'gallery' ? newSlot.gallery_size : 1,
                rotate_seconds: newSlot.rotate_seconds,
                aspect_w: aw,
                aspect_h: ah,
                sort_order: slots.value.length
            });
            if (err) throw err.code === '23505' ? new Error(`${newSlot.slot_key} already exists in this world.`) : err;
            Object.assign(newSlot, { slot_key: '', label: '', room: '' });
            showNewSlot.value = false;
            await loadWorld();
        });

    const deleteSlot = (slot) => {
        if (!window.confirm(`Delete ${slot.slot_key}? Its history goes too. Library images stay.`)) return;
        guard(async () => {
            const { error: err } = await supabase.from('world_media_slots').delete().eq('id', slot.id);
            if (err) throw err;
            await loadWorld();
        });
    };

    async function upload(event) {
        const list = [...(event.target.files || [])];
        event.target.value = '';
        for (const [i, file] of list.entries()) {
            uploadStatus.value = `Uploading ${i + 1} of ${list.length}…`;
            try {
                const { blob, width, height } = await normaliseUpload(file);
                await uploadAsset(blob, { title: file.name.replace(/\.[^.]+$/, ''), category: uploadCategory.value, width, height });
            } catch (e) {
                toast(`${file.name}: ${e.message}`, 'error', 6000);
            }
        }
        uploadStatus.value = '';
        await guard(loadLibrary);
    }

    function startAssign(slot, position) {
        target.value = { slot, position };
        document.getElementById('lib-h')?.scrollIntoView({ behavior: 'smooth' });
    }

    async function openPreview(asset) {
        const { slot, position } = target.value;
        preview.value = { slot, position, asset, mode: 'fill', offsetX: 0, offsetY: 0, caption: '', startsAt: '', endsAt: '', url: '', blob: null, error: '' };
        dialogEl.value.showModal();
        await renderPreview();
    }

    async function renderPreview() {
        const p = preview.value;
        try {
            const src = await fetch(assetThumb(p.asset.id)).then((r) => r.blob());
            const out = await renderForSlot(new File([src], 'src.jpg', { type: src.type || 'image/jpeg' }), {
                aspectW: p.slot.aspect_w,
                aspectH: p.slot.aspect_h,
                maxPx: p.slot.max_px,
                mode: p.mode,
                offsetX: p.offsetX,
                offsetY: p.offsetY
            });
            if (p.url) URL.revokeObjectURL(p.url);
            Object.assign(p, { blob: out.blob, url: URL.createObjectURL(out.blob), width: out.width, height: out.height, kb: Math.round(out.blob.size / 1024), error: '' });
        } catch (e) {
            p.error = e?.message || 'Could not render the preview.';
        }
    }

    function setPreview(patch) {
        Object.assign(preview.value, patch);
        void renderPreview();
    }

    function closePreview() {
        if (preview.value?.url) URL.revokeObjectURL(preview.value.url);
        preview.value = null;
    }

    const saveAssignment = () =>
        guard(async () => {
            const p = preview.value;
            if (p.startsAt && p.endsAt && new Date(p.endsAt) <= new Date(p.startsAt)) throw new Error('“Until” must be after “Show from”.');
            const asset = await uploadAsset(p.blob, {
                title: `${p.asset.title || 'image'} · ${p.slot.slot_key}`,
                category: p.asset.category,
                width: p.width,
                height: p.height
            });
            const { error: err } = await supabase.from('world_media_assignments').insert({
                slot_id: p.slot.id,
                asset_id: asset.id,
                position: p.position,
                caption: p.caption,
                starts_at: p.startsAt ? new Date(p.startsAt).toISOString() : null,
                ends_at: p.endsAt ? new Date(p.endsAt).toISOString() : null
            });
            if (err) throw err;
            dialogEl.value.close();
            target.value = null;
            await Promise.all([loadWorld(), loadLibrary()]);
            toast('Draft saved. Press Publish to send it to the world.', 'ok');
        });

    const unpublish = (slot, pos) =>
        guard(async () => {
            const c = currentFor(slot.id, pos);
            if (!c) return;
            const { error: err } = await supabase.from('world_media_assignments').update({ unpublished_at: new Date().toISOString() }).eq('id', c.id);
            if (err) throw err;
            await loadWorld();
        });

    const restore = (h) =>
        guard(async () => {
            const { error: err } = await supabase.from('world_media_assignments').insert({ slot_id: h.slot_id, asset_id: h.asset_id, position: h.position, caption: h.caption });
            if (err) throw err;
            await loadWorld();
            toast('Restored as a draft. Publish to apply.', 'ok');
        });

    async function publish() {
        publishing.value = true;
        error.value = '';
        try {
            const res = await publishWorld(worldId.value);
            toast(res?.warnings?.length ? `Published with ${res.warnings.length} warning(s).` : 'Published. Worlds update on their next refresh.', res?.warnings?.length ? 'error' : 'ok', 6000);
            await loadWorld();
        } catch (e) {
            error.value = e.message;
        } finally {
            publishing.value = false;
        }
    }
</script>

<style scoped>
    .intro {
        max-width: 720px;
    }
    .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        border-bottom: 1px solid var(--line);
        margin: 16px 0;
    }
    .tab {
        min-height: 44px;
        padding: 0 14px;
        background: none;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--muted);
        font-family: var(--font-display);
        font-weight: 600;
        cursor: pointer;
    }
    .tab[aria-selected='true'] {
        color: var(--acid);
        border-bottom-color: var(--acid);
    }
    .tab.add {
        color: var(--text-2);
    }
    .inline-form {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-end;
        margin-bottom: 16px;
    }
    .inline-form .field {
        flex: 1 1 160px;
    }
    .world-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
    }
    .slots {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .slot {
        padding: 0;
        overflow: hidden;
    }
    .slot.open {
        border-color: var(--line-strong);
    }
    .slot-head {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px;
        background: none;
        border: 0;
        color: inherit;
        text-align: left;
        cursor: pointer;
        font: inherit;
    }
    .thumb {
        width: 96px;
        max-height: 96px;
        flex: none;
        border-radius: var(--radius-sm);
        background: #000;
        border: 1px solid var(--line);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
    .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .slot-meta {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
    }
    .mono,
    code {
        font-family: var(--font-mono);
        font-size: 12px;
    }
    .slot-body {
        border-top: 1px solid var(--line);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .pos {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .pos-head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: baseline;
    }
    .history summary {
        cursor: pointer;
        color: var(--muted);
        min-height: 32px;
    }
    .hist-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 0;
    }
    .hist-row img {
        width: 56px;
        height: 36px;
        object-fit: cover;
        border-radius: 3px;
    }
    .unity p {
        margin: 4px 0;
    }
    .url {
        display: block;
        word-break: break-all;
        color: var(--text-2);
    }
    .library {
        margin-top: 32px;
    }
    .library h2 {
        font-size: 20px;
    }
    .filters {
        margin-bottom: 12px;
    }
    .filter {
        cursor: pointer;
        background: none;
        min-height: 32px;
    }
    .upcat {
        max-width: 280px;
        margin-bottom: 12px;
    }
    .lib-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
        gap: 10px;
        margin-top: 12px;
    }
    .lib-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 6px;
        color: var(--text-2);
        text-align: left;
        cursor: default;
    }
    .lib-item.pickable {
        cursor: pointer;
    }
    .lib-item.pickable:hover {
        border-color: var(--acid);
    }
    .lib-item img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 3px;
        background: #000;
    }
    .lib-item span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .activity {
        margin-top: 28px;
    }
    .preview {
        width: min(94vw, 640px);
        background: var(--panel);
        color: var(--text);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        padding: 20px;
    }
    .preview::backdrop {
        background: rgba(0, 0, 0, 0.75);
    }
    .preview h2 {
        font-size: 20px;
    }
    .preview-frame {
        width: 100%;
        max-height: 50vh;
        background: #000;
        border: 1px solid var(--line);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
    .preview-frame img {
        max-width: 100%;
        max-height: 50vh;
        object-fit: contain;
    }
    .grid2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
        gap: 12px;
    }
    input[type='range'] {
        accent-color: var(--acid);
    }
</style>
