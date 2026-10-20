<template>
    <!-- Hero: one message, one action -->
    <section class="wrap hero">
        <div class="hero-copy">
            <p class="eyebrow">VRCHAT COMMUNITY · 18+</p>
            <template v-if="!account.signedIn.value">
                <h1>COME FOR THE NIGHTS.<br /><span class="hl">STAY FOR THE PEOPLE.</span></h1>
                <p class="lead hero-lead">
                    Music video nights, cinema, hangouts — and the DJs, avatar makers and world builders who make them happen. Show up, get known, make
                    things together.
                </p>
                <div class="cluster ctas">
                    <RouterLink to="/signin?new=1" class="btn btn-primary btn-lg">Create your free account</RouterLink>
                    <a href="#next" class="btn btn-lg">See the next event</a>
                </div>
                <p class="muted small">Takes a few minutes. Sign in with Discord or an email code.</p>
            </template>
            <template v-else>
                <h1>WELCOME BACK,<br /><span class="hl">{{ firstName }}.</span></h1>
                <p class="lead hero-lead">Here's what's on, and what's next for you.</p>
                <div v-if="setup && setupLeft" class="setup">
                    <div class="setup-top">
                        <strong>{{ setupDone }} of {{ setupTotal }} setup steps done</strong>
                        <span class="muted">{{ setupLeft }} to go</span>
                    </div>
                    <div class="bar" role="progressbar" aria-valuemin="0" :aria-valuemax="setupTotal" :aria-valuenow="setupDone" aria-label="Setup progress">
                        <div :style="{ width: `${Math.round((setupDone / setupTotal) * 100)}%` }"></div>
                    </div>
                    <RouterLink to="/start" class="btn btn-primary">Finish setting up</RouterLink>
                </div>
                <div v-else class="cluster ctas">
                    <RouterLink to="/me" class="btn btn-primary btn-lg">My UnderWeb</RouterLink>
                    <RouterLink to="/events" class="btn btn-lg">Events</RouterLink>
                </div>
            </template>
        </div>
        <div id="next" class="hero-card">
            <NextEventCard :event="next" :loading="nextLoading" />
        </div>
    </section>

    <!-- Why make an account -->
    <section class="band">
        <div class="wrap section">
            <p class="eyebrow">WHY MAKE AN ACCOUNT</p>
            <h2 class="section-title">WHAT MEMBERS GET</h2>
            <div class="perks">
                <div v-for="p in MEMBER_PERKS" :key="p.id" class="card" :class="{ 'card-hi': p.status === 'live' }">
                    <div class="perk-top">
                        <Icon :name="p.icon" class="ic" />
                        <span v-if="p.status === 'soon'" class="chip chip-soon">Coming soon</span>
                        <span v-else class="chip chip-acid">Live now</span>
                    </div>
                    <h3>{{ p.title }}</h3>
                    <p>{{ p.body }}</p>
                </div>
            </div>
        </div>
    </section>

    <!-- Two ways in -->
    <section v-if="!account.signedIn.value" class="wrap section">
        <h2 class="section-title">PICK YOUR WAY IN</h2>
        <div class="ways">
            <div class="way">
                <p class="eyebrow blue">I'M HERE TO HANG OUT</p>
                <h3>Find the nights worth showing up for.</h3>
                <ul>
                    <li>See what's on and get a reminder before it starts</li>
                    <li>Collect badges on your profile</li>
                    <li>Post and browse photos from every night</li>
                </ul>
                <RouterLink to="/signin?new=1" class="btn way-btn blue-btn">Join as a member</RouterLink>
            </div>
            <div class="way way-hi">
                <p class="eyebrow">I MAKE THINGS</p>
                <h3>DJ, build avatars or worlds, shoot photos?</h3>
                <ul>
                    <li>A creator profile with a showcase of your work</li>
                    <li>Your card on the hub's Creator Market wall or DJ stage screen</li>
                    <li>Get featured on the hub screen and in the Discord</li>
                </ul>
                <div class="cluster">
                    <RouterLink to="/signin?new=1" class="btn btn-primary way-btn">Join as a creator</RouterLink>
                    <RouterLink to="/creators" class="btn way-btn">What creators get</RouterLink>
                </div>
            </div>
        </div>
    </section>

    <!-- Gallery strip -->
    <section class="wrap section" :class="{ 'no-top': !account.signedIn.value }">
        <div class="sec-head">
            <div>
                <p class="eyebrow">FROM THE LAST FEW NIGHTS</p>
                <h2 class="section-title tight">GALLERY</h2>
            </div>
            <RouterLink to="/gallery" class="see-all">See all photos →</RouterLink>
        </div>
        <GalleryGrid :items="photos.slice(0, 3)" :loading="photosLoading" />
    </section>

    <!-- How joining works -->
    <section v-if="!account.signedIn.value" class="band">
        <div class="wrap section">
            <p class="eyebrow">HOW JOINING WORKS</p>
            <h2 class="section-title">THREE STEPS. THAT'S IT.</h2>
            <ol class="steps">
                <li v-for="(s, i) in joinSteps" :key="s.title" class="card">
                    <span class="num">{{ i + 1 }}</span>
                    <h3>{{ s.title }}</h3>
                    <p>{{ s.body }}</p>
                </li>
            </ol>
            <div class="cluster ctas end">
                <RouterLink to="/signin?new=1" class="btn btn-primary btn-lg">Create your free account</RouterLink>
                <span class="muted">Already a member? <RouterLink to="/signin">Sign in</RouterLink></span>
            </div>
        </div>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import Icon from '../components/Icon.vue';
    import NextEventCard from '../components/NextEventCard.vue';
    import GalleryGrid from '../components/GalleryGrid.vue';
    import { account } from '../lib/account';
    import { MEMBER_PERKS } from '../lib/perks';
    import { galleryItems, nextEvent, setupProgress } from '../lib/community';

    const joinSteps = [
        { title: 'Create your account', body: 'Sign in with Discord or an email code. No password to remember.' },
        { title: "Prove it's your VRChat", body: 'Put a short code in your VRChat bio and staff confirm it. We never ask for your VRChat password.' },
        { title: 'Come to a night', body: 'Check the next event, show up, and start collecting badges.' }
    ];

    const firstName = computed(() => String(account.displayName.value || '').split(/\s+/)[0].toUpperCase());

    const next = ref(null);
    const nextLoading = ref(true);
    const photos = ref([]);
    const photosLoading = ref(true);
    const setup = ref(null);

    const REQUIRED = ['profile', 'vrchat', 'discord'];
    const setupTotal = REQUIRED.length + 1; // + account
    const setupDone = computed(() => (setup.value ? 1 + REQUIRED.filter((k) => setup.value[k]).length : 0));
    const setupLeft = computed(() => setupTotal - setupDone.value);

    async function load() {
        if (account.state.loading) return;
        nextLoading.value = photosLoading.value = true;
        const [n, p, s] = await Promise.all([nextEvent().catch(() => null), galleryItems(6).catch(() => []), setupProgress().catch(() => null)]);
        next.value = n;
        photos.value = p;
        setup.value = s;
        nextLoading.value = photosLoading.value = false;
    }
    watch(() => [account.state.loading, account.signedIn.value, account.hasAccess.value], load, { immediate: true });
