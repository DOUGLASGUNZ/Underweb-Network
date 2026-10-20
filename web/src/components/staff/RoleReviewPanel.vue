<template>
    <section aria-labelledby="rr-h">
        <div class="panel-head">
            <h2 id="rr-h">Role applications</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
        </div>
        <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 110px"></div></div>
        <p v-else-if="error" class="error-text" role="alert">{{ error }}</p>
        <div v-else-if="!apps.length" class="notice">No applications waiting. 🎉</div>
        <div v-else class="stack">
            <article v-for="a in apps" :key="a.id" class="panel app">
                <div class="app-head">
                    <div>
                        <strong>{{ nameOf(names, a.user_id) }}</strong>
                        <span class="muted"> wants </span>
                        <strong class="role">{{ roleName(a.role_slug) }}</strong>
                        <div class="muted small">{{ scopeLabel(a.group_scope) }} · {{ relativeTime(a.submitted_at) }}</div>
                    </div>
                    <span class="chip" :class="a.status === 'reviewing' ? 'chip-caution' : ''">{{ a.status }}</span>
                </div>
                <p class="note">{{ a.applicant_note || 'No note from the applicant.' }}</p>
                <dl v-if="answers(a).length" class="answers">
                    <template v-for="[q, v] in answers(a)" :key="q">
                        <dt>{{ q }}</dt>
                        <dd>{{ v }}</dd>
                    </template>
                </dl>
                <label class="field">
                    <span class="sr-only">Note to applicant</span>
                    <input v-model="notes[a.id]" class="input" maxlength="300" placeholder="Note (required to deny, shown to the applicant)" />
                </label>
                <div class="cluster">
                    <button class="btn btn-sm btn-primary" type="button" :disabled="busy === a.id" @click="review(a, 'accepted')">Approve</button>
                    <button class="btn btn-sm btn-danger" type="button" :disabled="busy === a.id" @click="review(a, 'denied')">Deny</button>
                    <RouterLink v-if="names[a.user_id]?.username" :to="`/u/${names[a.user_id].username}`" class="btn btn-sm btn-ghost">Profile</RouterLink>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
    import { onMounted, reactive, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { nameOf, resolveNames, scopeLabel } from '../../lib/staff';
    import { relativeTime } from '../../lib/format';
    import { toast } from '../../lib/toast';

    const emit = defineEmits(['count']);
    const apps = ref([]);
    const names = ref({});
    const defs = ref({});
    const notes = reactive({});
    const loading = ref(true);
    const error = ref('');
    const busy = ref('');

    const roleName = (slug) => defs.value[slug] || String(slug).replace(/_/g, ' ');
    const answers = (a) => (a.answers && typeof a.answers === 'object' ? Object.entries(a.answers).filter(([, v]) => v !== null && v !== '') : []);

    async function load() {
        loading.value = true;
        error.value = '';
        const [res, d] = await Promise.all([
            supabase.from('role_applications').select('*').in('status', ['pending', 'reviewing']).order('submitted_at'),
            supabase.from('role_definitions').select('slug,name')
        ]);
        if (res.error) {
            error.value = friendlyError(res.error);
            loading.value = false;
            return;
        }
        defs.value = Object.fromEntries((d.data || []).map((x) => [x.slug, x.name]));
        apps.value = res.data || [];
        emit('count', apps.value.length);
        names.value = await resolveNames(apps.value.map((a) => a.user_id));
        loading.value = false;
    }

    async function review(a, decision) {
        const note = (notes[a.id] || '').trim();
        if (decision === 'denied' && note.length < 3) {
            toast('Add a short reason before denying.', 'error');
            return;
        }
        busy.value = a.id;
        const { error: err } = await supabase.rpc('uw_review_role_application', { p_application_id: a.id, p_decision: decision, p_review_note: note });
        busy.value = '';
        if (err) {
            toast(/permission|not allowed|cannot|authority|rank/i.test(err.message) ? `You can't approve ${roleName(a.role_slug)} applications.` : friendlyError(err), 'error', 6000);
            return;
        }
        toast(decision === 'accepted' ? `${roleName(a.role_slug)} granted to ${nameOf(names.value, a.user_id)}.` : 'Application denied.', 'ok');
        apps.value = apps.value.filter((x) => x.id !== a.id);
        emit('count', apps.value.length);
    }

    onMounted(load);
</script>

<style scoped>
    .app {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .app-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
    }
    .role {
        color: var(--acid);
    }
    .note {
        margin: 0;
        color: var(--text-2);
        white-space: pre-line;
    }
    .answers {
        margin: 0;
        display: grid;
        grid-template-columns: minmax(100px, max-content) 1fr;
        gap: 4px 12px;
        font-size: 13px;
    }
    .answers dt {
        color: var(--muted);
    }
    .answers dd {
        margin: 0;
    }
</style>
