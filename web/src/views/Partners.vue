<template>
    <section class="wrap page narrow">
        <p class="eyebrow">UWX MODERATION NETWORK</p>
        <h1 class="page-title">Partner groups</h1>
        <p class="muted">
            Run a VRChat group? The UWX Moderation Network lets participating groups <strong>choose</strong> to share moderation cases with each other — so a known crasher
            or harasser doesn't get a clean slate in the next group. You stay in control:
        </p>
        <ul class="muted list">
            <li>Your cases stay yours. You pick which groups see which cases, and how much (summary or detail). Evidence is never shared.</li>
            <li>Nobody is banned automatically because of another group's report — it's context for your moderators, not a verdict.</li>
            <li>Every lookup is logged, and you can stop sharing at any time.</li>
            <li>Your staff use UWX (our desktop app) with their own VRChat accounts. Nobody's VRChat login ever leaves their PC.</li>
        </ul>

        <div v-if="!account.signedIn.value" class="card">
            <p>Sign in with an UnderWeb account to apply.</p>
            <RouterLink to="/signin" class="btn btn-primary">Sign in</RouterLink>
        </div>

        <template v-else>
            <div v-for="a in mine" :key="a.id" class="card status">
                <strong>{{ a.group_name }}</strong>
                <span class="chip" :class="a.status === 'approved' ? 'chip-acid' : a.status === 'rejected' ? 'chip-danger' : ''">{{ a.status }}</span>
                <p v-if="a.status === 'approved'" class="muted small">You're the group's owner in UWX → Group Intel. Add your moderators under Settings & sharing → People with direct access.</p>
                <p v-if="a.review_note" class="muted small">“{{ a.review_note }}”</p>
            </div>

            <form v-if="!mine.some((a) => a.status === 'pending')" class="card stack" @submit.prevent="apply">
                <h2>Apply</h2>
                <label class="field"><span>VRChat group link or grp_ id</span><input v-model.trim="form.group" class="input" required placeholder="https://vrchat.com/home/group/grp_…" /></label>
                <label class="field"><span>Group name</span><input v-model.trim="form.name" class="input" required minlength="2" maxlength="80" /></label>
                <div class="cluster">
                    <label class="field grow"><span>Your role in it</span><input v-model.trim="form.role" class="input" maxlength="80" placeholder="Owner" /></label>
                    <label class="field"><span>Members (about)</span><input v-model.number="form.members" type="number" min="0" class="input" /></label>
                </div>
                <label class="field"><span>Why do you want in?</span><textarea v-model="form.reason" class="input" rows="4" maxlength="1000"></textarea></label>
                <p v-if="err" class="error-text">{{ err }}</p>
                <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? 'Sending…' : 'Send application' }}</button>
            </form>
        </template>
    </section>
</template>

<script setup>
    import { onMounted, reactive, ref } from 'vue';
    import { supabase, friendlyError } from '../lib/supabase';
    import { account, whenAccountReady } from '../lib/account';
    import { toast } from '../lib/toast';

    const mine = ref([]);
    const form = reactive({ group: '', name: '', role: '', members: null, reason: '' });
    const err = ref('');
    const busy = ref(false);

    async function load() {
        if (!account.signedIn.value) return;
        const { data } = await supabase.from('uwx_group_applications').select('*').eq('applicant', account.userId.value).order('created_at', { ascending: false });
        mine.value = data || [];
    }
    onMounted(async () => {
        await whenAccountReady();
        load();
    });

    async function apply() {
        err.value = '';
        const m = form.group.match(/grp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (!m) return (err.value = 'Paste your VRChat group link — it contains grp_…');
        busy.value = true;
        const { error } = await supabase.from('uwx_group_applications').insert({
            vrchat_group_id: m[0].toLowerCase(),
            group_name: form.name,
            applicant: account.userId.value,
            applicant_role: form.role,
            member_count: Number.isFinite(form.members) ? form.members : null,
            reason: form.reason
        });
        busy.value = false;
        if (error) return (err.value = /duplicate|unique/i.test(error.message) ? 'That group already has an application waiting.' : friendlyError(error));
        toast('Application sent. UnderWeb leadership will review it.', 'ok');
        load();
    }
</script>

<style scoped>
    .narrow {
        max-width: 760px;
    }
    .list {
        line-height: 1.7;
        margin: 12px 0 24px;
    }
    .status {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin-bottom: 12px;
    }
    .status p {
        flex-basis: 100%;
        margin: 0;
    }
    .grow {
        flex: 1 1 220px;
    }
</style>
