<template>
    <section aria-labelledby="av-h" class="stack">
        <div class="panel-head"><h2 id="av-h">Staff availability</h2></div>

        <form class="panel stack" @submit.prevent="save">
            <h3 class="label">Your week</h3>
            <div class="grid2">
                <label class="field">
                    <span>Your time zone</span>
                    <select v-model="mine.timezone" class="select">
                        <option v-for="z in zones" :key="z" :value="z">{{ z.replace(/_/g, ' ') }}</option>
                    </select>
                </label>
                <label class="field">
                    <span>Community</span>
                    <select v-model="mine.scope" class="select">
                        <option v-for="[k, l] in SCOPES" :key="k" :value="k">{{ l }}</option>
                    </select>
                </label>
            </div>
            <div class="week">
                <div v-for="d in mine.days" :key="d.day" class="day">
                    <strong class="day-name">{{ cap(d.day) }}</strong>
                    <select v-model="d.status" class="select" :aria-label="cap(d.day) + ' availability'">
                        <option v-for="[k, l] in AVAILABILITY" :key="k" :value="k">{{ l }}</option>
                    </select>
                    <template v-if="d.status !== 'unavailable'">
                        <input v-model="d.start" class="input" type="time" :aria-label="cap(d.day) + ' from'" />
                        <input v-model="d.end" class="input" type="time" :aria-label="cap(d.day) + ' until'" />
                    </template>
                    <span v-else class="muted small off">Off</span>
                </div>
            </div>
            <label class="field"><span>Preferred role (optional)</span><input v-model.trim="mine.role" class="input" maxlength="60" placeholder="Security, door, DJ support…" /></label>
            <label class="field"><span>Notes (optional)</span><input v-model.trim="mine.notes" class="input" maxlength="300" /></label>
            <p v-if="saveError" class="error-text">{{ saveError }}</p>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save my week' }}</button>
        </form>

        <div>
            <div class="panel-head">
                <h3 class="label">Team this week</h3>
                <label class="view">
                    Show times in
                    <select v-model="viewZone" class="select">
                        <option value="America/New_York">Eastern</option>
                        <option :value="localZone">My time ({{ localZone.replace(/_/g, ' ') }})</option>
                    </select>
                </label>
            </div>
            <div v-if="teamLoading" class="skeleton" style="height: 160px"></div>
            <p v-else-if="teamError" class="error-text">{{ teamError }}</p>
            <div v-else-if="!team.length" class="notice">No one has set their availability yet.</div>
            <div v-else class="table-wrap">
                <table class="team">
                    <thead>
                        <tr>
                            <th scope="col">Staff</th>
                            <th v-for="d in DAYS" :key="d" scope="col">{{ cap(d).slice(0, 3) }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="p in team" :key="p.user_id">
                            <th scope="row">
                                {{ p.name }}
                                <div v-if="p.role" class="muted small">{{ p.role }}</div>
                            </th>
                            <td v-for="(d, i) in DAYS" :key="d" :class="'st-' + (p.days[i]?.status || 'none')">
                                <template v-if="p.days[i] && p.days[i].status !== 'unavailable'">
                                    <span class="st">{{ statusShort(p.days[i].status) }}</span>
                                    <span v-if="p.days[i].start" class="tm">{{ convert(p, p.days[i]) }}</span>
                                </template>
                                <span v-else class="muted">—</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </section>
</template>

<script setup>
    import { onMounted, reactive, ref } from 'vue';
    import { supabase, friendlyError } from '../../lib/supabase';
    import { account } from '../../lib/account';
    import { AVAILABILITY, DAYS, SCOPES } from '../../lib/staff';
    import { localTimeZone } from '../../lib/format';
    import { toast } from '../../lib/toast';

    const localZone = localTimeZone();
    const viewZone = ref('America/New_York');
    const zones = (() => {
        try {
            return Intl.supportedValuesOf('timeZone');
        } catch {
            return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'];
        }
    })();
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const statusShort = (s) => ({ available: 'On', limited: 'Limited', by_request: 'Ask' })[s] || s;

    const mine = reactive({
        timezone: localZone,
        scope: 'underweb',
        role: '',
        notes: '',
        days: DAYS.map((day) => ({ day, status: 'unavailable', start: '20:00', end: '23:00' }))
    });
    const saving = ref(false);
    const saveError = ref('');
    const team = ref([]);
    const teamLoading = ref(true);
    const teamError = ref('');

    // Convert a staff member's local "HH:MM" on a weekday into the viewing zone.
    function convert(person, d) {
        const fmt = (t) => {
            if (!t) return '';
            const [h, m] = t.split(':').map(Number);
            // Use this week's date for that weekday, so daylight-saving time is right for now.
            const today = new Date();
            const diff = DAYS.indexOf(d.day) - today.getDay();
            const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + diff, h, m));
            const offset = (zone) => {
                const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(base);
                const get = (type) => Number(parts.find((p) => p.type === type).value);
                return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute')) - base.getTime();
            };
            const instant = new Date(base.getTime() - offset(person.timezone || 'America/New_York'));
            return instant.toLocaleTimeString('en-US', { timeZone: viewZone.value, hour: 'numeric', minute: '2-digit' });
        };
        return `${fmt(d.start)}–${fmt(d.end)}`;
    }

    async function loadMine() {
        const { data } = await supabase
            .from('staff_availability')
            .select('day_of_week,status,start_time,end_time,preferred_role,notes,timezone,group_scope')
            .eq('user_id', account.userId.value);
        if (!data?.length) return;
        const first = data[0];
        mine.timezone = first.timezone || localZone;
        mine.scope = first.group_scope || 'underweb';
        mine.role = first.preferred_role || '';
        mine.notes = first.notes || '';
        data.forEach((r) => {
            const d = mine.days[r.day_of_week];
            if (!d) return;
            d.status = r.status || 'unavailable';
            if (r.start_time) d.start = r.start_time.slice(0, 5);
            if (r.end_time) d.end = r.end_time.slice(0, 5);
        });
    }

    async function loadTeam() {
        teamLoading.value = true;
        const { data, error } = await supabase.rpc('uw_staff_availability_directory');
        teamLoading.value = false;
        if (error) {
            teamError.value = friendlyError(error);
            return;
        }
        const people = {};
        (data || []).forEach((r) => {
            const p = (people[r.user_id] ||= { user_id: r.user_id, name: r.staff_name, role: r.preferred_role, timezone: r.timezone, days: [] });
            p.days[r.day_of_week] = { day: DAYS[r.day_of_week], status: r.status, start: r.start_time?.slice(0, 5) || '', end: r.end_time?.slice(0, 5) || '' };
        });
        team.value = Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
    }

    async function save() {
        saveError.value = '';
        const bad = mine.days.find((d) => d.status !== 'unavailable' && (!d.start || !d.end));
        if (bad) {
            saveError.value = `Set both times for ${cap(bad.day)}, or mark it Off.`;
            return;
        }
        saving.value = true;
        const { error } = await supabase.rpc('save_my_staff_availability', {
            p_group_scope: mine.scope,
            p_preferred_role: mine.role,
            p_notes: mine.notes,
            p_timezone: mine.timezone,
            p_schedule: mine.days.map((d) => ({ day_of_week: d.day, status: d.status, start_time: d.status === 'unavailable' ? '' : d.start, end_time: d.status === 'unavailable' ? '' : d.end }))
        });
        saving.value = false;
        if (error) {
            saveError.value = /Staff access required/.test(error.message) ? 'Availability is for Event Staff and above.' : friendlyError(error);
            return;
        }
        toast('Your week is saved.', 'ok');
        await loadTeam();
    }

    onMounted(() => {
        void loadMine();
        void loadTeam();
    });
</script>

<style scoped>
    .grid2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
        gap: 12px;
    }
    .week {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .day {
        display: grid;
        grid-template-columns: 96px minmax(120px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr);
        gap: 8px;
        align-items: center;
    }
    @media (max-width: 560px) {
        .day {
            grid-template-columns: 1fr 1fr;
        }
        .day-name {
            grid-column: 1 / -1;
        }
    }
    .off {
        grid-column: span 2;
    }
    .view {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--muted);
    }
    .view .select {
        min-height: 36px;
        padding: 4px 8px;
        width: auto;
    }
    .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: var(--radius);
    }
    .team {
        border-collapse: collapse;
        width: 100%;
        min-width: 760px;
        font-size: 13px;
    }
    .team th,
    .team td {
        padding: 10px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
    }
    .team thead th {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.1em;
        color: var(--muted);
        text-transform: uppercase;
    }
    .st {
        display: block;
        font-weight: 600;
    }
    .tm {
        display: block;
        color: var(--text-2);
        white-space: nowrap;
    }
    .st-available .st {
        color: var(--acid);
    }
    .st-limited .st,
    .st-by_request .st {
        color: var(--caution);
    }
</style>
