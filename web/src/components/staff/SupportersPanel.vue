<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Supporters</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
        </div>
        <p class="muted small" style="margin: 0">
            Who gets UWX updates (and Inner Web perks): active Patreon supporters, people you add here, and staff. Owner only.
        </p>

        <div v-if="loading" class="skeleton" style="height: 160px"></div>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <template v-else>
            <div class="cluster status">
                <span class="chip" :class="configured.webhook ? 'chip-acid' : ''">Patreon webhook {{ configured.webhook ? 'on' : 'not set up' }}</span>
                <span class="chip" :class="configured.sync ? 'chip-acid' : ''">Patreon sync {{ configured.sync ? 'on' : 'not set up' }}</span>
                <button v-if="configured.sync" class="btn btn-sm" type="button" :disabled="busy" @click="sync">{{ busy === 'sync' ? 'Syncing…' : 'Sync from Patreon now' }}</button>
            </div>

            <form class="panel stack grant" @submit.prevent="grant">
                <h3 class="label">Add a supporter by hand</h3>
                <p class="muted small" style="margin: 0">For comps, friends, or a patron who can't be matched. Patreon never overrides these.</p>
                <div class="row">
                    <label class="field grow"><span>UnderWeb username</span><input v-model.trim="username" class="input" placeholder="@username" required /></label>
                    <label class="field">
                        <span>Tier</span>
                        <select v-model="tier" class="select">
                            <option value="connected">Connected</option>
                            <option value="signal">Signal</option>
                        </select>
                    </label>
                    <button class="btn btn-primary" type="submit" :disabled="busy === 'grant'">Add</button>
                </div>
            </form>

            <div>
                <h3 class="label">Memberships ({{ memberships.length }})</h3>
                <div v-if="!memberships.length" class="notice">Nobody yet.</div>
                <div v-for="m in memberships" :key="m.user_id" class="line">
                    <div class="who">
                        <strong>{{ m.account?.name || 'Unknown account' }}</strong>
                        <span v-if="m.account?.username" class="muted small">@{{ m.account.username }}</span>
                    </div>
                    <span class="chip">{{ m.provider || '—' }}</span>
                    <span class="chip">{{ m.tier }}</span>
                    <span class="chip" :class="m.status === 'active' ? 'chip-acid' : m.status === 'cancelled' ? 'chip-danger' : ''">{{ m.status }}</span>
                    <button
                        v-if="m.status === 'active' && m.tier !== 'owner'"
                        class="btn btn-sm btn-danger"
                        type="button"
                        :disabled="busy === m.user_id"
                        @click="revoke(m)">
                        Remove
                    </button>
                </div>
            </div>

            <div>
                <h3 class="label">From Patreon ({{ patrons.length }})</h3>
                <div v-if="!patrons.length" class="notice">No patrons yet. They show up here once the Patreon webhook or sync is set up.</div>
                <div v-for="p in patrons" :key="p.member_id" class="line">
                    <div class="who">
                        <strong>{{ p.full_name || 'Patron' }}</strong>
                        <span class="muted small">{{ (p.tier_titles || []).join(', ') || 'no tier' }}</span>
                    </div>
                    <span class="chip" :class="p.patron_status === 'active_patron' ? 'chip-acid' : ''">{{ patronLabel(p.patron_status) }}</span>
                    <span v-if="p.account" class="small">→ {{ p.account.name }}<template v-if="p.account.username"> (@{{ p.account.username }})</template></span>
                    <span v-else class="small warn">Not matched — they need to link the same Discord on UnderWeb, or use the same email</span>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';

    const loading = ref(true);
    const error = ref('');
    const busy = ref('');
    const configured = ref({ webhook: false, sync: false });
    const memberships = ref([]);
    const patrons = ref([]);
    const username = ref('');
    const tier = ref('connected');

    const patronLabel = (s) => ({ active_patron: 'Active', declined_patron: 'Payment declined', former_patron: 'Former' })[s] || 'Unknown';

    async function call(path, method = 'POST', body) {
        const { data, error: err } = await supabase.functions.invoke(`supporters/${path}`, { method, body });
        if (err) {
            let msg = '';
            try {
                const j = await err.context?.json();
                msg = j?.message || j?.error || '';
            } catch {
                /* no body */
            }
            throw new Error(msg || friendlyError(err));
        }
        return data;
    }

    async function load() {
        loading.value = true;
        error.value = '';
        try {
            const d = await call('list', 'GET');
            configured.value = d.configured || configured.value;
            memberships.value = d.memberships || [];
            patrons.value = d.patrons || [];
        } catch (e) {
            error.value = /owner_only/.test(e.message) ? 'Supporters are managed by the Owner.' : /patreon_members/.test(e.message) ? 'One database step is still needed (patreon_members table).' : e.message;
        }
        loading.value = false;
    }
    onMounted(load);

    async function run(key, fn, ok) {
        busy.value = key;
        try {
            const r = await fn();
            toast(typeof ok === 'function' ? ok(r) : ok, 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'error');
        }
        busy.value = '';
    }
    const grant = () =>
        run('grant', () => call('grant', 'POST', { username: username.value, tier: tier.value }), () => {
            const name = username.value;
            username.value = '';
            return `${name} can now get UWX.`;
        });
    const revoke = (m) => {
        if (!window.confirm(`Remove ${m.account?.name || 'this person'} as a supporter? They stop getting UWX updates.`)) return;
        run(m.user_id, () => call('revoke', 'POST', { user_id: m.user_id }), 'Removed.');
    };
    const sync = () => run('sync', () => call('sync'), (r) => `Synced ${r.seen} patrons (${r.active} active, ${r.matched} matched).`);
</script>

<style scoped>
    .status {
        gap: 10px;
    }
    .grant .row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-end;
    }
    .grow {
        flex: 1 1 220px;
    }
    .line {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        padding: 12px 0;
        border-top: 1px solid var(--line);
    }
    .who {
        flex: 1 1 220px;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .warn {
        color: var(--caution);
    }
    h3.label {
        margin-bottom: 8px;
    }
</style>
