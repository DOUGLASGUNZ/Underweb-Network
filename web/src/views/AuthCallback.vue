<template>
    <section class="wrap page">
        <div class="panel" style="max-width: 440px; margin: 0 auto">
            <template v-if="error">
                <h1 class="page-title">Sign-in link didn't work</h1>
                <p class="muted">{{ error }}</p>
                <RouterLink to="/signin" class="btn btn-primary">Get a new code</RouterLink>
            </template>
            <template v-else>
                <h1 class="page-title">Signing you in…</h1>
                <div class="skeleton" style="height: 8px; margin-top: 16px"></div>
            </template>
        </div>
    </section>
</template>

<script setup>
    import { onMounted, ref, watch } from 'vue';
    import { useRouter } from 'vue-router';
    import { account } from '../lib/account';

    const router = useRouter();
    const error = ref('');

    function destination() {
        let next = '/';
        try {
            next = sessionStorage.getItem('uw_next') || '/';
            sessionStorage.removeItem('uw_next');
        } catch {
            /* ignore */
        }
        return next.startsWith('/') && !next.startsWith('//') ? next : '/';
    }

    onMounted(() => {
        // Supabase puts errors in the hash or query when a link is expired or reused.
        const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
        const desc = params.get('error_description');
        if (desc) {
            error.value = /expired|invalid/i.test(desc) ? 'That link has expired or was already used. Links work once and expire after an hour.' : desc;
            return;
        }
        setTimeout(() => {
            if (!account.signedIn.value && !error.value) error.value = "We couldn't confirm your sign-in. Try entering the code instead.";
        }, 8000);
    });

    watch(
        () => account.signedIn.value && !account.state.loading,
        (ready) => {
            if (ready) router.replace(destination());
        },
        { immediate: true }
    );
</script>
