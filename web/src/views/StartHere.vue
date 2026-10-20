<template>
    <section class="wrap page">
        <p class="eyebrow">{{ account.signedIn.value ? "YOU'RE IN" : 'START HERE' }}</p>
        <h1 class="page-title">{{ account.signedIn.value ? 'WELCOME TO THE UNDERWEB.' : 'HOW TO GET SET UP.' }}</h1>
        <p class="lead">
            <template v-if="account.signedIn.value">A few quick steps and you're fully set up. Each one ticks itself off once it's done — come back any time.</template>
            <template v-else>Five minutes, start to finish. Make an account first — every other step unlocks from there.</template>
        </p>

        <div v-if="account.signedIn.value" class="progress">
            <div class="progress-top">
                <strong>{{ doneCount }} of {{ total }} done</strong>
                <span class="muted">{{ doneCount === total ? "You're all set" : `${total - doneCount} to go` }}</span>
            </div>
            <div class="bar" role="progressbar" aria-valuemin="0" :aria-valuemax="total" :aria-valuenow="doneCount" aria-label="Setup progress">
                <div :style="{ width: `${Math.round((doneCount / total) * 100)}%` }"></div>
            </div>
        </div>

        <div class="layout">
            <ol class="steps">
                <li v-for="(s, i) in steps" :key="s.id" class="step" :class="{ done: s.done, next: s.isNext }">
                    <span class="dot">{{ s.done ? '✓' : i + 1 }}</span>
                    <div class="txt">
                        <div class="cluster">
                            <h2>{{ s.title }}</h2>
                            <span v-if="s.optional" class="chip chip-soon">for creators</span>
                        </div>
                        <p>{{ s.text }}</p>
                        <p class="unlocks">Unlocks: {{ s.unlocks }}</p>
                    </div>
                    <span v-if="s.done" class="done-label">Done</span>
                    <span v-else-if="s.locked" class="done-label locked">After sign-up</span>
                    <template v-else-if="s.href">
                        <a :href="s.href" rel="noopener" class="btn" :class="s.isNext ? 'btn-primary' : ''">{{ s.cta }} ↗</a>
                    </template>
                    <RouterLink v-else :to="s.to" class="btn" :class="s.isNext ? 'btn-primary' : ''">{{ s.cta }}</RouterLink>
                </li>
            </ol>

            <aside class="side">
                <NextEventCard :event="next" :loading="nextLoading" label="YOUR FIRST NIGHT" />
                <section class="card">
                    <p class="eyebrow muted-eyebrow">YOUR PROGRESS</p>
                    <div class="badges">
                        <div v-for="b in badges" :key="b.label" class="badge" :class="{ on: b.on }">
                            <Icon name="badge" :size="26" />
                            <span>{{ b.label }}</span>
                        </div>
                    </div>
                </section>
                <p class="muted small">
                    Stuck?
                    <a v-if="DISCORD_INVITE" :href="DISCORD_INVITE" rel="noopener">Ask in the Discord</a>
                    <span v-else>Ask in the UnderWeb Discord</span>
                    — someone will walk you through it.
                </p>
            </aside>
        </div>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import Icon from '../components/Icon.vue';
    import NextEventCard from '../components/NextEventCard.vue';
    import { account } from '../lib/account';
    import { nextEvent, setupProgress } from '../lib/community';
    import { DISCORD_INVITE, LEGACY_SITE } from '../lib/config';

    const progress = ref(null);
    const next = ref(null);
    const nextLoading = ref(true);

    async function load() {
        if (account.state.loading) return;
        nextLoading.value = true;
        const [p, n] = await Promise.all([setupProgress().catch(() => null), nextEvent().catch(() => null)]);
        progress.value = p;
        next.value = n;
        nextLoading.value = false;
    }
    watch(() => [account.state.loading, account.signedIn.value, account.hasAccess.value], load, { immediate: true });

    const vrchatText = computed(() => {
        const s = progress.value?.vrchatState;
        if (s === 'pending') return 'Your code is in — staff are checking it. This ticks off once they confirm.';
        if (s === 'needs_attention') return "Staff couldn't confirm your code. Check it's in your VRChat bio and try again.";
        return 'Put a short code in your VRChat bio; staff confirm it. Your password never leaves VRChat.';
    });

    const steps = computed(() => {
        const p = progress.value || {};
        const signedIn = account.signedIn.value;
        const list = [
            { id: 'account', title: 'Create your account', text: 'Sign in with Discord or an email code. No password to remember.', unlocks: 'everything below', cta: 'Create account', to: '/signin?new=1', done: signedIn },
            { id: 'profile', title: 'Pick your name', text: 'Choose a username and display name so people can find you.', unlocks: 'your profile page', cta: 'Set up profile', to: '/welcome', done: Boolean(p.profile) },
            {
                id: 'vrchat',
                title: 'Verify your VRChat',
                text: vrchatText.value,
                unlocks: 'events, the gallery, the creator directory and every member perk',
                cta: p.vrchatState === 'pending' ? 'View status' : 'Get my code',
                to: '/connections',
                done: Boolean(p.vrchat)
            },
            { id: 'discord', title: 'Link your Discord', text: 'Connect once and your UnderWeb role shows up in the Discord on its own.', unlocks: 'your Discord role + event pings', cta: 'Link Discord', to: '/connections', done: Boolean(p.discord) },
            {
                id: 'showcase',
                title: 'Set up your showcase',
                text: 'DJ, avatar or world maker, photographer, video maker? Get a creator role, then add a few pieces of your work and your hub card.',
                unlocks: "the Creators page + your card in the hub",
                cta: 'Add my work',
                href: `${LEGACY_SITE}/`,
                optional: true,
                done: Boolean(p.showcase)
            }
        ];
        if (!signedIn) return list.map((s, i) => ({ ...s, done: false, isNext: i === 0, to: '/signin?new=1', href: null, locked: i > 0 }));
        const firstOpen = list.findIndex((s) => !s.done);
        return list.map((s, i) => ({ ...s, isNext: i === firstOpen }));
    });

    const required = computed(() => steps.value.filter((s) => !s.optional));
    const total = computed(() => required.value.length);
    const doneCount = computed(() => required.value.filter((s) => s.done).length);

    const badges = computed(() => [
        { label: 'Verified', on: Boolean(progress.value?.vrchat) },
        { label: 'Linked', on: Boolean(progress.value?.discord) },
        { label: 'Creator', on: Boolean(progress.value?.showcase) }
    ]);
