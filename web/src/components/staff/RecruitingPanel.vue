<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Road to 500 · recruit claims</h2>
            <div class="cluster">
                <select v-if="groups.length > 1" v-model="groupId" class="select" aria-label="Group">
                    <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
                <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
            </div>
        </div>
        <p class="muted small" style="margin: 0">
            Members say who they brought in; you confirm it. Evidence below comes from the VRChat group audit log that UWX staff clients sync — a join by that person and any
            group invite sent to them. It helps you decide; nothing is credited automatically, and nobody can verify their own claim.
        </p>

        <div v-if="loadingGroups" class="skeleton" style="height: 120px"></div>
        <div v-else-if="!group" class="notice">Verifying recruits needs Manager access to a registered group (Admins and up by default).</div>
        <template v-else>
            <div v-if="loading" class="skeleton" style="height: 120px"></div>
            <p v-else-if="error" class="error-text">{{ error }}</p>
            <div v-else-if="!claims.length" class="notice">No claims waiting.</div>
            <article v-for="c in claims" :key="c.id" class="panel claim">
                <div class="grow">
                    <strong>{{ c.recruit_name || 'Unnamed recruit' }}</strong>
                    <a :href="`https://vrchat.com/home/user/${c.recruit_vrc_id}`" target="_blank" rel="noopener" class="small"> VRChat profile ↗</a>
                    <p class="muted small">claimed by {{ names[c.recruiter_user_id] || 'a member' }} · {{ when(c.created_at) }}</p>
                    <p v-if="c.note" class="small">“{{ c.note }}”</p>
                    <p class="small">
                        <span v-if="c.evidence?.joinedAt" class="ok">✓ Joined the group {{ when(c.evidence.joinedAt) }} (audit log)</span>
                        <span v-else class="warn">? No join found in the synced audit log</span>
                        <template v-if="c.evidence?.invitedBy?.length"> · group invite from {{ c.evidence.invitedBy.join(', ') }}</template>
                    </p>
                    <button v-if="c.evidence_path" type="button" class="linkish small" @click="openEvidence(c.evidence_path)">📎 View screenshot</button>
                </div>
                <div class="cluster">
                    <button class="btn btn-sm btn-primary" type="button" :disabled="busy === c.id || c.recruiter_user_id === me" @click="review(c, true)">Verify</button>
                    <button class="btn btn-sm btn-ghost" type="button" :disabled="busy === c.id || c.recruiter_user_id === me" @click="review(c, false)">Reject</button>
                    <span v-if="c.recruiter_user_id === me" class="muted small">your own claim</span>
                </div>
            </article>

            <div>
                <h3 class="label">Leaderboard (verified)</h3>
                <div v-if="!board.length" class="muted small">Nobody yet.</div>
                <div v-for="(r, i) in board" :key="r.user_id" class="row">
                    <span class="rank">{{ i + 1 }}</span>
                    <span class="grow">{{ r.display_name || r.username || 'Member' }}</span>
                    <strong>{{ r.verified }}</strong>
                    <span class="muted small">{{ r.pending }} pending</span>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { toast } from '../../lib/toast';
    import { evidenceLink, myUwxGroups, namesFor, when } from '../../lib/uwx';

    const emit = defineEmits(['count']);
    const groups = ref([]);
    const groupId = ref('');
    const loadingGroups = ref(true);
    const group = computed(() => groups.value.find((g) => g.id === groupId.value) || null);
    const claims = ref([]);
    const board = ref([]);
    const names = ref({});
    const loading = ref(false);
    const error = ref('');
    const busy = ref('');
    const me = ref('');

    onMounted(async () => {
        me.value = (await supabase.auth.getUser()).data.user?.id || '';
        groups.value = (await myUwxGroups()).filter((g) => g.level >= 3);
        groupId.value = groups.value[0]?.id || '';
        loadingGroups.value = false;
    });
    watch(groupId, () => load());

    async function evidenceFor(recruitId) {
        const { data } = await supabase
            .from('uwx_group_events')
            .select('event_type,occurred_at,actor_name,actor_vrc_id,target_vrc_id')
            .eq('group_id', groupId.value)
            .in('event_type', ['group.member.join', 'group.invite.create'])
            .or(`actor_vrc_id.eq.${recruitId},target_vrc_id.eq.${recruitId}`)
            .order('occurred_at')
            .limit(50);
        const rows = data || [];
        const join = rows.find((r) => r.event_type === 'group.member.join');
        return {
            joinedAt: join ? Date.parse(join.occurred_at) : 0,
            invitedBy: [...new Set(rows.filter((r) => r.event_type === 'group.invite.create' && r.target_vrc_id === recruitId).map((r) => r.actor_name || 'staff'))]
        };
    }

    async function load() {
        if (!groupId.value) return;
        loading.value = true;
        error.value = '';
        const [{ data, error: err }, { data: lb }] = await Promise.all([
            supabase
                .from('uwx_recruit_claims')
                .select('id,recruiter_user_id,recruit_vrc_id,recruit_name,note,evidence_path,created_at')
                .eq('group_id', groupId.value)
                .eq('status', 'pending')
                .order('created_at')
                .limit(200),
            supabase.rpc('uwx_recruit_leaderboard', { p_group: groupId.value, p_campaign: 'road_to_500' })
        ]);
        loading.value = false;
        if (err) return (error.value = friendlyError(err));
        board.value = lb || [];
        const list = data || [];
        names.value = await namesFor(groupId.value, list.map((c) => c.recruiter_user_id));
        claims.value = await Promise.all(list.map(async (c) => ({ ...c, evidence: await evidenceFor(c.recruit_vrc_id) })));
        emit('count', claims.value.length);
    }

    async function review(c, verify) {
        const who = c.recruit_name || 'this person';
        if (!window.confirm(verify ? `Credit ${names.value[c.recruiter_user_id] || 'this member'} for recruiting ${who}?` : `Reject the claim for ${who}?`)) return;
        busy.value = c.id;
        const { error: err } = await supabase.rpc('uwx_review_recruit_claim', { p_claim: c.id, p_verify: verify, p_note: null });
        busy.value = '';
        if (err) return toast(friendlyError(err), 'error');
        toast(verify ? 'Verified.' : 'Rejected.', 'ok');
        load();
    }

    async function openEvidence(path) {
        try {
            window.open(await evidenceLink(path), '_blank', 'noopener');
        } catch (e) {
            toast(friendlyError(e), 'error');
        }
    }
</script>

<style scoped>
    .claim {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-start;
    }
    .claim p {
        margin: 4px 0 0;
    }
    .grow {
        flex: 1 1 240px;
        min-width: 0;
    }
    .ok {
        color: var(--acid);
    }
    .warn {
        color: var(--caution);
    }
    .row {
        display: flex;
        gap: 12px;
        align-items: baseline;
        padding: 8px 0;
        border-top: 1px solid var(--line);
    }
    .rank {
        width: 24px;
        color: var(--muted);
        font-family: var(--font-mono);
    }
    .linkish {
        background: none;
        border: 0;
        padding: 0;
        color: var(--acid);
        cursor: pointer;
    }
    h3.label {
        margin: 12px 0 8px;
    }
</style>
