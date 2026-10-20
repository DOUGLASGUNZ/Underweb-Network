<template>
    <article class="next">
        <div class="art">
            <img v-if="event?.cover_url" :src="event.cover_url" alt="" />
            <img v-else src="/media/hero.webp" alt="" class="fallback" />
        </div>
        <div class="body">
            <p class="eyebrow">{{ label }}</p>
            <template v-if="loading">
                <div class="skeleton" style="height: 36px; margin: 8px 0"></div>
                <div class="skeleton" style="height: 18px; width: 60%"></div>
            </template>
            <template v-else-if="event">
                <h2>{{ event.title }}</h2>
                <p class="when">{{ when }}<span v-if="event.location"> · {{ event.location }}</span></p>
                <div v-if="!isLive" class="count" role="timer" :aria-label="`Starts in ${parts.d} days ${parts.h} hours ${parts.m} minutes`">
                    <div><strong>{{ pad(parts.d) }}</strong><span>days</span></div>
                    <div><strong>{{ pad(parts.h) }}</strong><span>hours</span></div>
                    <div><strong>{{ pad(parts.m) }}</strong><span>min</span></div>
                </div>
                <p v-else class="live"><span class="chip chip-acid">LIVE NOW</span> Come through.</p>
                <RouterLink :to="account.signedIn.value ? '/events' : '/signin?new=1'" class="btn btn-soft cta">
                    {{ account.signedIn.value ? 'See all events' : 'Make an account to get reminders' }}
                </RouterLink>
            </template>
            <template v-else>
                <h2>NIGHTS AT THE UNDERWEB</h2>
                <p class="when">Music video nights, cinema and hangouts in the UnderWeb hub.</p>
                <p class="muted small">The next date hasn't been posted yet. Members see new events here and in the Discord first.</p>
                <RouterLink :to="account.signedIn.value ? '/events' : '/signin?new=1'" class="btn btn-soft cta">
                    {{ account.signedIn.value ? 'Open the calendar' : 'Make an account so you hear first' }}
                </RouterLink>
            </template>
        </div>
    </article>
</template>

<script setup>
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
    import { account } from '../lib/account';
    import { formatDateTime } from '../lib/format';

    const props = defineProps({ event: { type: Object, default: null }, loading: Boolean, label: { type: String, default: 'NEXT EVENT' } });

    const now = ref(Date.now());
    let t;
    onMounted(() => (t = setInterval(() => (now.value = Date.now()), 30000)));
    onBeforeUnmount(() => clearInterval(t));

    const start = computed(() => (props.event ? new Date(props.event.starts_at).getTime() : 0));
    const isLive = computed(() => props.event && now.value >= start.value);
    const parts = computed(() => {
        const ms = Math.max(0, start.value - now.value);
        return { d: Math.floor(ms / 86400000), h: Math.floor(ms / 3600000) % 24, m: Math.floor(ms / 60000) % 60 };
    });
    const pad = (n) => String(n).padStart(2, '0');
    const when = computed(() => (props.event ? formatDateTime(props.event.starts_at) : ''));
</script>

<style scoped>
    .next {
        border: 1px solid var(--line-strong);
        border-radius: 18px;
        background: var(--panel);
        overflow: hidden;
    }
    .art {
        height: 170px;
        background: #0b1a10;
        border-bottom: 1px solid var(--line);
    }
    .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .art .fallback {
        object-position: center 30%;
        opacity: 0.75;
    }
    .body {
        padding: 22px;
    }
    .body .eyebrow {
        margin: 0;
        font-size: 12px;
    }
    h2 {
        margin: 6px 0 4px;
        font-size: 34px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
    }
    .when {
        margin: 0;
        color: var(--text-2);
    }
    .count {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin: 18px 0;
    }
    .count div {
        padding: 10px 6px;
        border-radius: 10px;
        background: var(--panel-2);
        text-align: center;
    }
    .count strong {
        display: block;
        font-family: var(--font-mono);
        font-size: 24px;
    }
    .count span {
        font-size: 12px;
        color: var(--muted);
    }
    .live {
        margin: 16px 0;
        display: flex;
        gap: 10px;
        align-items: center;
    }
    .cta {
        width: 100%;
        margin-top: 16px;
        white-space: normal;
        text-align: center;
    }
</style>