</script>

<style scoped>
    .progress {
        margin: 28px 0 0;
        max-width: 620px;
    }
    .progress-top {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        margin-bottom: 8px;
    }
    .bar {
        height: 10px;
        border-radius: 999px;
        background: #0b1a10;
        overflow: hidden;
    }
    .bar div {
        height: 100%;
        border-radius: 999px;
        background: var(--acid);
        transition: width 0.3s;
    }
    .layout {
        display: flex;
        flex-wrap: wrap;
        gap: 28px;
        align-items: flex-start;
        margin-top: 36px;
    }
    .steps {
        flex: 999 1 560px;
        min-width: 0;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .step {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
        padding: 20px;
        border-radius: var(--radius);
        border: 1px solid var(--line);
        background: var(--panel);
    }
    .step.next {
        border-color: var(--acid);
    }
    .step.done {
        border-color: var(--line-strong);
        background: #06120a;
    }
    .dot {
        flex: none;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        font-family: var(--font-mono);
        font-weight: 700;
        background: var(--acid-deep);
        color: var(--acid);
        border: 1px solid var(--line-strong);
    }
    .done .dot {
        background: var(--acid);
        color: var(--acid-ink);
        border-color: var(--acid);
    }
    .txt {
        flex: 1 1 260px;
        min-width: 0;
    }
    .txt h2 {
        font-family: var(--font-ui);
        font-weight: 700;
        font-size: 19px;
        letter-spacing: 0;
    }
    .txt p {
        margin: 4px 0 0;
        color: #a9bfb1;
        font-size: 15px;
    }
    .txt .unlocks {
        margin-top: 6px;
        font-size: 13px;
        color: var(--acid);
        font-weight: 600;
    }
    .done-label {
        padding: 10px 14px;
        font-weight: 700;
        color: var(--acid);
    }
    .done-label.locked {
        color: var(--muted);
        font-weight: 600;
    }
    .side {
        flex: 1 1 300px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .muted-eyebrow {
        color: var(--muted);
        margin: 0 0 12px;
        font-size: 12px;
    }
    .badges {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
    }
    .badge {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 12px 6px;
        border-radius: 12px;
        border: 1px solid var(--line);
        color: #3d5747;
        font-size: 12px;
        font-weight: 700;
        text-align: center;
    }
    .badge.on {
        color: var(--acid);
        border-color: var(--line-strong);
        background: #06120a;
    }
</style>
