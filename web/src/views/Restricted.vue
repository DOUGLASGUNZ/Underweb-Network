<template>
    <section class="wrap page">
        <div class="panel notice-danger" style="max-width: 560px">
            <div class="eyebrow" style="color: #ff8a93">Account restricted</div>
            <h1 class="page-title">{{ title }}</h1>
            <p v-if="r?.reason">Reason: {{ r.reason }}</p>
            <p class="muted">
                {{ r?.expires_at ? `This ends ${formatDateTime(r.expires_at)}.` : 'This does not expire on its own.' }}
                You can't use member features until then. If you think this is a mistake, contact UnderWeb staff on Discord.
            </p>
            <button class="btn" type="button" @click="out">Sign out</button>
        </div>
    </section>
</template>

<script setup>
    import { computed, watch } from 'vue';
    import { useRouter } from 'vue-router';
    import { account, signOut } from '../lib/account';
    import { formatDateTime } from '../lib/format';

    const router = useRouter();
    const r = computed(() => account.state.restriction);
    const title = computed(() => (String(r.value?.restriction_type).toLowerCase() === 'ban' ? 'You are banned from UnderWeb' : 'Your account is suspended'));
    watch(
        () => account.isBanned.value,
        (banned) => {
            if (!banned && !account.state.loading) router.replace('/');
        }
    );
    async function out() {
        await signOut();
        router.replace('/');
    }
</script>
