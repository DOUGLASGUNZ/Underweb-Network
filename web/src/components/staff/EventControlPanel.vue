<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Event Control</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
        </div>
        <p class="muted small" style="margin: 0">Edit or cancel events, and give them a flyer. Owner and Directors only — the database checks it too.</p>

        <div v-if="loading" class="stack"><div v-for="i in 2" :key="i" class="skeleton" style="height: 140px"></div></div>
        <div v-else-if="denied" class="notice">Event Control is for the Owner and Directors.</div>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <div v-else-if="!events.length" class="notice">No events yet. Propose one in the Events tab.</div>

        <article v-for="ev in events" v-else :key="ev.id" class="panel ev">
            <div class="cover">
                <img v-if="ev.cover_url" :src="ev.cover_url" alt="" />
                <span v-else class="muted small">No flyer</span>
            </div>
            <div class="body">
                <div class="cluster">
                    <span class="chip" :class="timing(ev) === 'LIVE' ? 'chip-acid' : ''">{{ timing(ev) }}</span>
                    <span class="chip">{{ String(ev.status || '').toUpperCase() }}</span>
                    <span class="chip">{{ scopeLabel(ev.group_scope) }}</span>
                </div>
                <h3>{{ ev.title || 'Untitled event' }}</h3>
                <p class="muted small">{{ ev.starts_at ? formatDateTime(ev.starts_at) : 'No date' }}<template v-if="ev.location"> · {{ ev.location }}</template></p>
                <div v-if="editing !== ev.id" class="cluster">
                    <button class="btn btn-sm btn-primary" type="button" @click="startEdit(ev)">Edit</button>
                    <button class="btn btn-sm btn-danger" type="button" :disabled="busy" @click="cancelEvent(ev)">Cancel event</button>
                </div>

                <form v-else class="stack edit" @submit.prevent="save(ev)">
                    <label class="field"><span>Title</span><input v-model.trim="form.title" class="input" required maxlength="120" /></label>
                    <label class="field"><span>Description</span><textarea v-model="form.description" class="textarea" maxlength="2000"></textarea></label>
                    <div class="grid2">
                        <label class="field"><span>Starts ({{ zone }})</span><input v-model="form.starts_at" class="input" type="datetime-local" required /></label>
                        <label class="field"><span>Ends <small class="muted">(optional)</small></span><input v-model="form.ends_at" class="input" type="datetime-local" /></label>
                    </div>
                    <p v-if="form.starts_at" class="hint">Eastern: {{ eastern(form.starts_at) }}</p>
                    <div class="grid2">
                        <label class="field"><span>World / location</span><input v-model.trim="form.location" class="input" maxlength="200" placeholder="The UnderWeb Hub" /></label>
                        <label class="field">
                            <span>Community</span>
                            <select v-model="form.group_scope" class="select">
                                <option v-for="[k, l] in scopeOptions" :key="k" :value="k">{{ l }}</option>
                            </select>
                        </label>
                    </div>
                    <div class="field">
                        <span>Flyer / cover image</span>
                        <div class="flyer">
                            <img v-if="form.cover_url" :src="form.cover_url" alt="" />
                            <div class="stack flyer-ctl">
                                <label class="btn btn-sm">
                                    {{ uploading ? 'Uploading…' : form.cover_url ? 'Replace image' : 'Upload image' }}
                                    <input type="file" accept="image/*" class="sr-only" :disabled="uploading" @change="upload" />
                                </label>
                                <button v-if="form.cover_url" class="btn btn-sm btn-ghost" type="button" @click="form.cover_url = ''">Remove</button>
                                <p class="hint">Wide images look best (16:9), up to 5 MB. Shows on the site, and on the hub's next-event screen.</p>
                            </div>
                        </div>
                    </div>
                    <p v-if="formError" class="error-text" role="alert">{{ formError }}</p>
                    <div class="cluster">
                        <button class="btn btn-primary" type="submit" :disabled="busy || uploading">{{ busy ? 'Saving…' : 'Save changes' }}</button>
                        <button class="btn btn-ghost" type="button" @click="editing = ''">Close</button>
                    </div>
                </form>
            </div>
        </article>
    </section>
</template>

