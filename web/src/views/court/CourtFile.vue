<template>
    <section class="wrap page narrow">
        <p class="eyebrow">FILE A SUIT · FICTIONAL ROLEPLAY</p>
        <h1 class="page-title">{{ countersuitOf ? 'Countersue' : 'File a suit' }}</h1>
        <p class="muted">
            The other player can accept or decline. Declining ends the case. One filing per day, and nothing is charged to anyone. The case stays private unless
            both players agree to publish and a judge approves.
        </p>

        <div v-if="countersuitOf" class="card-hi">Countersuing case #{{ countersuitOf }}. You will be the defendant's counterpart in a new case.</div>

        <form class="card stack" @submit.prevent="submit">
            <label class="field">
                <span>Who are you suing?</span>
                <input v-model.trim="q" class="input" placeholder="Name or username (at least 2 letters)" :disabled="!!countersuitOf" @input="search" />
            </label>
            <ul v-if="results.length && !countersuitOf" class="list">
                <li v-for="m in results" :key="m.user_id">
                    <button type="button" class="btn btn-sm" :class="{ 'btn-primary': picked?.user_id === m.user_id }" @click="picked = m">
                        {{ m.label }}
                    </button>
                </li>
            </ul>
            <p v-if="!results.length && searched && !countersuitOf" class="muted small">No public member matches that. Only public profiles can be sued from here.</p>

            <label class="field">
                <span>Charge</span>
                <select v-model="accusation" class="input" required>
                    <option value="" disabled>Pick a charge</option>
                    <option v-for="r in reasons" :key="r.id" :value="r.id">{{ r.text }}</option>
                </select>
            </label>
            <label class="field">
                <span>Damages requested (fictional, 0–50,000)</span>
                <input v-model.number="damages" type="number" min="0" max="50000" class="input" required />
            </label>

            <p v-if="err" class="error-text">{{ err }}</p>
            <p v-if="done" class="card-hi">
                Filed as case #{{ done }}. The other player has been asked to answer.
                <RouterLink :to="`/court/case/${done}`">Open the case</RouterLink>
            </p>
            <button class="btn btn-primary" type="submit" :disabled="busy || (!picked && !countersuitOf) || !accusation">
                {{ busy ? 'Filing…' : countersuitOf ? 'File countersuit' : 'File suit' }}
            </button>
        </form>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { useRoute } from 'vue-router';
    import { account, whenAccountReady } from '../../lib/account';
    import { courtCall, courtPublic, courtMessage } from '../../lib/court';

    const route = useRoute();
    const countersuitOf = computed(() => (route.query.countersuit ? Number(route.query.countersuit) : null));
    const q = ref('');
    const results = ref([]);
    const searched = ref(false);
    const picked = ref(null);
    const reasons = ref([]);
    const accusation = ref('');
    const damages = ref(0);
    const busy = ref(false);
    const err = ref('');
    const done = ref(null);

    let timer = null;
    function search() {
        clearTimeout(timer);
        if (q.value.length < 2) { results.value = []; searched.value = false; return; }
        timer = setTimeout(async () => {
            try {
                results.value = (await courtCall('find', { q: q.value })).members || [];
            } catch (e) {
                results.value = [];
                err.value = courtMessage(e.message);
            }
            searched.value = true;
        }, 250);
    }

    async function submit() {
        busy.value = true;
        err.value = '';
        try {
            const body = countersuitOf.value
                ? { countersuit_case_no: countersuitOf.value, accusation_id: accusation.value, damages_requested: damages.value }
                : { defendant_user_id: picked.value.user_id, accusation_id: accusation.value, damages_requested: damages.value };
            const data = await courtCall('file', body);
            done.value = data.case_no;
        } catch (e) {
            err.value = courtMessage(e.message);
        } finally {
            busy.value = false;
        }
    }

    onMounted(async () => {
        await whenAccountReady();
        try {
            reasons.value = (await courtPublic('reasons')).reasons || [];
        } catch {
            err.value = 'The charge list could not be loaded. Try again in a moment.';
        }
    });
</script>
