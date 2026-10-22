<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Moderation cases</h2>
            <div class="cluster">
                <select v-if="groups.length > 1" v-model="groupId" class="select" aria-label="Group">
                    <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
                <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
                <button v-if="group && !creating" class="btn btn-sm btn-primary" type="button" @click="startNew">New case</button>
            </div>
        </div>
        <p class="muted small" style="margin: 0">
            The same case files as UWX → Moderation. Staff-only; the timeline can't be edited. Banning and kicking happen in VRChat (or from UWX, which records it here).
        </p>

        <div v-if="loadingGroups" class="skeleton" style="height: 120px"></div>
        <div v-else-if="!group" class="notice">
            No group you can moderate yet. An Owner or Director registers The UnderWeb from UWX → Group Intel; access then follows your UnderWeb role.
        </div>

        <template v-else>
            <!-- new case -->
            <form v-if="creating" class="panel stack" @submit.prevent="create">
                <h3 class="label">New case · {{ group.name }}</h3>
                <div class="grid2">
                    <label class="field"><span>Who (VRChat profile link or usr_ id, optional)</span><input v-model.trim="draft.who" class="input" /></label>
                    <label class="field"><span>Their display name</span><input v-model.trim="draft.name" class="input" maxlength="80" /></label>
                    <label class="field"><span>Title</span><input v-model.trim="draft.title" class="input" required minlength="3" maxlength="140" /></label>
                    <label class="field">
                        <span>Category</span>
                        <select v-model="draft.category" class="select"><option v-for="[k, l] in CASE_CATEGORIES" :key="k" :value="k">{{ l }}</option></select>
                    </label>
                    <label class="field">
                        <span>Severity</span>
                        <select v-model="draft.severity" class="select"><option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option></select>
                    </label>
                </div>
                <label class="field"><span>What happened</span><textarea v-model="draft.summary" class="input" rows="4" maxlength="4000"></textarea></label>
                <p v-if="formError" class="error-text">{{ formError }}</p>
                <div class="cluster">
                    <button class="btn btn-primary" type="submit" :disabled="busy">Create case</button>
                    <button class="btn btn-ghost" type="button" @click="creating = false">Cancel</button>
                </div>
            </form>

            <!-- detail -->
            <article v-else-if="open" class="panel stack">
                <div class="cluster between">
                    <button class="btn btn-sm btn-ghost" type="button" @click="open = null">← All cases</button>
                    <span class="muted small">#{{ open.case_number }} · opened {{ when(open.created_at) }} by {{ names[open.created_by] || 'staff' }}</span>
                </div>
                <h3 class="case-title">{{ open.title }}</h3>
                <div class="cluster">
                    <span class="chip" :class="statusClass(open.status)">{{ statusLabel(open.status) }}</span>
                    <span class="chip" :class="open.severity === 'high' || open.severity === 'critical' ? 'chip-danger' : ''">{{ open.severity }}</span>
                    <span class="chip">{{ categoryLabel(open.category) }}</span>
                    <span v-if="open.share_with_network" class="chip">Shared with partner groups</span>
                </div>
                <p v-if="open.subject_vrc_id" class="small">
                    About <strong>{{ open.subject_name || 'unknown name' }}</strong> ·
                    <a :href="`https://vrchat.com/home/user/${open.subject_vrc_id}`" target="_blank" rel="noopener">VRChat profile ↗</a>
                </p>
                <p class="summary">{{ open.summary || 'No summary.' }}</p>

                <div class="grid2">
                    <label class="field">
                        <span>Status</span>
                        <select class="select" :value="open.status" @change="update({ status: $event.target.value })">
                            <option v-for="[k, l] in CASE_STATUSES" :key="k" :value="k">{{ l }}</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Assigned to</span>
                        <select class="select" :value="open.assigned_to || ''" @change="update({ assigned_to: $event.target.value || null })">
                            <option value="">Nobody</option>
                            <option v-for="s in staff" :key="s.user_id" :value="s.user_id">{{ s.display_name || s.username }}</option>
                        </select>
                    </label>
                </div>

                <form class="stack" @submit.prevent="addNote">
                    <label class="field">
                        <span>Add to the case</span>
                        <select v-model="entryKind" class="select">
                            <option value="note">Note</option>
                            <option value="action">Record an action</option>
                            <option value="appeal">Appeal received</option>
                            <option v-if="group.level >= 3" value="appeal_decision">Appeal decision</option>
                        </select>
                    </label>
                    <label v-if="entryKind === 'action'" class="field">
                        <span>Action</span>
                        <select v-model="actionType" class="select">
                            <option value="warning">Warning</option>
                            <option value="kick">Removed from group</option>
                            <option value="ban">Group ban</option>
                            <option value="unban">Unban</option>
                            <option value="instance_kick">Instance kick</option>
                            <option value="instance_warn">Instance warn</option>
                            <option value="other">Other</option>
                        </select>
                    </label>
                    <label v-if="entryKind === 'appeal_decision'" class="field">
                        <span>Outcome</span>
                        <select v-model="decision" class="select"><option>Upheld</option><option>Reduced</option><option>Overturned</option></select>
                    </label>
                    <textarea v-model="noteText" class="input" rows="3" maxlength="4000" placeholder="Details"></textarea>
                    <button class="btn btn-sm btn-primary" type="submit" :disabled="busy || (entryKind === 'note' && !noteText.trim())">Add</button>
                </form>

                <div>
                    <h3 class="label">Timeline</h3>
                    <div v-for="e in entries" :key="e.id" class="line">
                        <div>
                            <strong>{{ entryTitle(e) }}</strong>
                            <p v-if="e.body" class="small summary">{{ e.body }}</p>
                            <button v-if="e.evidence_path" type="button" class="linkish small" @click="openEvidence(e.evidence_path)">📎 {{ e.evidence_name || 'evidence' }}</button>
                        </div>
                        <span class="muted small">{{ names[e.created_by] || 'Staff' }} · {{ when(e.created_at) }}</span>
                    </div>
                </div>
            </article>

            <!-- list -->
            <template v-else>
                <div class="cluster">
                    <input v-model.trim="search" class="input grow" placeholder="Search title, name, #number" />
                    <label class="small"><input v-model="openOnly" type="checkbox" /> Open only</label>
                </div>
                <div v-if="loading" class="skeleton" style="height: 160px"></div>
                <p v-else-if="error" class="error-text">{{ error }}</p>
                <div v-else-if="!visible.length" class="notice">No cases{{ openOnly ? ' open' : '' }}.</div>
                <button v-for="c in visible" :key="c.id" type="button" class="panel pick" @click="select(c)">
                    <span class="muted small">#{{ c.case_number }}</span>
                    <strong class="grow">{{ c.title }}</strong>
                    <span v-if="c.subject_name" class="muted small">{{ c.subject_name }}</span>
                    <span class="chip" :class="statusClass(c.status)">{{ statusLabel(c.status) }}</span>
                    <span class="muted small">{{ when(c.updated_at) }}</span>
                </button>
            </template>
        </template>
    </section>
