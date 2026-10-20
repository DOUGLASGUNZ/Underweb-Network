<template>
    <section class="wrap page">
        <p class="eyebrow">PHOTOS &amp; ART</p>
        <h1 class="page-title">GALLERY</h1>
        <p class="lead">Shots and art from UnderWeb nights. Every piece is approved by staff before it shows up here, in the Discord or on the hub wall.</p>

        <div v-if="!member" class="notice notice-acid lock">
            <div>
                <strong>{{ account.signedIn.value ? 'Verify your VRChat to see every photo.' : "You're seeing the hub wall." }}</strong>
                <p class="muted small" style="margin: 2px 0 0">Members see everything staff approved, and can post their own.</p>
            </div>
            <RouterLink :to="account.signedIn.value ? '/start' : '/signin?new=1&next=/gallery'" class="btn btn-primary btn-sm">
                {{ account.signedIn.value ? 'Finish setup' : 'Create account' }}
            </RouterLink>
        </div>

        <div class="grid-wrap">
            <GalleryGrid :items="items" :loading="loading" :placeholders="6" />
        </div>

        <section class="card post">
            <h2>POST YOUR OWN</h2>
            <ol>
                <li><strong>On the site:</strong> My UnderWeb → Your photos &amp; work → choose a photo.</li>
                <li><strong>From VRChat:</strong> with UWX running, take a photo — UWX offers to send it.</li>
                <li>Tick where it goes: the gallery and hub wall, the Discord, or both. Staff approve it and it goes up.</li>
            </ol>
            <RouterLink :to="account.signedIn.value ? '/me#photos' : '/signin?new=1&next=/me'" class="btn btn-primary">
                {{ account.signedIn.value ? 'Post a photo' : 'Make an account to post' }}
            </RouterLink>
        </section>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import GalleryGrid from '../components/GalleryGrid.vue';
    import { account } from '../lib/account';
    import { galleryItems } from '../lib/community';

    const member = computed(() => account.signedIn.value && account.hasAccess.value);
    const items = ref([]);
    const loading = ref(true);

    async function load() {
        if (account.state.loading) return;
        loading.value = true;
        items.value = await galleryItems(48).catch(() => []);
        loading.value = false;
    }
    watch(() => [account.state.loading, member.value], load, { immediate: true });
</script>

<style scoped>
    .lock {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 20px;
    }
    .grid-wrap {
        margin-top: 28px;
    }
    .post {
        margin-top: 40px;
        max-width: 720px;
    }
    .post h2 {
        font-size: 28px;
        margin-bottom: 10px;
    }
    .post .btn {
        margin-top: 16px;
    }
    .post ol {
        margin: 0;
        padding-left: 20px;
        color: var(--text-2);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
</style>
