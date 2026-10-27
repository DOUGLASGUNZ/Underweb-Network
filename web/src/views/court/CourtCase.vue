<template>
    <section class="wrap page narrow">
        <p class="eyebrow">COURT · FICTIONAL ROLEPLAY</p>
        <p v-if="loading" class="muted">Loading case…</p>
        <template v-else-if="!c">
            <h1 class="page-title">Case not found</h1>
            <p class="muted">Either it doesn't exist, or it is private to the people in it.</p>
            <RouterLink to="/court" class="btn">Back to the court</RouterLink>
        </template>
        <template v-else>
            <h1 class="page-title">Case #{{ c.case_no }}</h1>
            <p class="muted">{{ c.accusation }}</p>
            <div class="card stack">
                <div><strong>{{ c.plaintiff }}</strong> v. <strong>{{ c.defendant }}</strong></div>
                <div>Status: <span class="chip">{{ STATUS_LABELS[c.status] || c.status }}</span></div>
                <div v-if="c.damages_requested">Damages requested: {{ c.damages_requested }} (fictional)</div>
                <div v-if="c.settlement_amount != null">Settlement recorded: {{ c.settlement_amount }} (fictional, no Silk moved)</div>
                <div class="muted small">Visibility: {{ c.publication === 'public' ? 'public record' : 'private to the people in it' }}</div>
                <div v-if="c.poll">
                    <strong>Community poll</strong> {{ c.poll.open ? 'open' : 'closed' }}:
                    {{ c.poll.tally.guilty }} guilty · {{ c.poll.tally.not_guilty }} not guilty
                    <span class="muted small">(this is not the jury or a verdict)</span>
                </div>
            </div>

            <div v-if="c.evidence && c.evidence.length" class="stack">
                <h2>Exhibits</h2>
                <div v-for="e in c.evidence" :key="e.slot" class="card">
                    <div class="small muted">{{ e.label }}</div>
                    <strong>{{ e.title }}</strong>
                    <pre class="exhibit">{{ e.body }}</pre>
                </div>
            </div>

            <div v-if="role === 'defendant' && c.status === 'filed'" class="card stack">
                <h2>Answer this suit</h2>
                <p class="muted small">Declining ends the case. Blocking also stops future suits from this player.</p>
                <div class="cluster">
                    <button class="btn btn-primary" :disabled="busy" @click="respond('accept')">Accept</button>
                    <button class="btn" :disabled="busy" @click="respond('decline')">Decline</button>
                    <button class="btn btn-danger" :disabled="busy" @click="block">Block this player</button>
                </div>
            </div>

            <div v-if="isParty" class="card stack">
                <h2>Publishing</h2>
                <p v-if="role === 'claimant'" class="muted small">You claimed this record by code. You can withdraw consent or request removal, but you can't agree to publish for the guest.</p>
                <p class="muted small">A case becomes public only when both players agree and a judge approves. You can change your mind at any time.</p>
                <div class="cluster">
                    <button class="btn" :disabled="busy || (role === 'claimant' && !myPublishConsent)" @click="consent(!myPublishConsent)">
                        {{ myPublishConsent ? 'Withdraw my consent to publish' : 'I agree to publish' }}
                    </button>
                    <button class="btn btn-ghost" :disabled="busy" @click="requestRemoval">Request removal</button>
                </div>
            </div>

            <div v-if="account.isStaff.value" class="card stack">
                <h2>Judge tools</h2>
                <p class="muted small">Every action here is checked on the server against your staff role.</p>
                <div class="cluster">
                    <button class="btn" :disabled="busy" @click="judge('approve_publication')">Approve publication</button>
                    <button class="btn" :disabled="busy" @click="judge('unpublish')">Take off public record</button>
                    <button class="btn" :disabled="busy" @click="judge('close_poll')">Close community poll</button>
                </div>
                <div class="cluster">
                    <select v-model="verdictChoice" class="input">
                        <option value="guilty">Guilty</option>
                        <option value="not_guilty">Not guilty</option>
                        <option value="dismissed">Dismissed</option>
                    </select>
                    <input v-model.trim="verdictNote" class="input grow" maxlength="300" placeholder="Note (optional)" />
                    <button class="btn btn-primary" :disabled="busy" @click="judge('verdict', { verdict: verdictChoice, note: verdictNote })">Record verdict</button>
                </div>
                <div class="cluster">
                    <input v-model.number="settleAmount" type="number" min="0" max="50000" class="input" placeholder="Settlement amount" />
                    <button class="btn" :disabled="busy" @click="judge('settle', { amount: settleAmount })">Record settlement</button>
                </div>
                <div class="cluster">
                    <select v-model="reissueSide" class="input">
                        <option value="plaintiff">Plaintiff (guest)</option>
                        <option value="defendant">Defendant (guest)</option>
                    </select>
                    <button class="btn" :disabled="busy" @click="reissue">New claim code</button>
                </div>
                <p v-if="newCode" class="card-hi">New code: <strong>{{ newCode.code }}</strong> · expires {{ newCode.expires_at }}. Give it to the guest privately. It won't be shown again.</p>
            </div>

            <p v-if="err" class="error-text">{{ err }}</p>
            <p v-if="ok" class="muted">{{ ok }}</p>
        </template>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import { account, whenAccountReady } from '../../lib/account';
    import { courtCall, courtPublic, courtMessage, STATUS_LABELS } from '../../lib/court';

    const route = useRoute();
    const c = ref(null);
    const loading = ref(true);
    const busy = ref(false);
    const err = ref('');
    const ok = ref('');
    const isParty = ref(false);
    const role = ref('');
    const verdictChoice = ref('guilty');
    const verdictNote = ref('');
    const settleAmount = ref(0);
    const reissueSide = ref('plaintiff');
    const newCode = ref(null);
    const myPublishConsent = ref(false);

    const caseNo = computed(() => Number(route.params.no));

    async function load() {
        loading.value = true;
        err.value = '';
        c.value = null;
        isParty.value = false;
        myPublishConsent.value = false;
        try {
            if (account.signedIn.value) {
                try {
                    const data = await courtCall('case_private', { case_no: caseNo.value });
                    c.value = data.case;
                    isParty.value = true;
                    role.value = data.role || '';
                    myPublishConsent.value = data.my_publish_consent === true;
                } catch {
                    /* not a party: fall through to the public view */
                }
            }
            if (!c.value) {
                const data = await courtPublic('case', { case_no: caseNo.value });
                c.value = data.case;
            }
        } catch {
            c.value = null;
        } finally {
            loading.value = false;
        }
    }

    async function run(fn, success) {
        busy.value = true;
        err.value = '';
        ok.value = '';
        try {
            const result = await fn();
            ok.value = success(result);
            await load();
        } catch (e) {
            err.value = courtMessage(e.message);
        } finally {
            busy.value = false;
        }
    }

    const respond = (decision) => run(() => courtCall('respond', { case_no: caseNo.value, decision }), () => (decision === 'accept' ? 'Accepted. The case is open.' : 'Declined. The case has ended.'));
    const block = () => run(() => courtCall('block', { case_no: caseNo.value }), () => 'Blocked. They will not be able to sue you.');
    const consent = (granted) => run(() => courtCall('consent_publish', { case_no: caseNo.value, granted }), () => (granted ? 'You agreed to publish.' : 'You withdrew your consent.'));
    const requestRemoval = () => run(() => courtCall('request_removal', { case_no: caseNo.value }), () => 'Removal requested. The case is private now and a judge will review it.');
    const judge = (action, extra = {}) => run(() => courtCall(action, { case_no: caseNo.value, ...extra }), () => 'Done.');
    async function reissue() {
        busy.value = true;
        err.value = '';
        try {
            newCode.value = await courtCall('reissue_claim', { case_no: caseNo.value, side: reissueSide.value });
            ok.value = 'New code issued. Give it to the guest now.';
        } catch (e) {
            err.value = courtMessage(e.message);
        } finally {
            busy.value = false;
        }
    }

    onMounted(async () => {
        await whenAccountReady();
        load();
    });
    watch(() => route.params.no, () => load());
    watch(() => account.signedIn.value, () => load());
</script>
