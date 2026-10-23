<template>
    <section class="stack">
        <div class="panel-head">
            <h2>Owner overview</h2>
            <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Refresh' }}</button>
        </div>
        <p class="muted small" style="margin: 0">
            Everything at a glance. Member numbers come from UWX's last sync with VRChat; the rest is live from UnderWeb.
        </p>

        <p v-if="error" class="error-text">{{ error }}</p>
        <div v-else-if="d && !d.group" class="notice notice-caution">No group is registered yet. In UWX, open Group Intelligence and register The UnderWeb.</div>

        <template v-else-if="d">
            <!-- Needs you -->
            <div>
                <h3 class="label">Needs you</h3>
                <div v-if="!needsTotal" class="ok-line">Nothing waiting. All clear.</div>
                <div v-else class="needs">
                    <component :is="n.tab ? RouterLink : 'div'" v-for="n in needs" :key="n.key" :to="n.tab ? { query: { tab: n.tab } } : undefined" class="need" :class="{ hot: n.hot }">
                        <strong>{{ n.value }}</strong>
                        <span>{{ n.label }}</span>
                    </component>
                </div>
            </div>

            <!-- Group -->
            <div class="panel stack">
                <div class="row-between">
                    <h3 class="label" style="margin: 0">{{ d.group.name }}</h3>
                    <span class="muted small">{{ asOfText }}</span>
                </div>
                <div class="tiles">
                    <div class="tile"><span>Members</span><strong>{{ fmt(m.count) }}</strong></div>
                    <div class="tile"><span>Online</span><strong>{{ fmt(m.online) }}</strong></div>
                    <div class="tile"><span>This week</span><strong :class="tone(weekGrowth)">{{ signed(weekGrowth) }}</strong></div>
                    <div class="tile"><span>This month</span><strong :class="tone(monthGrowth)">{{ signed(monthGrowth) }}</strong></div>
                </div>
                <div v-if="m.count != null">
                    <div class="row-between small"><span>Road to {{ d.group.goal }}</span><span class="muted">{{ m.count }} / {{ d.group.goal }} · {{ Math.max(0, d.group.goal - m.count) }} to go</span></div>
                    <div class="bar"><div :style="{ width: Math.min(100, (m.count / d.group.goal) * 100) + '%' }" /></div>
                </div>
                <p v-if="weekGrowth == null || monthGrowth == null" class="muted small" style="margin: 0">
                    Growth fills in once UWX has a week (or month) of history — tracked since {{ dateText(m.tracked_since) }}.
                </p>
            </div>

            <!-- Staff -->
            <div class="panel stack">
                <h3 class="label" style="margin: 0">Staff</h3>
                <div>
                    <div class="sub">On duty now</div>
                    <p v-if="!d.on_duty.length" class="muted small" style="margin: 4px 0 0">Nobody is checked in.</p>
                    <div v-for="(s, i) in d.on_duty" :key="'d' + i" class="line">
                        <span class="dot" /><span class="grow">{{ s.name }}</span><span class="muted small">{{ sinceText(s.since) }}</span>
                    </div>
                </div>
                <div>
                    <div class="sub">Hours on duty, last 7 days</div>
                    <p v-if="!d.staff_week.length" class="muted small" style="margin: 4px 0 0">No shifts this week.</p>
                    <div v-for="(s, i) in d.staff_week" :key="'w' + i" class="line">
                        <span class="grow">{{ s.name }}</span><strong>{{ s.hours }} h</strong>
                    </div>
                </div>
            </div>

            <!-- Moderation -->
            <div class="panel stack">
                <h3 class="label" style="margin: 0">Moderation, last 7 days</h3>
                <div class="tiles">
                    <div class="tile"><span>Bans</span><strong>{{ mod.bans }}</strong></div>
                    <div class="tile"><span>Kicks / removals</span><strong>{{ mod.kicks }}</strong></div>
                    <div class="tile"><span>Warnings</span><strong>{{ mod.warns }}</strong></div>
                    <div class="tile"><span>Cases closed</span><strong>{{ mod.cases_closed }}</strong></div>
                    <div class="tile"><span>Joined</span><strong>{{ mod.joins }}</strong></div>
                    <div class="tile"><span>Left</span><strong>{{ mod.leaves }}</strong></div>
                </div>
                <p class="muted small" style="margin: 0">
                    From the VRChat audit log UWX syncs{{ mod.last_event ? ` — newest entry ${dateText(mod.last_event)}` : '' }}. Instance kicks and warns only show if UWX saw them.
                </p>
                <div class="line">
                    <span class="grow">Discord mod log</span>
                    <span v-if="d.discord?.last_error" class="bad small">Error: {{ d.discord.last_error }}</span>
                    <span v-else-if="d.discord?.last_post_at" class="pos small">Last post {{ sinceText(d.discord.last_post_at) }} ago</span>
                    <span v-else class="muted small">Connected — nothing posted yet</span>
                </div>
            </div>

            <!-- Community -->
            <div class="panel stack">
                <h3 class="label" style="margin: 0">Community, last 7 days</h3>
                <div class="tiles">
                    <div class="tile"><span>Hub visits</span><strong>{{ c.hub_visits }}</strong></div>
                    <div class="tile"><span>Different people</span><strong>{{ c.hub_visitors }}</strong></div>
                    <div class="tile"><span>Silk earned</span><strong>{{ fmt(c.silk_earned) }}</strong></div>
                    <div class="tile"><span>Recruits verified</span><strong>{{ d.recruiting.verified_week }}</strong></div>
                </div>
                <div v-if="c.top_earners.length">
                    <div class="sub">Top earners</div>
                    <div v-for="(t, i) in c.top_earners" :key="'t' + i" class="line">
                        <span class="muted small rank">{{ i + 1 }}</span><span class="grow">{{ t.name }}</span><strong class="pos">+{{ t.earned }}</strong>
                    </div>
                </div>
            </div>

            <router-link :to="{ query: { tab: 'people' } }" class="btn btn-sm btn-primary" style="align-self: flex-start">Manage people &amp; roles</router-link>
            <p class="muted small">Updated {{ new Date(d.generated_at).toLocaleTimeString() }}. Which VRChat group roles get staff access in UWX is set in UWX → Group Intelligence → Settings & sharing.</p>
        </template>
    </section>
