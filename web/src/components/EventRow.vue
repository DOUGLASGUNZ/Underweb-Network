<template>
    <article class="ev row-line">
        <div class="date" aria-hidden="true">
            <span class="mon">{{ mon }}</span>
            <span class="day">{{ day }}</span>
        </div>
        <div class="body">
            <h3 class="title">{{ event.title }}</h3>
            <div class="muted small">
                <time :datetime="event.starts_at">{{ times.local }}</time>
                <span v-if="showEastern"> · {{ times.eastern }}</span>
            </div>
            <div v-if="event.location" class="muted small">{{ event.location }}</div>
        </div>
        <span v-if="live" class="chip chip-acid">LIVE</span>
    </article>
</template>

<script setup>
    import { computed } from 'vue';
    import { eventTimes, localTimeZone } from '../lib/format';

    const props = defineProps({ event: { type: Object, required: true } });
    const start = computed(() => new Date(props.event.starts_at));
    const mon = computed(() => start.value.toLocaleString(undefined, { month: 'short' }).toUpperCase());
    const day = computed(() => start.value.getDate());
    const times = computed(() => eventTimes(props.event.starts_at));
    const showEastern = computed(() => localTimeZone() !== 'America/New_York' && localTimeZone() !== 'America/Detroit');
    const live = computed(() => {
        const now = Date.now();
        const s = start.value.getTime();
        const e = props.event.ends_at ? new Date(props.event.ends_at).getTime() : s + 4 * 3600 * 1000;
        return now >= s && now <= e;
    });
</script>

<style scoped>
    .ev {
        display: flex;
        gap: 14px;
        align-items: flex-start;
    }
    .date {
        width: 52px;
        flex: none;
        text-align: center;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius-sm);
        padding: 6px 0;
        display: flex;
        flex-direction: column;
    }
    .mon {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--acid);
    }
    .day {
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 700;
        line-height: 1;
    }
    .body {
        min-width: 0;
        flex: 1;
    }
    .title {
        font-family: var(--font-body);
        font-size: 15px;
        font-weight: 600;
        margin: 0 0 2px;
    }
</style>
