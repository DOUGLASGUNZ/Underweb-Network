<template>
    <section class="wrap page">
        <p class="eyebrow">FOR CREATORS</p>
        <h1 class="page-title">YOUR WORK, IN THE HUB.</h1>
        <p class="lead">
            DJs, avatar and asset makers, world builders, photographers and video makers. Make an account, get a creator role, and your work shows up on
            the site, in the Discord and on the walls of the UnderWeb hub.
        </p>

        <div class="tabs" role="tablist" aria-label="Kind of creator">
            <button
                v-for="t in CREATOR_TYPES"
                :key="t.id"
                type="button"
                role="tab"
                class="tab"
                :aria-selected="type === t.id"
                @click="type = t.id">
                {{ t.label }}
            </button>
        </div>

        <div class="pitch card card-hi" role="tabpanel">
            <h2>{{ current.pitch }}</h2>
            <ul>
                <li v-for="p in current.perks" :key="p.text">
                    <Icon name="check" :size="20" class="tick" :class="{ soon: p.status === 'soon' }" />
                    <span>{{ p.text }}</span>
                    <span v-if="p.status === 'soon'" class="chip chip-soon">Coming soon</span>
                </li>
            </ul>
        </div>

        <h2 class="section-title how-title">HOW TO GET IN THE HUB</h2>
        <ol class="how">
            <li v-for="(s, i) in how" :key="s.title" class="card">
                <span class="num">{{ i + 1 }}</span>
                <h3>{{ s.title }}</h3>
                <p>{{ s.body }}</p>
            </li>
        </ol>
        <div class="cluster ctas">
            <RouterLink v-if="!account.signedIn.value" to="/signin?new=1&next=/start" class="btn btn-primary btn-lg">Create your free account</RouterLink>
            <RouterLink v-else-if="account.hasAccess.value" to="/roles" class="btn btn-primary btn-lg">Apply for a creator role</RouterLink>
            <RouterLink v-else to="/start" class="btn btn-primary btn-lg">Finish setting up first</RouterLink>
            <RouterLink v-if="account.signedIn.value" to="/me" class="btn btn-lg">Set up my hub card</RouterLink>
        </div>
        <p v-if="account.signedIn.value" class="muted small">
            Showcase uploads are still on the <a :href="`${LEGACY_SITE}/`" rel="noopener">current site ↗</a> while they move over.
        </p>

        <h2 class="section-title dir-title">MEET THE CREATORS</h2>
        <Discover embedded />
    </section>
</template>

<script setup>
    import { computed, ref } from 'vue';
    import Icon from '../components/Icon.vue';
    import Discover from './Discover.vue';
    import { account } from '../lib/account';
    import { CREATOR_TYPES } from '../lib/perks';
    import { LEGACY_SITE } from '../lib/config';

    const type = ref('dj');
    const current = computed(() => CREATOR_TYPES.find((t) => t.id === type.value) || CREATOR_TYPES[0]);

    const how = [
        { title: 'Make an account', body: 'Sign in with Discord or an email code, then verify your VRChat.' },
        { title: 'Get a creator role', body: 'Apply for the role that fits — DJ, avatar creator, world builder, photographer and more. Staff approve it.' },
        { title: 'Add your work + hub card', body: 'Upload a few pieces to your showcase and fill in your hub card. Once staff approve it, the hub shows it within the hour.' }
    ];
</script>

<style scoped>
    .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 32px 0 16px;
    }
    .tab {
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        background: transparent;
        color: var(--text-2);
        font: 700 15px var(--font-ui);
        cursor: pointer;
    }
    .tab[aria-selected='true'] {
        background: var(--acid);
        border-color: var(--acid);
        color: var(--acid-ink);
    }
    .pitch h2 {
        font-size: clamp(28px, 4vw, 36px);
        margin-bottom: 16px;
    }
    .pitch ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .pitch li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        font-size: 16px;
    }
    .pitch li > span:first-of-type {
        flex: 1 1 240px;
    }
    .tick {
        color: var(--acid);
        flex: none;
    }
    .tick.soon {
        color: var(--muted);
    }
    .how-title {
        margin-top: 56px;
    }
    .how {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: 16px;
    }
    .num {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        background: var(--acid-deep);
        color: var(--acid);
        font-family: var(--font-mono);
        font-weight: 700;
    }
    .how h3 {
        margin: 14px 0 6px;
        font-size: 19px;
    }
    .how p {
        margin: 0;
        color: #a9bfb1;
        font-size: 15px;
    }
    .ctas {
        gap: 12px;
        margin: 28px 0 10px;
    }
    .dir-title {
        margin-top: 64px;
    }
</style>
