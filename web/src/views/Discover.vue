<template>
    <section class="wrap page">
        <div class="eyebrow">Creator network</div>
        <h1 class="page-title">Discover</h1>
        <p class="muted intro">DJs, performers, artists and builders across UnderWeb. Open a profile to see their work and how to reach them.</p>

        <form class="filters" role="search" @submit.prevent>
            <label class="field grow">
                <span>Search</span>
                <input v-model.trim="q" class="input" type="search" placeholder="Name, specialty or skill" />
            </label>
            <label class="field">
                <span>Specialty</span>
                <select v-model="specialty" class="select">
                    <option value="">All</option>
                    <option v-for="s in specialtyOptions" :key="s" :value="s">{{ s }}</option>
                </select>
            </label>
            <label class="check">
                <input v-model="collabOnly" type="checkbox" />
                Open to collabs
            </label>
        </form>

        <div v-if="loading" class="cards">
            <div v-for="i in 6" :key="i" class="skeleton" style="height: 260px"></div>
        </div>
        <p v-else-if="error" class="error-text" role="alert">{{ error }}</p>
        <template v-else>
            <p class="muted small count">{{ filtered.length }} of {{ creators.length }} creators</p>
            <div v-if="filtered.length" class="cards">
                <RouterLink v-for="c in filtered" :key="c.user_id" :to="`/u/${c.user_id}`" class="card">
                    <div class="banner">
                        <img v-if="c.banner_url" :src="c.banner_url" alt="" loading="lazy" />
                    </div>
                    <div class="card-body">
                        <Avatar :src="c.avatar_url" :name="c.display_name" :size="56" class="card-av" />
                        <h2>{{ c.display_name || 'Creator' }}</h2>
                        <p class="headline">{{ c.headline || c.primary_specialty || 'UnderWeb creator' }}</p>
                        <div class="cluster tags">
                            <span v-for="t in tagsFor(c).slice(0, 3)" :key="t" class="chip">{{ t }}</span>
                            <span v-if="c.collaboration_friendly" class="chip chip-acid">Collabs</span>
                        </div>
                    </div>
                </RouterLink>
            </div>
            <div v-else class="notice">No creators match. Try a different search or clear the filters.</div>
        </template>

        <section class="panel people" aria-labelledby="people-h">
            <h2 id="people-h" class="label">Looking for someone who isn't a creator?</h2>
            <form class="claim" @submit.prevent="searchPeople">
                <label class="sr-only" for="people-q">Member name</label>
                <input id="people-q" v-model.trim="peopleQ" class="input" placeholder="Display name or @username" />
                <button class="btn btn-sm" type="submit" :disabled="peopleQ.length < 2 || peopleBusy">Find</button>
            </form>
            <p v-if="peopleNote" class="muted small">{{ peopleNote }}</p>
            <div v-for="p in people" :key="p.user_id" class="row-line person">
                <RouterLink :to="`/u/${p.username || p.user_id}`">{{ p.display_name || p.username }}</RouterLink>
                <span v-if="p.username" class="muted small">@{{ p.username }}</span>
            </div>
        </section>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import Avatar from '../components/Avatar.vue';
    import { supabase, friendlyError } from '../lib/supabase';

    const creators = ref([]);
    const loading = ref(true);
    const error = ref('');
    const q = ref('');
    const specialty = ref('');
    const collabOnly = ref(false);

    const tagsFor = (c) => [c.primary_specialty, ...(c.specialties || []), ...(c.secondary_specialties || [])].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i);

    const specialtyOptions = computed(() => {
        const set = new Set();
        creators.value.forEach((c) => tagsFor(c).forEach((t) => set.add(t)));
        return [...set].sort((a, b) => a.localeCompare(b));
    });

    const filtered = computed(() => {
        const needle = q.value.toLowerCase();
        return creators.value.filter((c) => {
            if (collabOnly.value && !c.collaboration_friendly) return false;
            if (specialty.value && !tagsFor(c).includes(specialty.value)) return false;
            if (!needle) return true;
            const hay = [c.display_name, c.headline, c.bio, ...tagsFor(c), ...(c.skills || []), ...(c.genres_styles || [])].join(' ').toLowerCase();
            return hay.includes(needle);
        });
    });

    onMounted(async () => {
        const { data, error: err } = await supabase
            .from('creator_profiles')
            .select('user_id,display_name,headline,bio,primary_specialty,secondary_specialties,specialties,skills,genres_styles,collaboration_friendly,avatar_url,banner_url,approval_status,public_visible')
            .eq('public_visible', true)
            .order('display_name');
        loading.value = false;
        if (err) {
            error.value = friendlyError(err);
            return;
        }
        creators.value = data || [];
    });

    const peopleQ = ref('');
    const people = ref([]);
    const peopleNote = ref('');
    const peopleBusy = ref(false);
    async function searchPeople() {
        peopleBusy.value = true;
        const { data, error: err } = await supabase.rpc('uw_search_people', { p_query: peopleQ.value.replace(/^@/, ''), p_limit: 20 });
        peopleBusy.value = false;
        people.value = data || [];
        peopleNote.value = err ? friendlyError(err) : people.value.length ? '' : 'No members found.';
    }
</script>

<style scoped>
    .intro {
        max-width: 640px;
        margin: 0 0 20px;
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-end;
        margin-bottom: 16px;
    }
    .grow {
        flex: 1 1 260px;
    }
    .check {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        cursor: pointer;
    }
    .check input {
        width: 18px;
        height: 18px;
        accent-color: var(--acid);
    }
    .count {
        margin: 0 0 10px;
    }
    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
        gap: 14px;
    }
    .card {
        display: block;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel);
        overflow: hidden;
        color: var(--text);
        transition: border-color 0.15s, transform 0.15s;
    }
    .card:hover {
        border-color: var(--line-strong);
        transform: translateY(-2px);
        color: var(--text);
    }
    .banner {
        height: 84px;
        background:
            radial-gradient(circle at 30% 120%, rgba(61, 245, 20, 0.18), transparent 60%),
            var(--panel-2);
    }
    .banner img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .card-body {
        padding: 0 16px 16px;
    }
    .card-av {
        margin-top: -28px;
        border: 2px solid var(--void);
    }
    .card h2 {
        font-size: 18px;
        margin: 8px 0 2px;
    }
    .headline {
        color: var(--muted);
        font-size: 13px;
        margin: 0 0 10px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .people {
        margin-top: 28px;
        max-width: 560px;
    }
    .claim {
        display: flex;
        gap: 8px;
        margin-top: 10px;
    }
    .person {
        display: flex;
        gap: 10px;
        align-items: baseline;
    }
</style>
