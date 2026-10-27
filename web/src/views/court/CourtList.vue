<template>
    <section class="wrap page">
        <p class="eyebrow">THE UNDERWEB COURT · FICTIONAL ROLEPLAY</p>
        <h1 class="page-title">Court</h1>
        <p class="muted">
            Lawsuits for fun, with fictional evidence and fictional damages. Nothing here moves real or in-game currency. You don't need an account to play in the
            world. Accounts unlock filing from the website and a personal record.
        </p>

        <div class="cluster">
            <RouterLink v-if="account.signedIn.value" to="/court/file" class="btn btn-primary">File a suit</RouterLink>
            <RouterLink v-else to="/signin" class="btn btn-primary">Sign in to file</RouterLink>
            <RouterLink to="/court/claim" class="btn">Claim a record</RouterLink>
        </div>

        <div v-if="account.signedIn.value && mine.length" class="stack">
            <h2>Your cases</h2>
            <CaseRow v-for="c in mine" :key="'m' + c.case_no" :c="c" />
        </div>

        <h2>Public record</h2>
        <p v-if="loading" class="muted">Loading the court…</p>
        <p v-else-if="error" class="error-text">{{ error }}</p>
        <p v-else-if="!cases.length" class="muted">No public cases yet. Cases appear here only when both players agree to publish and a judge approves.</p>
        <CaseRow v-for="c in cases" :key="c.case_no" :c="c" />
    </section>
</template>

<script setup>
    import { onMounted, ref, watch, defineComponent, h } from 'vue';
    import { account, whenAccountReady } from '../../lib/account';
    import { courtPublic, courtCall, courtMessage, STATUS_LABELS } from '../../lib/court';

    const cases = ref([]);
    const mine = ref([]);
    const loading = ref(true);
    const error = ref('');

    // A small row component, defined here so the page stays in one file.
    const CaseRow = defineComponent({
        props: { c: { type: Object, required: true } },
        setup(props) {
            return () =>
                h('div', { class: 'card status' }, [
                    h('strong', `#${props.c.case_no} · ${props.c.accusation}`),
                    h('span', { class: 'chip' }, STATUS_LABELS[props.c.status] || props.c.status),
                    h('p', { class: 'muted small' }, `${props.c.plaintiff} v. ${props.c.defendant}${props.c.damages_requested ? ` · requested ${props.c.damages_requested} (fictional)` : ''}`),
                    props.c.poll?.open
                        ? h('p', { class: 'muted small' }, `Community poll: ${props.c.poll.tally.guilty} guilty · ${props.c.poll.tally.not_guilty} not guilty (not the jury)`)
                        : null,
                    h('a', { href: `/court/case/${props.c.case_no}`, class: 'small' }, 'Open case'),
                ]);
        },
    });

    async function load() {
        loading.value = true;
        error.value = '';
        try {
            const data = await courtPublic('list');
            cases.value = data.cases || [];
        } catch (e) {
            error.value = courtMessage(e.message);
        } finally {
            loading.value = false;
        }
        if (account.signedIn.value) {
            try {
                mine.value = (await courtCall('mine')).cases || [];
            } catch (e) {
                mine.value = [];
            }
        }
    }

    onMounted(async () => {
        await whenAccountReady();
        load();
    });
    watch(() => account.signedIn.value, () => load());
</script>
