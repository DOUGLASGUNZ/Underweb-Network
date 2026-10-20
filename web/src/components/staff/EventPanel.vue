<template>
    <section aria-labelledby="ev-h" class="stack">
        <div class="panel-head">
            <h2 id="ev-h">Events</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
        </div>

        <form class="panel stack" @submit.prevent="submit">
            <h3 class="label">Propose an event</h3>
            <p class="muted small" style="margin: 0">Event Staff and up can propose. Admins, Directors and the Owner approve before it's public.</p>
            <label class="field"><span>Title</span><input v-model.trim="form.title" class="input" required maxlength="120" /></label>
            <div class="grid2">
                <label class="field">
                    <span>Starts ({{ zone }})</span>
                    <input v-model="form.startsAt" class="input" type="datetime-local" required />
                </label>
                <label class="field">
                    <span>Community</span>
                    <select v-model="form.scope" class="select">
                        <option v-for="[k, l] in SCOPES" :key="k" :value="k">{{ l }}</option>
                    </select>
                </label>
            </div>
            <p v-if="form.startsAt" class="hint">Eastern: {{ eastern }}</p>
            <label class="field"><span>World / location</span><input v-model.trim="form.location" class="input" maxlength="200" placeholder="UnderWeb Hub · Lounge" /></label>
            <label class="field"><span>Description</span><textarea v-model="form.description" class="textarea" maxlength="2000"></textarea></label>
            <button class="btn btn-primary" type="submit" :disabled="submitting">{{ submitting ? 'Sending…' : 'Send for approval' }}</button>
        </form>

        <div>
            <h3 class="label">Waiting for approval</h3>
            <div v-if="loading" class="skeleton" style="height: 100px; margin-top: 10px"></div>
            <p v-else-if="error" class="error-text">{{ error }}</p>
            <div v-else-if="!pending.length" class="notice" style="margin-top: 10px">No events waiting.</div>
            <div v-else class="stack" style="margin-top: 10px">
                <article v-for="ev in pending" :key="ev.id" class="panel">
                    <EventRow :event="ev" />
                    <p v-if="ev.description" class="desc">{{ ev.description }}</p>
                    <div class="muted small">Proposed by {{ nameOf(names, ev.created_by) }} · {{ scopeLabel(ev.group_scope) }}</div>
                    <template v-if="ev.created_by !== account.userId.value || account.isLeadership.value">
                        <input v-model="notes[ev.id]" class="input note" maxlength="300" placeholder="Note to the proposer (required to reject)" aria-label="Review note" />
                        <div class="cluster">
                            <button class="btn btn-sm btn-primary" type="button" :disabled="busy === ev.id" @click="review(ev, 'published')">Approve & publish</button>
                            <button class="btn btn-sm btn-danger" type="button" :disabled="busy === ev.id" @click="review(ev, 'rejected')">Reject</button>
                        </div>
                    </template>
                </article>
            </div>
        </div>
    </section>
</template>

<script setup>
    import { computed, onMounted, reactive, ref } from 'vue';
    import EventRow from '../EventRow.vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { account } from '../../lib/account';
    import { SCOPES, nameOf, resolveNames, scopeLabel } from '../../lib/staff';
    import { eventTimes, localTimeZone } from '../../lib/format';
    import { toast } from '../../lib/toast';

    const emit = defineEmits(['count']);
    const zone = localTimeZone();
    const form = reactive({ title: '', startsAt: '', scope: 'underweb', location: '', description: '' });
    const submitting = ref(false);
    const pending = ref([]);
    const names = ref({});
    const notes = reactive({});
    const loading = ref(true);
    const error = ref('');
    const busy = ref('');
    const eastern = computed(() => (form.startsAt ? eventTimes(new Date(form.startsAt).toISOString()).eastern : ''));

    async function load() {
        loading.value = true;
        error.value = '';
        const { data, error: err } = await supabase
            .from('network_events')
            .select('id,title,description,starts_at,ends_at,location,group_scope,status,created_by,created_at')
            .eq('status', 'pending')
            .order('starts_at');
        loading.value = false;
        if (err) {
            error.value = friendlyError(err);
            return;
        }
        pending.value = data || [];
        emit('count', pending.value.length);
        names.value = await resolveNames(pending.value.map((e) => e.created_by));
    }

    async function submit() {
        const start = new Date(form.startsAt);
        if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60000) {
            toast('Pick a start time in the future.', 'error');
            return;
        }
        submitting.value = true;
        const { error: err } = await supabase.rpc('uw_submit_event', {
            p_title: form.title,
            p_group_scope: form.scope,
            p_starts_at: start.toISOString(),
            p_location: form.location,
            p_description: form.description
        });
        submitting.value = false;
        if (err) {
            toast(/Event Staff or higher/i.test(err.message) ? 'Proposing events needs Event Staff or higher in that community.' : friendlyError(err), 'error', 6000);
            return;
        }
        toast('Sent for approval.', 'ok');
        Object.assign(form, { title: '', startsAt: '', location: '', description: '' });
        await load();
    }

    async function review(ev, decision) {
        const note = (notes[ev.id] || '').trim();
        if (decision === 'rejected' && note.length < 3) {
            toast('Add a short reason before rejecting.', 'error');
            return;
        }
        busy.value = ev.id;
        const { error: err } = await supabase.rpc('uw_review_event', { p_event_id: ev.id, p_decision: decision, p_note: note });
        busy.value = '';
        if (err) {
            toast(/approval/i.test(err.message) ? 'Approving events needs Admin, Director or Owner in that community.' : friendlyError(err), 'error', 6000);
            return;
        }
        toast(decision === 'published' ? 'Event published.' : 'Event rejected.', 'ok');
        pending.value = pending.value.filter((x) => x.id !== ev.id);
        emit('count', pending.value.length);
    }

    onMounted(load);
</script>

<style scoped>
    .grid2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
        gap: 12px;
    }
    .desc {
        color: var(--text-2);
        white-space: pre-line;
        margin: 0 0 6px;
    }
    .note {
        margin: 10px 0;
    }
</style>
