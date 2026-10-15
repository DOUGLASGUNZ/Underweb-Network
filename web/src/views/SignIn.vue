<template>
    <section class="wrap page signin">
        <div class="card panel">
            <div class="eyebrow">UnderWeb account</div>
            <h1 class="page-title">Sign in</h1>

            <template v-if="step === 'email'">
                <p class="muted">No password. We email you a sign-in code and link. New here? The same step creates your account.</p>
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
    import { onBeforeUnmount, ref, watch } from 'vue';
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

    const next = () => {
        const n = String(route.query.next || '/');
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
    .code {
        font-family: var(--font-mono);
        font-size: 22px;
        letter-spacing: 0.3em;
        text-align: center;
    }
</style>