</template>

<script setup>
    import { computed, onMounted, reactive, ref, watch } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';
    import { CASE_CATEGORIES, CASE_STATUSES, categoryLabel, evidenceLink, myUwxGroups, namesFor, statusLabel, vrcUserId, when } from '../../lib/uwx';

    const SEVERITIES = ['low', 'medium', 'high', 'critical'];
    const groups = ref([]);
    const groupId = ref('');
    const loadingGroups = ref(true);
    const group = computed(() => groups.value.find((g) => g.id === groupId.value) || null);
    const cases = ref([]);
    const loading = ref(false);
    const error = ref('');
    const names = ref({});
    const staff = ref([]);
    const search = ref('');
    const openOnly = ref(true);
    const open = ref(null);
    const entries = ref([]);
    const busy = ref(false);

    onMounted(async () => {
        groups.value = (await myUwxGroups()).filter((g) => g.level >= 2);
        groupId.value = groups.value[0]?.id || '';
        loadingGroups.value = false;
    });
    watch(groupId, () => {
        open.value = null;
        load();
    });

    async function load() {
        if (!groupId.value) return;
        loading.value = true;
        error.value = '';
        const { data, error: err } = await supabase
            .from('uwx_cases')
            .select('id,case_number,title,subject_name,subject_vrc_id,status,severity,assigned_to,created_by,updated_at')
            .eq('group_id', groupId.value)
            .order('updated_at', { ascending: false })
            .limit(500);
        loading.value = false;
        if (err) return (error.value = friendlyError(err));
        cases.value = data || [];
        const { data: st } = await supabase.rpc('uwx_group_staff', { p_group: groupId.value });
        staff.value = st || [];
        names.value = { ...names.value, ...(await namesFor(groupId.value, cases.value.flatMap((c) => [c.created_by, c.assigned_to]))) };
    }

    const visible = computed(() => {
        const q = search.value.toLowerCase();
        return cases.value
            .filter((c) => !openOnly.value || ['open', 'under_review', 'escalated', 'appealed'].includes(c.status))
            .filter((c) => !q || [c.title, c.subject_name, `#${c.case_number}`].some((v) => String(v || '').toLowerCase().includes(q)));
    });

    async function select(c) {
        const [{ data: rows }, { data: ents }] = await Promise.all([
            supabase.from('uwx_cases').select('*').eq('id', c.id).limit(1),
            supabase.from('uwx_case_entries').select('*').eq('case_id', c.id).order('created_at').limit(2000)
        ]);
        open.value = rows?.[0] || null;
        entries.value = ents || [];
        names.value = { ...names.value, ...(await namesFor(groupId.value, entries.value.map((e) => e.created_by).concat(open.value?.created_by))) };
    }

    async function update(patch) {
        const { error: err } = await supabase.from('uwx_cases').update(patch).eq('id', open.value.id);
        if (err) return toast(/assign/i.test(err.message) ? 'Only managers can assign cases to someone else.' : friendlyError(err), 'error');
        await select(open.value);
        load();
    }

    const entryKind = ref('note');
    const actionType = ref('warning');
    const decision = ref('Upheld');
    const noteText = ref('');
    async function addNote() {
        busy.value = true;
        const { data: auth } = await supabase.auth.getUser();
        const row = { case_id: open.value.id, created_by: auth.user.id, kind: entryKind.value, body: noteText.value };
        if (entryKind.value === 'action') Object.assign(row, { action_type: actionType.value, done_in_vrchat: true });
        if (entryKind.value === 'appeal_decision') row.to_value = decision.value;
        const { error: err } = await supabase.from('uwx_case_entries').insert(row);
        busy.value = false;
        if (err) return toast(friendlyError(err), 'error');
        noteText.value = '';
        if (entryKind.value === 'appeal' && open.value.status !== 'appealed') await update({ status: 'appealed' });
        else await select(open.value);
    }

    const creating = ref(false);
    const formError = ref('');
    const draft = reactive({ who: '', name: '', title: '', category: 'other', severity: 'medium', summary: '' });
    function startNew() {
        Object.assign(draft, { who: '', name: '', title: '', category: 'other', severity: 'medium', summary: '' });
        formError.value = '';
        creating.value = true;
    }
    async function create() {
        const id = draft.who ? vrcUserId(draft.who) : '';
        if (draft.who && !id) return (formError.value = 'Use their VRChat profile link or usr_ id, or leave it empty.');
        busy.value = true;
        const { data, error: err } = await supabase
            .from('uwx_cases')
            .insert({ group_id: groupId.value, title: draft.title, summary: draft.summary, category: draft.category, severity: draft.severity, subject_vrc_id: id || null, subject_name: draft.name || null })
            .select('id')
            .single();
        busy.value = false;
        if (err) return (formError.value = friendlyError(err));
        creating.value = false;
        toast('Case created.', 'ok');
        await load();
        await select(data);
    }

    async function openEvidence(path) {
        try {
            window.open(await evidenceLink(path), '_blank', 'noopener');
        } catch (e) {
            toast(friendlyError(e), 'error');
        }
    }

    const statusClass = (s) => (s === 'escalated' ? 'chip-danger' : s === 'resolved' ? 'chip-acid' : '');
    function entryTitle(e) {
        const actions = { warning: 'Warning', kick: 'Removed from group', ban: 'Group ban', unban: 'Unban', instance_kick: 'Instance kick', instance_warn: 'Instance warn', other: 'Action' };
        switch (e.kind) {
            case 'created':
                return 'Case opened';
            case 'status':
                return `Status: ${statusLabel(e.from_value)} → ${statusLabel(e.to_value)}`;
            case 'assignment':
                return e.to_value ? `Assigned to ${names.value[e.to_value] || 'staff'}` : 'Unassigned';
            case 'action':
                return `${actions[e.action_type] || 'Action'} recorded${e.done_in_vrchat ? ' · done in VRChat' : ''}`;
            case 'evidence':
                return 'Evidence attached';
            case 'appeal':
                return 'Appeal received';
            case 'appeal_decision':
                return `Appeal decision: ${e.to_value || ''}`;
            case 'correction':
                return 'Case details corrected';
            case 'share':
                return e.to_value === 'true' ? 'Shared with partner groups' : 'Stopped sharing';
            default:
                return 'Note';
        }
    }
</script>

<style scoped>
    .grid2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
        gap: 12px;
    }
    .between {
        justify-content: space-between;
    }
    .grow {
        flex: 1 1 200px;
        min-width: 0;
    }
    .pick {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        text-align: left;
        cursor: pointer;
        color: var(--text);
        font: inherit;
    }
    .pick:hover {
        border-color: var(--acid);
    }
    .case-title {
        font-size: 22px;
        margin: 0;
    }
    .summary {
        white-space: pre-wrap;
        margin: 0;
    }
    .line {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 6px 12px;
        padding: 10px 0;
        border-top: 1px solid var(--line);
    }
    .linkish {
        background: none;
        border: 0;
        padding: 0;
        color: var(--acid);
        cursor: pointer;
    }
    h3.label {
        margin-bottom: 8px;
    }
</style>
