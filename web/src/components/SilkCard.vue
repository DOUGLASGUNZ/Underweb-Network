<template>
    <section v-if="data" class="card silk">
        <div class="cluster between">
            <p class="eyebrow">YOUR SILK</p>
            <span class="muted small">{{ data.today?.confirmed_at ? 'Checked in at the hub today ✓' : 'Not checked in today' }}</span>
        </div>
        <div class="stats">
            <div><strong>{{ data.balance.toLocaleString() }}</strong><span>Silk</span></div>
            <div><strong>+{{ data.week.toLocaleString() }}</strong><span>this week</span></div>
            <div><strong>{{ data.streak }}</strong><span>week streak</span></div>
            <div><strong>{{ data.visits }}</strong><span>hub visits</span></div>
        </div>
        <div class="cols">
            <div>
                <h3 class="label">How to earn</h3>
                <ul class="ways">
                    <li><b>+25</b> 10 minutes at the hub, once a day (with UWX running)</li>
                    <li><b>+50</b> and a badge for being there during an event</li>
                    <li><b>+10×</b> weeks in a row (up to +50)</li>
                    <li><b>+10</b> per approved photo or work (3 a day)</li>
                    <li><b>+100</b> per friend you bring in (<RouterLink to="/me">Road to 500</RouterLink>)</li>
                </ul>
            </div>
            <div>
                <h3 class="label">Top this week</h3>
                <p v-if="!board.length" class="muted small">Nobody yet.</p>
                <div v-for="(r, i) in board.slice(0, 6)" :key="i" class="row" :class="{ me: r.me }">
                    <span class="rank">{{ i + 1 }}</span><span class="grow">{{ r.display_name || r.username }}</span><strong>{{ r.earned }}</strong>
                </div>
            </div>
        </div>
        <div v-if="data.badges?.length" class="badges">
            <h3 class="label">I was there</h3>
            <span v-for="b in data.badges" :key="b.event + b.at" class="chip chip-acid">{{ b.event }}</span>
        </div>
        <details v-if="data.recent?.length" class="recent">
            <summary class="small">History</summary>
            <div v-for="(r, i) in data.recent" :key="i" class="row">
                <span class="grow small">{{ r.note || r.reason }}</span>
                <span class="muted small">{{ new Date(r.created_at).toLocaleDateString() }}</span>
                <strong>{{ r.amount > 0 ? '+' : '' }}{{ r.amount }}</strong>
            </div>
        </details>
        <p class="muted small" style="margin-top: 10px">Silk in your account is safe across reinstalls. Spending it in the hub casino is coming next.</p>
    </section>
</template>

<script setup>
    import { onMounted, ref } from 'vue';
    import { supabase } from '../lib/supabase';

    const data = ref(null);
    const board = ref([]);
    onMounted(async () => {
        const [{ data: s, error }, { data: lb }] = await Promise.all([supabase.rpc('uw_silk_summary'), supabase.rpc('uw_silk_leaderboard', { p_days: 7 })]);
        if (!error) data.value = s;
        board.value = lb || [];
    });
</script>

<style scoped>
    .silk .eyebrow {
        margin: 0;
        font-size: 12px;
    }
    .between {
        justify-content: space-between;
    }
    .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
        margin: 12px 0 18px;
    }
    .stats div {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 12px;
    }
    .stats strong {
        font-size: 28px;
        color: var(--acid);
        font-family: var(--font-mono);
    }
    .stats span {
        font-size: 12px;
        color: var(--muted);
    }
    .cols {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 18px;
    }
    .ways {
        list-style: none;
        padding: 0;
        margin: 0;
        font-size: 14px;
        line-height: 1.8;
    }
    .ways b {
        color: var(--acid);
        display: inline-block;
        min-width: 44px;
    }
    .row {
        display: flex;
        gap: 10px;
        align-items: baseline;
        padding: 6px 0;
        border-top: 1px solid var(--line);
    }
    .row.me {
        color: var(--acid);
    }
    .rank {
        width: 20px;
        color: var(--muted);
        font-family: var(--font-mono);
    }
    .grow {
        flex: 1;
        min-width: 0;
    }
    .badges {
        margin-top: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
    }
    .badges h3 {
        flex-basis: 100%;
    }
    .recent {
        margin-top: 14px;
    }
    h3.label {
        margin-bottom: 6px;
    }
</style>