<script setup>
    import { onMounted, reactive, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { account } from '../../lib/account';
    import { SCOPES, scopeLabel } from '../../lib/staff';
    import { eventTimes, formatDateTime, localTimeZone } from '../../lib/format';
    import { uploadProfileImage } from '../../lib/profiles';
    import { toast } from '../../lib/toast';

    const zone = localTimeZone();
    const events = ref([]);
    const loading = ref(true);
    const denied = ref(false);
    const error = ref('');
    const editing = ref('');
    const busy = ref(false);
    const uploading = ref(false);
    const formError = ref('');
    const form = reactive({ title: '', description: '', starts_at: '', ends_at: '', location: '', group_scope: 'underweb', cover_url: '' });
    const scopeOptions = ref(SCOPES);

    const pad = (n) => String(n).padStart(2, '0');
    const toLocalInput = (v) => {
        if (!v) return '';
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const toIso = (v) => (v ? new Date(v).toISOString() : null);
    const eastern = (v) => eventTimes(toIso(v)).eastern;

    function timing(ev) {
        if (!ev.starts_at) return 'NO DATE';
        const now = Date.now();
        const s = new Date(ev.starts_at).getTime();
        const e = ev.ends_at ? new Date(ev.ends_at).getTime() : s + 4 * 3600 * 1000;
        if (now > e) return 'ENDED';
        if (now >= s) return 'LIVE';
        return 'UPCOMING';
    }

    async function load() {
        loading.value = true;
        error.value = '';
        const { data: ok, error: aErr } = await supabase.rpc('uw_is_owner_or_director');
        if (aErr || ok !== true) {
            denied.value = true;
            loading.value = false;
            return;
        }
        const { data, error: err } = await supabase
            .from('network_events')
            .select('*')
            .is('archived_at', null)
            .is('cancelled_at', null)
            .order('starts_at', { ascending: false, nullsFirst: false })
            .limit(100);
        if (err) error.value = friendlyError(err);
        events.value = data || [];
        loading.value = false;
    }
    onMounted(load);

    function startEdit(ev) {
        editing.value = ev.id;
        formError.value = '';
        Object.assign(form, {
            title: ev.title || '',
            description: ev.description || '',
            starts_at: toLocalInput(ev.starts_at),
            ends_at: toLocalInput(ev.ends_at),
            location: ev.location || '',
            group_scope: ev.group_scope || 'underweb',
            cover_url: ev.cover_url || ''
        });
        if (form.group_scope && !SCOPES.some(([k]) => k === form.group_scope)) scopeOptions.value = [...SCOPES, [form.group_scope, scopeLabel(form.group_scope)]];
    }

    async function upload(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        uploading.value = true;
        formError.value = '';
        try {
            form.cover_url = await uploadProfileImage(account.userId.value, file, 'event-cover');
        } catch (err) {
            formError.value = err?.message || 'Upload failed.';
        }
        uploading.value = false;
    }

    async function save(ev) {
        formError.value = '';
        const patch = {
            title: form.title,
            description: String(form.description || '').trim() || null,
            starts_at: toIso(form.starts_at),
            ends_at: toIso(form.ends_at),
            location: form.location || null,
            group_scope: form.group_scope || 'underweb',
            cover_url: form.cover_url || null
        };
        if (!patch.title) return (formError.value = 'Title is required.');
        if (patch.ends_at && patch.starts_at && new Date(patch.ends_at) <= new Date(patch.starts_at)) return (formError.value = 'End time must be after the start.');
        if (patch.cover_url && !/^https:\/\//.test(patch.cover_url)) return (formError.value = 'The flyer must be an https:// image.');
        busy.value = true;
        // Edits go through the database's own checks (Owner/Director, valid times, valid community).
        const { error: err } = await supabase.rpc('uw_manage_event', {
            p_event_id: ev.id,
            p_title: patch.title,
            p_group_scope: patch.group_scope,
            p_starts_at: patch.starts_at,
            p_ends_at: patch.ends_at,
            p_location: patch.location || '',
            p_description: patch.description || ''
        });
        if (err) {
            busy.value = false;
            return (formError.value = friendlyError(err));
        }
        if ((patch.cover_url || null) !== (ev.cover_url || null)) {
            const { error: cErr } = await supabase.rpc('uw_set_event_cover', { p_event_id: ev.id, p_cover_url: patch.cover_url || '' });
            if (cErr) {
                busy.value = false;
                await load();
                return (formError.value = /do not own/i.test(cErr.message)
                    ? 'Details saved. The flyer can only be changed by whoever created this event (for now).'
                    : friendlyError(cErr));
            }
        }
        busy.value = false;
        editing.value = '';
        toast('Event updated.', 'ok');
        load();
    }

    async function cancelEvent(ev) {
        const reason = window.prompt(`Cancel "${ev.title || 'this event'}"? It stays in history.\n\nReason (optional):`, '');
        if (reason === null) return;
        busy.value = true;
        const { error: err } = await supabase.rpc('uw_cancel_event', { p_id: ev.id, p_reason: reason || null });
        busy.value = false;
        if (err) return toast(friendlyError(err), 'error');
        toast('Event cancelled.', 'ok');
        load();
    }
</script>

<style scoped>
    .ev {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        align-items: flex-start;
    }
    .cover {
        flex: 0 1 220px;
        aspect-ratio: 16 / 9;
        border-radius: 10px;
        overflow: hidden;
        background: #0b1a10;
        display: grid;
        place-items: center;
        border: 1px solid var(--line);
    }
    .cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .body {
        flex: 999 1 320px;
        min-width: 0;
    }
    .body h3 {
        font-size: 22px;
        margin: 10px 0 2px;
    }
    .body > p {
        margin: 0 0 12px;
    }
    .edit {
        margin-top: 8px;
    }
    .grid2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
        gap: 12px;
    }
    .flyer {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        align-items: flex-start;
    }
    .flyer img {
        width: 240px;
        max-width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 10px;
        border: 1px solid var(--line-strong);
    }
    .flyer-ctl {
        gap: 8px;
        flex: 1 1 200px;
        align-items: flex-start;
    }
    .flyer-ctl .hint {
        margin: 0;
    }
</style>
