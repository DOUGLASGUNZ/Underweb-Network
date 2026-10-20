<template>
    <section class="stack">
        <div class="panel-head">
            <h2>People &amp; roles</h2>
        </div>
        <p class="muted small" style="margin: 0">
            Find someone, then give or take away a role. The server decides which roles you're allowed to hand out (Owner and Directors can do most).
            The Owner role itself is protected and can't be given here.
        </p>

        <form class="find" @submit.prevent="search">
            <label class="field grow">
                <span>Find a member</span>
                <input v-model.trim="q" class="input" placeholder="Name or @username" />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="q.length < 2 || searching">{{ searching ? 'Searching…' : 'Find' }}</button>
        </form>
        <p v-if="searchNote" class="muted small">{{ searchNote }}</p>

        <div v-if="results.length && !person" class="stack results">
            <button v-for="r in results" :key="r.user_id" type="button" class="panel pick" @click="open(r)">
                <strong>{{ r.display_name || r.username }}</strong>
                <span v-if="r.username" class="muted small">@{{ r.username }}</span>
            </button>
        </div>

        <article v-if="person" class="panel stack">
            <div class="who">
                <div>
                    <strong class="name">{{ person.display_name || person.username }}</strong>
                    <span v-if="person.username" class="muted small">@{{ person.username }}</span>
                </div>
                <button class="btn btn-sm btn-ghost" type="button" @click="person = null">Back to results</button>
            </div>

            <div>
                <h3 class="label">Current roles</h3>
                <div v-if="loadingRoles" class="skeleton" style="height: 40px"></div>
                <div v-else-if="!roles.length" class="muted small">No active roles.</div>
                <div v-for="r in roles" :key="r.role_slug + r.group_scope" class="role-line">
                    <span class="chip" :class="rank(r.role_slug) >= 55 ? 'chip-acid' : ''">{{ roleName(r.role_slug) }}</span>
                    <span class="muted small">{{ scopeLabel(r.group_scope) }}</span>
                    <button
                        v-if="!['owner', 'member'].includes(r.role_slug)"
                        class="btn btn-sm btn-danger"
                        type="button"
                        :disabled="busy"
                        @click="revoke(r)">
                        Remove
                    </button>
                </div>
            </div>

            <form class="stack give" @submit.prevent="grant">
                <h3 class="label">Give a role</h3>
                <div class="row">
                    <label class="field grow">
                        <span>Role</span>
                        <select v-model="newRole" class="select" required>
                            <option value="" disabled>Choose…</option>
                            <optgroup v-for="g in groupedRoles" :key="g.cat" :label="g.label">
                                <option v-for="d in g.roles" :key="d.slug" :value="d.slug">{{ d.name }}</option>
                            </optgroup>
                        </select>
                    </label>
                    <label class="field">
                        <span>Where</span>
                        <select v-model="newScope" class="select">
                            <option value="network">Whole network</option>
                            <option v-for="[k, l] in SCOPES" :key="k" :value="k">{{ l }}</option>
                        </select>
                    </label>
                </div>
                <label class="field"><span>Reason <small class="muted">(optional, kept in the audit log)</small></span><input v-model.trim="reason" class="input" maxlength="200" /></label>
                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <button class="btn btn-primary" type="submit" :disabled="busy || !newRole">{{ busy ? 'Saving…' : 'Give role' }}</button>
            </form>
        </article>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { SCOPES, scopeLabel } from '../../lib/staff';
    import { toast } from '../../lib/toast';

    const q = ref('');
    const searching = ref(false);
    const searchNote = ref('');
    const results = ref([]);
    const person = ref(null);
    const roles = ref([]);
    const loadingRoles = ref(false);
    const defs = ref([]);
    const newRole = ref('');
    const newScope = ref('network');
    const reason = ref('');
    const busy = ref(false);
    const error = ref('');

    const CAT_LABELS = { leadership: 'Leadership', staff: 'Staff', operations: 'Operations', partner: 'Partners', creator: 'Creators', community: 'Community' };
    const byslug = computed(() => Object.fromEntries(defs.value.map((d) => [d.slug, d])));
    const roleName = (slug) => byslug.value[slug]?.name || slug;
    const rank = (slug) => Number(byslug.value[slug]?.authority_rank || 0);
    const groupedRoles = computed(() => {
        const out = [];
        for (const d of defs.value) {
            if (d.slug === 'owner' || d.slug === 'member') continue;
            let g = out.find((x) => x.cat === d.category);
            if (!g) out.push((g = { cat: d.category, label: CAT_LABELS[d.category] || d.category, roles: [] }));
            g.roles.push(d);
        }
        return out;
    });

    onMounted(async () => {
        const { data } = await supabase.from('role_definitions').select('slug,name,authority_rank,category').eq('active', true).order('authority_rank', { ascending: false });
        defs.value = data || [];
    });

    async function search() {
        searching.value = true;
        person.value = null;
        const { data, error: err } = await supabase.rpc('uw_search_people', { p_query: q.value.replace(/^@/, ''), p_limit: 20 });
        searching.value = false;
        results.value = data || [];
        searchNote.value = err ? friendlyError(err) : results.value.length ? '' : 'Nobody found. They need an UnderWeb account first.';
    }

    async function loadRoles() {
        loadingRoles.value = true;
        const { data } = await supabase.from('user_roles').select('role_slug,group_scope,status').eq('user_id', person.value.user_id).eq('status', 'active');
        roles.value = (data || []).sort((a, b) => rank(b.role_slug) - rank(a.role_slug));
        loadingRoles.value = false;
    }

    function open(r) {
        person.value = r;
        newRole.value = '';
        newScope.value = 'network';
        reason.value = '';
        error.value = '';
        loadRoles();
    }

    async function grant() {
        busy.value = true;
        error.value = '';
        const { error: err } = await supabase.rpc('uw_grant_role', {
            p_user_id: person.value.user_id,
            p_role_slug: newRole.value,
            p_group_scope: newScope.value,
            p_reason: reason.value || null
        });
        busy.value = false;
        if (err) {
            error.value = /permission|not allowed/i.test(err.message) ? `You can't give the ${roleName(newRole.value)} role.` : friendlyError(err);
            return;
        }
        toast(`${roleName(newRole.value)} given to ${person.value.display_name || person.value.username}.`, 'ok');
        newRole.value = '';
        reason.value = '';
        loadRoles();
    }

    async function revoke(r) {
        if (!window.confirm(`Remove ${roleName(r.role_slug)} from ${person.value.display_name || person.value.username}?`)) return;
        busy.value = true;
        const { error: err } = await supabase.rpc('uw_revoke_role', { p_user_id: person.value.user_id, p_role_slug: r.role_slug, p_group_scope: r.group_scope, p_reason: null });
        busy.value = false;
        if (err) return toast(/permission|not allowed/i.test(err.message) ? `You can't remove ${roleName(r.role_slug)}.` : friendlyError(err), 'error');
        toast(`${roleName(r.role_slug)} removed.`, 'ok');
        loadRoles();
    }
</script>

<style scoped>
    .find,
    .give .row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-end;
    }
    .grow {
        flex: 1 1 240px;
    }
    .pick {
        display: flex;
        gap: 10px;
        align-items: baseline;
        text-align: left;
        cursor: pointer;
        color: var(--text);
        font: inherit;
    }
    .pick:hover {
        border-color: var(--acid);
    }
    .who {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
    }
    .name {
        font-size: 20px;
        margin-right: 8px;
    }
    .role-line {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        padding: 8px 0;
        border-top: 1px solid var(--line);
    }
    .role-line .btn {
        margin-left: auto;
    }
    h3.label {
        margin-bottom: 8px;
    }
</style>
