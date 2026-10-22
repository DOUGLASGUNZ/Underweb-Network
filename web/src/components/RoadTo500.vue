<template>
    <section v-if="g" class="card road">
        <div class="cluster between">
            <p class="eyebrow">ROAD TO {{ g.member_goal }}</p>
            <span class="muted small">{{ g.name }} · VRChat group</span>
        </div>
        <template v-if="g.member_count !== null">
            <div class="big"><strong>{{ g.member_count }}</strong><span class="muted"> / {{ g.member_goal }} members</span></div>
            <div class="bar"><span :style="{ width: `${pct}%` }"></span></div>
            <p class="muted small">{{ remaining ? `${remaining} to go` : 'Goal reached!' }} · counted {{ ago }} · {{ g.verified_recruits }} verified recruits so far</p>
        </template>
        <p v-else class="muted small">The live count shows up once staff UWX has synced the group.</p>

        <div v-if="board.length" class="board">
            <h3 class="label">Top recruiters</h3>
            <div v-for="(r, i) in board.slice(0, 5)" :key="r.user_id" class="row">
                <span class="rank">{{ i + 1 }}</span>
                <span class="grow">{{ r.display_name || r.username || 'Member' }}</span>
                <strong>{{ r.verified }}</strong>
            </div>
        </div>

        <form class="stack claim" @submit.prevent="submit">
            <h3 class="label">I brought someone in</h3>
            <p class="muted small" style="margin: 0">Paste their VRChat profile link (they don't need an UnderWeb account). Staff check it against the group's join log.</p>
            <div class="cluster">
                <input v-model.trim="who" class="input grow" placeholder="https://vrchat.com/home/user/usr_…" required />
                <input v-model.trim="name" class="input" placeholder="Their name" maxlength="80" />
            </div>
            <input v-model.trim="note" class="input" placeholder="How you met (optional)" maxlength="500" />
            <p v-if="err" class="error-text">{{ err }}</p>
            <button class="btn btn-primary btn-sm" type="submit" :disabled="busy">{{ busy ? 'Sending…' : 'Submit' }}</button>
        </form>

        <div v-if="mine.length" class="board">
            <h3 class="label">Your submissions</h3>
            <div v-for="c in mine" :key="c.id" class="row">
                <span class="grow">{{ c.recruit_name || 'Recruit' }}</span>
                <span class="chip" :class="c.status === 'verified' ? 'chip-acid' : c.status === 'rejected' ? 'chip-danger' : ''">{{ c.status }}</span>
            </div>
        </div>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { supabase, friendlyError } from '../lib/supabase';
    import { toast } from '../lib/toast';
    import { vrcUserId } from '../lib/uwx';

    const g = ref(null);
    const board = ref([]);
    const mine = ref([]);
    const who = ref('');
    const name = ref('');
    const note = ref('');
    const err = ref('');
    const busy = ref(false);

    const remaining = computed(() => Math.max(0, (g.value?.member_goal || 500) - (g.value?.member_count || 0)));
    const pct = computed(() => Math.min(100, ((g.value?.member_count || 0) / (g.value?.member_goal || 500)) * 100));
    const ago = computed(() => {
        const t = Date.parse(g.value?.measured_at || '');
        if (!t) return '';
        const h = Math.round((Date.now() - t) / 3600000);
        return h < 1 ? 'within the hour' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
    });

    async function load() {
        const { data } = await supabase.rpc('uwx_public_progress');
        g.value = data?.[0] || null;
        if (!g.value) return;
        const [{ data: lb }, { data: me }] = await Promise.all([
            supabase.rpc('uwx_recruit_leaderboard', { p_group: g.value.group_id, p_campaign: 'road_to_500' }),
            supabase.auth.getUser()
        ]);
        board.value = (lb || []).filter((r) => r.verified > 0);
        const { data: claims } = await supabase
            .from('uwx_recruit_claims')
            .select('id,recruit_name,status,created_at')
            .eq('group_id', g.value.group_id)
            .eq('recruiter_user_id', me.user?.id)
            .order('created_at', { ascending: false })
            .limit(20);
        mine.value = claims || [];
    }
    onMounted(load);

    async function submit() {
        err.value = '';
        const id = vrcUserId(who.value);
        if (!id) return (err.value = 'That needs to be their VRChat profile link (or usr_ id).');
        busy.value = true;
        const { data: me } = await supabase.auth.getUser();
        const { error } = await supabase
            .from('uwx_recruit_claims')
            .insert({ group_id: g.value.group_id, recruiter_user_id: me.user.id, recruit_vrc_id: id, recruit_name: name.value || null, note: note.value });
        busy.value = false;
        if (error) return (err.value = /duplicate|unique/i.test(error.message) ? 'You already submitted this person.' : friendlyError(error));
        toast('Sent! Staff will verify it.', 'ok');
        who.value = name.value = note.value = '';
        load();
    }
</script>

<style scoped>
    .road .eyebrow {
        margin: 0;
        font-size: 12px;
    }
    .between {
        justify-content: space-between;
    }
    .big strong {
        font-family: var(--font-display, inherit);
        font-size: 44px;
        color: var(--acid);
    }
    .bar {
        height: 10px;
        border-radius: 999px;
        background: var(--line);
        overflow: hidden;
        margin: 8px 0;
    }
    .bar span {
        display: block;
        height: 100%;
        background: var(--acid);
        border-radius: 999px;
    }
    .board,
    .claim {
        margin-top: 18px;
    }
    .row {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 8px 0;
        border-top: 1px solid var(--line);
    }
    .rank {
        width: 22px;
        color: var(--muted);
        font-family: var(--font-mono);
    }
    .grow {
        flex: 1 1 200px;
        min-width: 0;
    }
    h3.label {
        margin-bottom: 6px;
    }
</style>
