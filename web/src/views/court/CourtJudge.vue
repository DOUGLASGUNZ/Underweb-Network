<template>
    <section class="wrap page">
        <p class="eyebrow">JUDGES · FICTIONAL ROLEPLAY</p>
        <h1 class="page-title">Submit a trial result</h1>
        <p class="muted">
            Trials run in the game. When one finishes, the judge exports the result and pastes it here. The server checks the format and the checksum, then records
            the case. Guest players get their claim codes once, here. Hand each code to its player privately. Never post a code in public.
        </p>

        <div class="card stack">
            <label class="field">
                <span>Result (the exported JSON)</span>
                <textarea v-model="raw" class="input mono" rows="14" spellcheck="false" placeholder='{"format_version": 1, ...}'></textarea>
            </label>
            <p v-if="err" class="error-text">{{ err }}</p>
            <button class="btn btn-primary" :disabled="busy || !raw.trim()" @click="submit">{{ busy ? 'Checking…' : 'Submit result' }}</button>
        </div>

        <div v-if="codes" class="card stack">
            <h2>Claim codes for case #{{ caseNo }}</h2>
            <p class="muted small">These are shown once and expire in 10 minutes. Hand each one to its player privately.</p>
            <div v-for="c in codes" :key="c.side" class="card">
                <div class="small muted">{{ c.side === 'plaintiff' ? 'Plaintiff' : 'Defendant' }} · {{ c.label }}</div>
                <strong class="code">{{ c.code }}</strong>
            </div>
            <button class="btn" @click="codes = null">I've handed them out</button>
        </div>
    </section>
</template>

<script setup>
    import { ref } from 'vue';
    import { courtCall, courtMessage } from '../../lib/court';

    const raw = ref('');
    const busy = ref(false);
    const err = ref('');
    const codes = ref(null);
    const caseNo = ref(null);

    async function submit() {
        busy.value = true;
        err.value = '';
        try {
            let result;
            try {
                result = JSON.parse(raw.value);
            } catch {
                throw new Error('INVALID_REQUEST');
            }
            const data = await courtCall('submit_result', { result });
            caseNo.value = data.case_no;
            codes.value = data.claim_codes;
            raw.value = '';
        } catch (e) {
            err.value = courtMessage(e.message);
        } finally {
            busy.value = false;
        }
    }
</script>
