<template>
    <section class="wrap page welcome">
        <div class="panel card">
            <div class="eyebrow">Step 1 of 2</div>
            <h1 class="page-title">Set up your profile</h1>
            <p class="muted">This is how people find you on UnderWeb. You can change your display name any time.</p>

            <div v-if="!account.state.profile && !account.state.loading" class="notice notice-caution">
                Your account row hasn't appeared yet. Refresh in a few seconds — if it keeps happening, sign out and back in.
            </div>

            <form class="stack" @submit.prevent="save">
                <label class="field">
                    <span>Username</span>
                    <div class="at-input">
                        <span aria-hidden="true">@</span>
                        <input
                            v-model="username"
                            class="input"
                            autocomplete="username"
                            autocapitalize="none"
                            spellcheck="false"
                            maxlength="24"
                            required
                            :disabled="hasUsername"
                            @input="username = normalize(username)" />
                    </div>
                    <span class="hint">{{ hasUsername ? 'Usernames are permanent.' : '3–24 lowercase letters, numbers or underscores. Permanent once set.' }}</span>
                </label>
                <label class="field">
                    <span>Display name</span>
                    <input v-model.trim="displayName" class="input" maxlength="40" required autocomplete="nickname" />
                    <span class="hint">Use your VRChat name if you want people to recognize you.</span>
                </label>
                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? 'Saving…' : 'Continue' }}</button>
            </form>
        </div>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { supabase, friendlyError } from '../lib/supabase';
    import { account, refreshAccount } from '../lib/account';
    import { toast } from '../lib/toast';

    const route = useRoute();
    const router = useRouter();
    const username = ref('');
    const displayName = ref('');
    const error = ref('');
    const busy = ref(false);
    const hasUsername = computed(() => Boolean(account.state.profile?.username));

    watch(
        () => account.state.profile,
        (p) => {
            if (!p) return;
            if (!username.value) username.value = p.username || '';
            if (!displayName.value) displayName.value = p.display_name || '';
        },
        { immediate: true }
    );

    const normalize = (v) =>
        String(v || '')
            .trim()
            .replace(/^@+/, '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '');

    async function save() {
        error.value = '';
        const u = normalize(username.value);
        if (!/^[a-z0-9_]{3,24}$/.test(u)) {
            error.value = 'Username must be 3–24 lowercase letters, numbers or underscores.';
            return;
        }
        if (!displayName.value || displayName.value.length > 40) {
            error.value = 'Choose a display name (40 characters max).';
            return;
        }
        busy.value = true;
        const { data, error: err } = await supabase
            .from('profiles')
            .update({ username: u, display_name: displayName.value, onboarding_complete: true })
            .eq('id', account.userId.value)
            .select('id')
            .maybeSingle();
        if (!err && data) {
            // Keep a creator profile's name in step, if there is one.
            await supabase.from('creator_profiles').update({ display_name: displayName.value }).eq('user_id', account.userId.value);
        }
        busy.value = false;
        if (err || !data) {
            error.value = err?.code === '23505' ? 'That username is already taken. Try another.' : friendlyError(err, 'Your profile could not be saved. Refresh and try again.');
            return;
        }
        await refreshAccount();
        toast(`Welcome, @${u}.`, 'ok');
        const next = String(route.query.next || '');
        router.replace(next.startsWith('/') && !next.startsWith('//') ? next : account.hasAccess.value ? '/' : '/connections');
    }
</script>

<style scoped>
    .welcome {
        display: flex;
        justify-content: center;
    }
    .card {
        width: 100%;
        max-width: 480px;
        padding: 28px;
    }
    .at-input {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .at-input > span {
        font-family: var(--font-mono);
        color: var(--muted);
    }
</style>
