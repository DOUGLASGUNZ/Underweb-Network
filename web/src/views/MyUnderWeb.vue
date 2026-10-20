<template>
    <section class="wrap page">
        <!-- Who you are -->
        <div class="me-head">
            <Avatar :src="account.state.profile?.avatar_url" :name="account.displayName.value" :size="88" />
            <div class="who">
                <p class="eyebrow">MY UNDERWEB</p>
                <h1>{{ account.displayName.value }}</h1>
                <div class="cluster">
                    <span v-if="account.state.profile?.username" class="muted">@{{ account.state.profile.username }}</span>
                    <RoleChip v-for="r in account.state.roles.slice(0, 4)" :key="r.slug" :role="r" />
                </div>
            </div>
            <div class="cluster actions">
                <RouterLink v-if="account.state.profile?.username" :to="`/u/${account.state.profile.username}`" class="btn btn-sm">View my profile</RouterLink>
                <RouterLink to="/me/edit" class="btn btn-sm">Edit profile</RouterLink>
                <RouterLink to="/connections" class="btn btn-sm">Connected accounts</RouterLink>
            </div>
        </div>

        <!-- Setup left to do -->
        <div v-if="setup && setupLeft" class="setup card card-hi">
            <div>
                <strong>{{ setupLeft }} setup {{ setupLeft === 1 ? 'step' : 'steps' }} left</strong>
                <p class="muted small">{{ nextStepText }}</p>
            </div>
            <RouterLink to="/start" class="btn btn-primary">Finish setting up</RouterLink>
        </div>

        <div class="grid">
            <div class="main">
                <!-- Creators: hub card. Everyone else: how to become one. -->
                <HubCardPanel v-if="isCreator" />
                <section v-else class="card become">
                    <p class="eyebrow">MAKE THINGS?</p>
                    <h2>GET YOUR WORK IN THE HUB</h2>
                    <p class="muted">
                        DJs, avatar and asset makers, world builders, photographers and video makers get a showcase, a card in the hub's Creator Room and a
                        shot at the weekly feature.
                    </p>
                    <div class="cluster">
                        <RouterLink v-if="account.hasAccess.value" to="/roles" class="btn btn-primary">Apply for a creator role</RouterLink>
                        <RouterLink v-else to="/start" class="btn btn-primary">Verify your VRChat first</RouterLink>
                        <RouterLink to="/creators" class="btn">What creators get</RouterLink>
                    </div>
                </section>

                <MyPhotos />

                <!-- Perks -->
                <section class="perks-sec">
                    <h2 class="sub">YOUR PERKS</h2>
                    <div class="perks">
                        <div v-for="p in perks" :key="p.id" class="perk" :class="{ live: p.status === 'live' }">
                            <Icon :name="p.icon" :size="24" class="ic" />
                            <div>
                                <div class="cluster">
                                    <strong>{{ p.title }}</strong>
                                    <span v-if="p.status === 'soon'" class="chip chip-soon">Coming soon</span>
                                </div>
                                <p class="muted small">{{ p.body }}</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <aside class="side">
                <NextEventCard :event="next" :loading="nextLoading" />
                <section class="card links">
                    <h2 class="sub small-sub">SHORTCUTS</h2>
                    <RouterLink to="/gallery">Gallery — post and browse photos</RouterLink>
                    <RouterLink v-if="account.hasAccess.value" to="/roles">Roles &amp; applications</RouterLink>
                    <RouterLink to="/creators">Creators</RouterLink>
                    <RouterLink v-if="account.isStaff.value" to="/staff">Staff tools</RouterLink>
                    <a :href="`${LEGACY_SITE}/`" rel="noopener">Classic site ↗</a>
                </section>
            </aside>
        </div>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import Avatar from '../components/Avatar.vue';
    import RoleChip from '../components/RoleChip.vue';
    import Icon from '../components/Icon.vue';
    import NextEventCard from '../components/NextEventCard.vue';
    import HubCardPanel from '../components/HubCardPanel.vue';
    import MyPhotos from '../components/MyPhotos.vue';
    import { account } from '../lib/account';
    import { MEMBER_PERKS } from '../lib/perks';
    import { nextEvent, setupProgress } from '../lib/community';
    import { LEGACY_SITE } from '../lib/config';

    const isCreator = computed(() => account.state.roles.some((r) => String(r.category).toLowerCase() === 'creator') || account.isOwner.value);
    // Creator perks only matter to creators; members see the member ones first.
    const perks = computed(() => (isCreator.value ? MEMBER_PERKS : MEMBER_PERKS.filter((p) => !p.title.startsWith('Creators'))));

    const setup = ref(null);
    const next = ref(null);
    const nextLoading = ref(true);
    const setupLeft = computed(() => (setup.value ? ['profile', 'vrchat', 'discord'].filter((k) => !setup.value[k]).length : 0));
    const nextStepText = computed(() => {
        const s = setup.value || {};
        if (!s.vrchat) return 'Verify your VRChat to unlock events, the gallery and every member perk.';
        if (!s.discord) return 'Link your Discord to get your role and event pings in the server.';
        return 'Finish your profile so people can find you.';
    });

    async function load() {
        if (account.state.loading) return;
        nextLoading.value = true;
        const [s, n] = await Promise.all([setupProgress().catch(() => null), nextEvent().catch(() => null)]);
        setup.value = s;
        next.value = n;
        nextLoading.value = false;
    }
    watch(() => [account.state.loading, account.hasAccess.value], load, { immediate: true });
</script>

<style scoped>
    .me-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 20px;
    }
    .who {
        flex: 1 1 260px;
        min-width: 0;
    }
    .who .eyebrow {
        margin: 0;
    }
    .who h1 {
        font-size: clamp(40px, 7vw, 60px);
        margin: 4px 0 8px;
        overflow-wrap: anywhere;
    }
    .actions {
        gap: 8px;
    }
    .setup {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 28px;
        border-color: var(--acid);
    }
    .setup p {
        margin: 2px 0 0;
    }
    .grid {
        display: flex;
        flex-wrap: wrap;
        gap: 24px;
        align-items: flex-start;
        margin-top: 28px;
    }
    .main {
        flex: 999 1 560px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 28px;
    }
    .side {
        flex: 1 1 300px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .become .eyebrow {
        margin: 0;
        font-size: 12px;
    }
    .become h2 {
        font-size: 32px;
        margin: 4px 0 8px;
    }
    .become p {
        margin: 0 0 16px;
        max-width: 560px;
    }
    .sub {
        font-size: 32px;
        margin-bottom: 14px;
    }
    .small-sub {
        font-size: 22px;
        margin-bottom: 6px;
    }
    .perks {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
        gap: 12px;
    }
    .perk {
        display: flex;
        gap: 14px;
        padding: 18px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--panel);
    }
    .perk.live {
        border-color: var(--line-strong);
        background: #06120a;
    }
    .perk p {
        margin: 4px 0 0;
    }
    .ic {
        color: var(--acid);
        flex: none;
    }
    .perk:not(.live) .ic {
        color: var(--muted);
    }
    .links {
        display: flex;
        flex-direction: column;
    }
    .links a {
        padding: 12px 0;
        border-top: 1px solid var(--line);
        font-weight: 600;
    }
</style>
