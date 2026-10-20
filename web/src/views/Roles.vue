<template>
    <section class="wrap page">
        <div class="eyebrow">Your roles</div>
        <h1 class="page-title">Roles & applications</h1>
        <p class="muted intro">Apply for creator, staff or partner roles. Staff review each application; approved roles show on your profile and sync to Discord.</p>

        <div class="cluster current">
            <span class="label">You have</span>
            <RoleChip v-for="r in account.state.roles" :key="r.slug" :role="r" />
            <span v-if="!account.state.roles.length" class="muted small">No roles yet</span>
        </div>

        <section v-if="mine.length" class="panel mine" aria-labelledby="mine-h">
            <h2 id="mine-h" class="label">Your applications</h2>
            <div v-for="a in mine" :key="a.id" class="row-line app">
                <div>
                    <strong>{{ nameFor(a.role_slug) }}</strong>
                    <span class="muted small"> · {{ formatDate(a.submitted_at) }}</span>
                    <p v-if="a.review_note" class="muted small note">Staff note: {{ a.review_note }}</p>
                </div>
                <div class="cluster">
                    <span class="chip" :class="statusChip(a.status)">{{ a.status }}</span>
                    <button v-if="['pending', 'reviewing'].includes(a.status)" class="btn btn-sm btn-ghost" type="button" @click="withdraw(a)">Withdraw</button>
                </div>
            </div>
        </section>

        <div v-if="loading" class="skeleton" style="height: 200px"></div>
        <template v-else>
            <section v-for="group in groups" :key="group.category" class="cat" :aria-labelledby="'cat-' + group.category">
                <h2 :id="'cat-' + group.category" class="cat-h">{{ categoryLabel(group.category) }}</h2>
                <div class="roles">
                    <article v-for="r in group.roles" :key="r.slug" class="panel role">
                        <div class="role-head">
                            <strong>{{ r.name }}</strong>
                            <span v-if="account.has(r.slug)" class="chip chip-acid">You have this</span>
                            <span v-else-if="openFor(r.slug)" class="chip chip-caution">Applied</span>
                        </div>
                        <p class="muted small">{{ r.description || '—' }}</p>
                        <template v-if="!account.has(r.slug) && !openFor(r.slug)">
                            <div v-if="applying === r.slug" class="stack">
                                <label class="field">
                                    <span>Why you, in a few lines</span>
                                    <textarea v-model="note" class="textarea" maxlength="1000" placeholder="Experience, links to your work, when you're usually on…"></textarea>
                                </label>
                                <div class="cluster">
                                    <button class="btn btn-sm btn-primary" type="button" :disabled="busy || note.trim().length < 10" @click="apply(r)">Send application</button>
                                    <button class="btn btn-sm btn-ghost" type="button" @click="applying = ''">Cancel</button>
                                </div>
                            </div>
                            <button v-else class="btn btn-sm" type="button" @click="startApply(r)">Apply</button>
                        </template>
                    </article>
                </div>
            </section>
        </template>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import RoleChip from '../components/RoleChip.vue';
    import { supabase, friendlyError } from '../lib/supabase';
    import { account, refreshAccount } from '../lib/account';
    import { formatDate } from '../lib/format';
    import { toast } from '../lib/toast';

    const defs = ref([]);
    const mine = ref([]);
    const loading = ref(true);
    const busy = ref(false);
    const applying = ref('');
    const note = ref('');

    const ORDER = ['creator', 'staff', 'operations', 'partner', 'community'];
    const categoryLabel = (c) => ({ creator: 'Creators & performers', staff: 'Staff', operations: 'Event operations', partner: 'Partners', community: 'Community' })[c] || c;
    const groups = computed(() =>
        ORDER.map((category) => ({ category, roles: defs.value.filter((d) => d.category === category) })).filter((g) => g.roles.length)
    );
    const nameFor = (slug) => defs.value.find((d) => d.slug === slug)?.name || String(slug).replace(/_/g, ' ');
    const openFor = (slug) => mine.value.some((a) => a.role_slug === slug && ['pending', 'reviewing'].includes(a.status));
    const statusChip = (s) => (s === 'accepted' ? 'chip-acid' : s === 'denied' ? 'chip-danger' : 'chip-caution');

    async function load() {
        const [d, m] = await Promise.all([
            supabase.from('role_definitions').select('slug,name,category,description,authority_rank').eq('is_application_role', true).order('authority_rank', { ascending: false }).order('name'),
            supabase.from('role_applications').select('*').eq('user_id', account.userId.value).order('submitted_at', { ascending: false })
        ]);
        defs.value = d.data || [];
        mine.value = m.data || [];
        loading.value = false;
    }

    function startApply(r) {
        applying.value = r.slug;
        note.value = '';
    }

    async function apply(r) {
        busy.value = true;
        const { error } = await supabase
            .from('role_applications')
            .insert({ user_id: account.userId.value, role_slug: r.slug, group_scope: 'underweb', applicant_note: note.value.trim(), status: 'pending' });
        busy.value = false;
        if (error) {
            toast(/row-level security/i.test(error.message) ? 'You need a verified VRChat account to apply.' : friendlyError(error), 'error');
            return;
        }
        toast(`Applied for ${r.name}. Staff will review it.`, 'ok');
        applying.value = '';
        await load();
    }

    async function withdraw(a) {
        if (!window.confirm(`Withdraw your ${nameFor(a.role_slug)} application?`)) return;
        const { error } = await supabase.rpc('uw_withdraw_role_application', { p_application_id: a.id });
        if (error) {
            toast(friendlyError(error), 'error');
            return;
        }
        toast('Application withdrawn.', 'ok');
        await Promise.all([load(), refreshAccount()]);
    }

    onMounted(load);
</script>

<style scoped>
    .intro {
        max-width: 640px;
    }
    .current {
        margin: 12px 0 20px;
    }
    .mine {
        margin-bottom: 24px;
    }
    .app {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
    }
    .note {
        margin: 4px 0 0;
    }
    .cat {
        margin-top: 24px;
    }
    .cat-h {
        font-size: 20px;
        margin-bottom: 12px;
    }
    .roles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
        gap: 12px;
    }
    .role {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .role-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
    }
    .role p {
        margin: 0;
        flex: 1;
    }
</style>