</template>

<script setup>
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
    import { RouterLink } from 'vue-router';
    import { supabase, friendlyError } from '../../lib/supabase';

    const d = ref(null);
    const error = ref('');
    const loading = ref(false);
    let timer = null;

    async function load() {
        loading.value = true;
        const { data, error: err } = await supabase.rpc('uwx_owner_overview');
        loading.value = false;
        if (err) {
            error.value = /does not exist|schema cache/i.test(err.message) ? 'One database step for the owner overview is still needed.' : friendlyError(err);
            return;
        }
        error.value = '';
        d.value = data;
    }
    onMounted(() => {
        void load();
        timer = setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    });
    onBeforeUnmount(() => clearInterval(timer));

    const m = computed(() => d.value?.members || {});
    const mod = computed(() => d.value?.moderation_week || {});
    const c = computed(() => d.value?.community_week || { top_earners: [] });
    const weekGrowth = computed(() => (m.value.count != null && m.value.week_ago != null ? m.value.count - m.value.week_ago : null));
    const monthGrowth = computed(() => (m.value.count != null && m.value.month_ago != null ? m.value.count - m.value.month_ago : null));

    const needs = computed(() => {
        const n = d.value?.needs_you || {};
        return [
            { key: 'esc', label: 'escalated cases', value: n.cases_escalated, tab: 'cases', hot: true },
            { key: 'help', label: 'help requests (answer in UWX)', value: n.help_open, tab: '', hot: true },
            { key: 'una', label: 'cases nobody has', value: n.cases_unassigned, tab: 'cases' },
            { key: 'open', label: 'open cases', value: n.cases_open, tab: 'cases' },
            { key: 'rec', label: 'recruits to check', value: n.recruit_claims, tab: 'recruiting' },
            { key: 'par', label: 'partner applications', value: n.partner_applications, tab: 'partners' }
        ].filter((x) => Number(x.value) > 0);
    });
    const needsTotal = computed(() => needs.value.length);

    const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString());
    const signed = (v) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
    const tone = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'bad' : '');
    const dateText = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
    function sinceText(t) {
        const mins = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60000));
        return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
    }
    const asOfText = computed(() => (m.value.as_of ? `synced ${sinceText(m.value.as_of)} ago` : 'not synced yet'));
</script>

<style scoped>
    .needs {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
    }
    .need {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        color: inherit;
        text-decoration: none;
    }
    .need strong {
        font-size: 26px;
        color: var(--acid);
        font-variant-numeric: tabular-nums;
    }
    .need span {
        font-size: 13px;
        opacity: 0.8;
    }
    .need.hot {
        border-color: rgb(255 107 107 / 55%);
    }
    .need.hot strong {
        color: var(--danger, #ff6b6b);
    }
    .ok-line {
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        color: var(--acid);
        font-size: 14px;
    }
    .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
    }
    .tile {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
    }
    .tile span {
        font-size: 12px;
        opacity: 0.7;
    }
    .tile strong {
        font-size: 22px;
        font-variant-numeric: tabular-nums;
    }
    .row-between {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
    }
    .bar {
        height: 8px;
        margin-top: 6px;
        border-radius: 99px;
        background: var(--line);
        overflow: hidden;
    }
    .bar div {
        height: 100%;
        background: var(--acid);
    }
    .sub {
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        opacity: 0.6;
    }
    .line {
        display: flex;
        gap: 10px;
        align-items: baseline;
        padding: 8px 0;
        border-top: 1px solid var(--line);
    }
    .grow {
        flex: 1;
        min-width: 0;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--acid);
        align-self: center;
    }
    .rank {
        width: 16px;
    }
    .pos {
        color: var(--acid);
    }
    .bad {
        color: var(--danger, #ff6b6b);
    }
    h3.label {
        margin-bottom: 8px;
    }
</style>
