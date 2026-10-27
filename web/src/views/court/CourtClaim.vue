<template>
    <section class="wrap page narrow">
        <p class="eyebrow">CLAIM A RECORD · FICTIONAL ROLEPLAY</p>
        <h1 class="page-title">Claim a record</h1>
        <p class="muted">
            If a judge gave you a code for a case you were in during a game, enter it here to add that case to your history. The record will be marked
            <strong>self-claimed</strong>. A code shows you have it. It does not prove you own a VRChat account.
        </p>
        <form class="card stack" @submit.prevent="submit">
            <label class="field"><span>Case number</span><input v-model.number="caseNo" type="number" min="1" class="input" required /></label>
            <label class="field"><span>Code</span><input v-model.trim="code" class="input" maxlength="20" placeholder="XXXXX-XXXXX" required autocomplete="off" /></label>
            <p v-if="err" class="error-text">{{ err }}</p>
            <p v-if="done" class="card-hi">Claimed. This case is now in your history, marked self-claimed. <RouterLink to="/court">Back to the court</RouterLink></p>
            <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? 'Checking…' : 'Claim' }}</button>
        </form>
    </section>
</template>

<script setup>
    import { ref } from 'vue';
    import { courtCall, courtMessage } from '../../lib/court';

    const caseNo = ref(null);
    const code = ref('');
    const busy = ref(false);
    const err = ref('');
    const done = ref(false);

    async function submit() {
        busy.value = true;
        err.value = '';
        try {
            await courtCall('redeem', { case_no: caseNo.value, code: code.value });
            done.value = true;
            code.value = '';
        } catch (e) {
            err.value = courtMessage(e.message);
        } finally {
            busy.value = false;
        }
    }
</script>