</script>

<style scoped>
    .hero {
        display: flex;
        flex-wrap: wrap;
        gap: 40px;
        align-items: center;
        padding-top: 64px;
        padding-bottom: 56px;
    }
    .hero-copy {
        flex: 999 1 520px;
        min-width: 0;
    }
    .hero-copy .eyebrow {
        margin: 0 0 18px;
    }
    h1 {
        font-size: clamp(48px, 9vw, 84px);
        line-height: 0.95;
    }
    .hl {
        color: var(--acid);
    }
    .hero-lead {
        margin-top: 24px;
        font-size: 19px;
    }
    .ctas {
        gap: 12px;
        margin: 32px 0 14px;
    }
    .ctas.end {
        margin: 32px 0 0;
        gap: 16px;
    }
    .hero-card {
        flex: 1 1 340px;
        min-width: 0;
    }
    .setup {
        margin-top: 28px;
        max-width: 560px;
        padding: 20px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        background: #06120a;
    }
    .setup-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 14px;
        margin-bottom: 8px;
    }
    .bar {
        height: 10px;
        border-radius: 999px;
        background: #0b1a10;
        overflow: hidden;
        margin-bottom: 16px;
    }
    .bar div {
        height: 100%;
        background: var(--acid);
        border-radius: 999px;
    }
    .perks {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
        gap: 16px;
    }
    .perk-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
    }
    .ic {
        color: var(--acid);
    }
    .card h3 {
        margin: 14px 0 6px;
        font-size: 20px;
    }
    .card p {
        margin: 0;
        color: #a9bfb1;
        font-size: 15px;
    }
    .ways {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
        gap: 20px;
    }
    .way {
        padding: 30px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: var(--panel);
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .way-hi {
        border-color: var(--line-strong);
    }
    .way .eyebrow {
        margin: 0;
    }
    .eyebrow.blue {
        color: #429cff;
    }
    .way h3 {
        font-size: 26px;
    }
    .way ul {
        margin: 0;
        padding-left: 20px;
        color: var(--text-2);
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .way .cluster,
    .way > .way-btn {
        margin-top: auto;
    }
    .way > .way-btn {
        align-self: flex-start;
    }
    .blue-btn {
        border-color: #2a5f8f;
        color: #9cc8ff;
    }
    .blue-btn:hover {
        border-color: #9cc8ff;
        color: #cfe4ff;
    }
    .no-top {
        padding-top: 0;
    }
    .sec-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 20px;
    }
    .section-title.tight {
        margin-bottom: 0;
    }
    .see-all {
        font-weight: 700;
    }
    .steps {
        margin: 0;
        padding: 0;
        list-style: none;
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
    .steps h3 {
        font-size: 19px;
    }
</style>
