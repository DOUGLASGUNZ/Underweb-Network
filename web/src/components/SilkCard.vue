<template>
    <section v-if="data" class="card silk">
        <div class="cluster between">
            <p class="eyebrow">YOUR SILK · CASINO BALANCE</p>
            <span class="muted small">{{ data.today?.confirmed_at ? 'Checked in at the hub today ✓' : 'Not checked in today' }}</span>
        </div>

        <div class="hero">
            <div class="big">
                <strong>{{ casino ? fmt(casino.balance) : '—' }}</strong>
                <span v-if="casino" class="muted small">as of {{ ago(casino.seen_at) }} in the casino<template v-if="casino.display_name"> · {{ casino.display_name }}</template></span>
                <span v-else class="muted small">We haven't seen you in the casino yet. Your balance shows up here after a visit while someone in the instance is running UWX.</span>
            </div>
            <div v-if="pending.count" class="pending">
                <strong>+{{ fmt(pending.amount) }}</strong>
                <span class="small">on its way to the casino ({{ pending.count }}). It lands next time you join.</span>
            </div>
        </div>

        <div class="stats">
            <div><strong>+{{ fmt(data.week) }}</strong><span>earned on the site this week</span></div>
            <div><strong>{{ data.streak }}</strong><span>week streak</span></div>
            <div><strong>{{ data.visits }}</strong><span>hub visits</span></div>
            <div v-if="casino?.whale_tier"><strong>{{ plaque(casino.whale_tier) }}</strong><span>whale plaque</span></div>
        </div>

        <div class="cols">
            <div>
                <h3 class="label">Earn Silk from the site</h3>
                <ul class="ways">
                    <li><b>+{{ fmt(25 * m) }}</b><span>10 minutes at the hub, once a day (with UWX running)</span></li>
                    <li><b>+{{ fmt(50 * m) }}</b><span>and a badge for being there during an event</span></li>
                    <li><b>+{{ fmt(10 * m) }}×</b><span>weeks in a row (up to +{{ fmt(50 * m) }})</span></li>
                    <li><b>+{{ fmt(10 * m) }}</b><span>per approved photo or work (3 a day)</span></li>
                    <li><b>+{{ fmt(100 * m) }}</b><span>per friend you bring in (<RouterLink to="/me">Road to 500</RouterLink>)</span></li>
                </ul>
                <p class="muted small">All of it goes straight into your casino balance.</p>
            </div>
            <div>
                <h3 class="label">Richest in the casino</h3>
                <p v-if="!board.length" class="muted small">Nobody yet. The board fills in as UWX sees people in the casino.</p>
                <div v-for="(r, i) in board.slice(0, 10)" :key="i" class="row" :class="{ me: r.me }">
                    <span class="rank">{{ i + 1 }}</span>
                    <span class="grow">
                        <RouterLink v-if="r.username" :to="`/u/${r.username}`">{{ r.display_name }}</RouterLink>
                        <template v-else>{{ r.display_name }}</template>
                    </span>
                    <strong>{{ fmt(r.balance) }}</strong>
                </div>
            </div>
        </div>

        <div v-if="whales.length" class="whales">
            <h3 class="label">Hall of Whales</h3>
            <div class="plaques">
                <div v-for="(w, i) in whales" :key="i" class="plaque" :class="{ me: w.me }">
                    <strong>{{ plaque(w.whale_tier) }}</strong>
                    <span>{{ w.display_name }}</span>
                </div>
            </div>
        </div>

        <div v-if="data.badges?.length" class="badges">
            <h3 class="label">I was there</h3>
            <span v-for="b in data.badges" :key="b.event + b.at" class="chip chip-acid">{{ b.event }}</span>
        </div>

        <details v-if="data.transfers?.length" class="recent">
            <summary class="small">Silk from the site</summary>
            <div v-for="t in data.transfers" :key="t.seq" class="row">
                <span class="grow small">{{ t.note || t.source }}</span>
                <span class="small" :class="statusClass(t.status)">{{ statusText(t.status) }}</span>
                <strong>{{ t.amount > 0 ? '+' : '' }}{{ fmt(t.amount) }}</strong>
            </div>
        </details>
        <p v-if="updatedAt" class="muted small foot">Leaderboard updated {{ ago(updatedAt) }}.</p>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { supabase } from '../lib/supabase';

    // Hall of Whales plaque prices, tier 1 up.
    const PLAQUES = [1e6, 2e6, 4e6, 1e7, 2.5e7, 5e7, 1e8, 2.5e8, 5e8, 1e9];

    const data = ref(null);
    const overview = ref(null);
    const casino = computed(() => data.value?.casino || null);
    const pending = computed(() => data.value?.pending || { count: 0, amount: 0 });
    const m = computed(() => Number(data.value?.multiplier || 1));
    const board = computed(() => overview.value?.board || []);
    const whales = computed(() => overview.value?.whales || []);
    const updatedAt = computed(() => overview.value?.updated_at || null);

    function fmt(n) {
        const v = Number(n || 0);
        const a = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        if (a >= 1e12) return sign + trim(a / 1e12) + 'T';
        if (a >= 1e9) return sign + trim(a / 1e9) + 'B';
        if (a >= 1e6) return sign + trim(a / 1e6) + 'M';
        return v.toLocaleString();
    }
    function trim(x) {
        return x >= 100 ? Math.floor(x).toString() : x.toFixed(x >= 10 ? 1 : 2).replace(/\.?0+$/, '');
    }
    function plaque(tier) {
        const p = PLAQUES[tier - 1];
        return p ? fmt(p) : `Tier ${tier}`;
    }
    function ago(ts) {
        const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
        if (s < 90) return 'just now';
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
        return `${Math.round(s / 86400)} days ago`;
    }
    function statusText(s) {
        return { pending: 'On its way', applied: 'In the casino', declined: 'Declined', cancelled: 'Cancelled' }[s] || s;
    }
    function statusClass(s) {
        return s === 'applied' ? 'ok' : s === 'pending' ? 'wait' : 'muted';
    }

    onMounted(async () => {
        const [{ data: s, error }, { data: ov }] = await Promise.all([supabase.rpc('uw_silk_summary'), supabase.rpc('uw_casino_overview', { p_limit: 25 })]);
        if (!error) data.value = s;
        overview.value = ov || null;
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
    .hero {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        align-items: stretch;
        margin: 12px 0 14px;
    }
    .big {
        flex: 2 1 260px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .big strong {
        font-size: clamp(40px, 9vw, 64px);
        line-height: 1;
        color: var(--acid);
        font-family: var(--font-mono);
    }
    .pending {
        flex: 1 1 200px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px;
        border: 1px dashed var(--line-strong);
        border-radius: 12px;
        background: var(--acid-soft);
    }
    .pending strong {
        font-size: 24px;
        color: var(--acid);
        font-family: var(--font-mono);
    }
    .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
        margin: 0 0 18px;
    }
    .stats div {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 12px;
    }
    .stats strong {
        font-size: 24px;
        color: var(--acid);
        font-family: var(--font-mono);
    }
    .stats span {
        font-size: 12px;
        color: var(--muted);
    }
    .cols {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: 18px;
    }
    .ways {
        list-style: none;
        padding: 0;
        margin: 0;
        font-size: 14px;
    }
    .ways li {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        line-height: 1.45;
        padding: 4px 0;
    }
    .ways b {
        color: var(--acid);
        font-family: var(--font-mono);
    }
    .row {
        display: flex;
        gap: 10px;
        align-items: baseline;
        padding: 6px 0;
        border-top: 1px solid var(--line);
    }
    .row strong {
        font-family: var(--font-mono);
    }
    .row.me {
        color: var(--acid);
    }
    .rank {
        width: 22px;
        color: var(--muted);
        font-family: var(--font-mono);
    }
    .grow {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .whales {
        margin-top: 18px;
    }
    .plaques {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
    }
    .plaque {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 12px;
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        background: var(--acid-deep);
    }
    .plaque strong {
        color: var(--acid);
        font-family: var(--font-mono);
        font-size: 18px;
    }
    .plaque span {
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .plaque.me {
        border-color: var(--acid);
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
    .ok {
        color: var(--acid);
    }
    .wait {
        color: #ffd166;
    }
    .foot {
        margin-top: 10px;
    }
    h3.label {
        margin-bottom: 6px;
    }
</style>
