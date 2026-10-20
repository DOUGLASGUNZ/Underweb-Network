<template>
    <section class="wrap page signin">
        <div class="card panel">
            <div class="eyebrow">{{ isNew ? 'Free · 18+' : 'UnderWeb account' }}</div>
            <h1 class="page-title">{{ isNew ? 'Create your account' : 'Sign in' }}</h1>

            <template v-if="step === 'email'">
                <p class="muted">No password to remember. {{ isNew ? 'Already have an account? The same buttons sign you in.' : 'New here? The same buttons create your account.' }}</p>
                <button class="btn btn-discord" type="button" :disabled="busy" @click="discord">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8.5 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
                    Continue with Discord
                </button>
                <div class="or"><span>or use an email code</span></div>
                <form class="stack" @submit.prevent="sendCode">
                    <label class="field">
                        <span>Email</span>
                        <input v-model.trim="email" class="input" type="email" autocomplete="email" inputmode="email" required placeholder="you@example.com" />
                    </label>
                    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                    <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? 'Sending…' : 'Email me a code' }}</button>
                    <p class="hint">By continuing you confirm you're 18 or older.</p>
                </form>
            </template>

            <template v-else>
                <p class="muted">
                    We sent an email to <strong>{{ email }}</strong>. Enter the code from it here, or tap the link in the email — the link works
                    even if it opens in a different browser.
                </p>
                <form class="stack" @submit.prevent="verifyCode">
                    <label class="field">
                        <span>Code</span>
                        <input
                            v-model.trim="code"
                            class="input code"
                            inputmode="numeric"
                            autocomplete="one-time-code"
                            pattern="[0-9]*"
                            maxlength="10"
                            placeholder="123456"
                            required />
                    </label>
                    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                    <button class="btn btn-primary" type="submit" :disabled="busy || code.length < 6">{{ busy ? 'Checking…' : 'Sign in' }}</button>
                    <div class="cluster">
                        <button class="btn btn-ghost btn-sm" type="button" :disabled="busy || cooldown > 0" @click="sendCode">
                            {{ cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email' }}
                        </button>
                        <button class="btn btn-ghost btn-sm" type="button" @click="reset">Use a different email</button>
                    </div>
                </form>
            </template>
        </div>
    </section>
</template>

<script setup>
    import { computed, onBeforeUnmount, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { supabase, authRedirectUrl, friendlyError } from '../lib/supabase';
    import { account } from '../lib/account';

    const route = useRoute();
    const router = useRouter();
    const step = ref('email');
    const email = ref('');
    const code = ref('');
    const error = ref('');
    const busy = ref(false);
    const cooldown = ref(0);
    let cooldownTimer = null;

    const isNew = computed(() => route.query.new === '1');

    async function discord() {
        error.value = '';
        busy.value = true;
        try {
            sessionStorage.setItem('uw_next', next());
        } catch {
            /* ignore */
        }
        const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: authRedirectUrl() } });
        if (err) {
            busy.value = false;
            error.value = friendlyError(err);
        }
    }

    const next = () => {
        const n = String(route.query.next || (isNew.value ? '/start' : '/'));
        return n.startsWith('/') && !n.startsWith('//') ? n : '/';
    };

    // Already signed in (e.g. the email link was opened in this tab)? Go on.
    watch(
        () => account.signedIn.value,
        (signedIn) => {
            if (signedIn) router.replace(next());
        },
        { immediate: true }
    );

    function startCooldown() {
        cooldown.value = 60;
        clearInterval(cooldownTimer);
        cooldownTimer = setInterval(() => {
            cooldown.value -= 1;
            if (cooldown.value <= 0) clearInterval(cooldownTimer);
        }, 1000);
    }
    onBeforeUnmount(() => clearInterval(cooldownTimer));

    async function sendCode() {
        error.value = '';
        if (!/^\S+@\S+\.\S+$/.test(email.value)) {
            error.value = 'Enter a valid email address.';
            return;
        }
        busy.value = true;
        try {
            sessionStorage.setItem('uw_next', next());
        } catch {
            /* ignore */
        }
        const { error: err } = await supabase.auth.signInWithOtp({
            email: email.value,
            options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: true }
        });
        busy.value = false;
        if (err) {
            error.value = friendlyError(err);
            return;
        }
        step.value = 'code';
        startCooldown();
    }

    async function verifyCode() {
        error.value = '';
        busy.value = true;
        const { error: err } = await supabase.auth.verifyOtp({ email: email.value, token: code.value, type: 'email' });
        busy.value = false;
        if (err) {
            error.value = /expired|invalid/i.test(err.message) ? 'That code is wrong or expired. Check the newest email, or resend.' : friendlyError(err);
        }
        // success → onAuthStateChange loads the account → the watcher above navigates
    }

    function reset() {
        step.value = 'email';
        code.value = '';
        error.value = '';
    }
</script>

<style scoped>
    .signin {
        display: flex;
        justify-content: center;
    }
    .card {
        width: 100%;
        max-width: 440px;
        padding: 28px;
    }
    .btn-discord {
        width: 100%;
        min-height: 50px;
        background: #5865f2;
        border-color: #5865f2;
        color: #fff;
        margin: 8px 0 4px;
    }
    .btn-discord:hover {
        background: #4752c4;
        color: #fff;
    }
    .or {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 16px 0;
        color: var(--muted);
        font-size: 13px;
    }
    .or::before,
    .or::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--line);
    }
    .code {
        font-family: var(--font-mono);
        font-size: 22px;
        letter-spacing: 0.3em;
        text-align: center;
    }
</style>
