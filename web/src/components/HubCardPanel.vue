<template>
    <section class="card hub" aria-labelledby="hub-h">
        <div class="head">
            <div>
                <p class="eyebrow">THE HUB</p>
                <h2 id="hub-h">YOUR HUB CARD</h2>
                <p class="muted small">Get your work into the hub's Creator Room. Staff approve every card first; any change sends it back for review.</p>
            </div>
            <label v-if="data?.card" class="switch">
                <input type="checkbox" :checked="data.card.enabled !== false" :disabled="busy" @change="toggle($event.target.checked)" />
                Show in the hub
            </label>
        </div>

        <div v-if="loading" class="skeleton" style="height: 220px"></div>
        <p v-else-if="loadError" class="error-text">{{ loadError }}</p>
        <p v-else-if="data?.notReady" class="muted">Hub cards are being switched on — check back soon.</p>
        <template v-else-if="data">
            <p class="status" :class="statusClass">
                <strong>{{ statusTitle }}</strong> {{ statusText }}
            </p>

            <form class="form" @submit.prevent="save">
                <fieldset class="kinds">
                    <legend>What kind of card?</legend>
                    <label :class="{ on: form.kind === 'market' }">
                        <input v-model="form.kind" type="radio" value="market" />
                        <b>Creator Market</b>
                        <small>Avatars, assets, art — with a QR code to your shop</small>
                    </label>
                    <label :class="{ on: form.kind === 'dj' }">
                        <input v-model="form.kind" type="radio" value="dj" />
                        <b>Resident DJ</b>
                        <small>On the stage screen with a QR code to your music</small>
                    </label>
                </fieldset>

                <fieldset>
                    <legend>Card image</legend>
                    <div v-if="data.images.length" class="images">
                        <label v-for="im in data.images" :key="im.url" class="img" :class="{ on: form.image_url === im.url }">
                            <input v-model="form.image_url" type="radio" :value="im.url" class="sr-only" />
                            <img :src="im.url" alt="" loading="lazy" />
                            <span>{{ im.label }}</span>
                        </label>
                    </div>
                    <p v-else class="muted small">Add a profile picture, banner or an approved showcase piece first.</p>
                    <p v-if="form.kind === 'dj'" class="hint">DJs: a logo with a transparent background looks best.</p>
                </fieldset>

                <div class="fields">
                    <label class="field">
                        <span>Headline <small class="muted">(max 60)</small></span>
                        <input v-model="form.headline" class="input" maxlength="60" :placeholder="form.kind === 'dj' ? 'DJ · Rapper · Producer' : 'Digital art · Avatars · Commissions'" />
                    </label>
                    <label class="field">
                        <span>Main link <small class="muted">(shop, SoundCloud, Twitch… https:// only)</small></span>
                        <input v-model="form.link_url" class="input" maxlength="200" inputmode="url" placeholder="https://" />
                    </label>
                    <label v-if="form.kind === 'market'" class="field">
                        <span>Button label</span>
                        <input v-model="form.link_label" class="input" maxlength="40" placeholder="SHOP" />
                    </label>
                    <label v-else class="field">
                        <span>Second link <small class="muted">(optional)</small></span>
                        <input v-model="form.extra_link_url" class="input" maxlength="200" inputmode="url" placeholder="https://" />
                    </label>
                </div>

                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <div class="cluster">
                    <button class="btn btn-primary" type="submit" :disabled="busy || !data.images.length">
                        {{ busy ? 'Saving…' : data.card ? 'Save & send for review' : 'Create my hub card' }}
                    </button>
                    <button v-if="data.card" class="btn btn-danger" type="button" :disabled="busy" @click="remove">Remove card</button>
                </div>
            </form>

        </template>
    </section>
</template>

<script setup>
    import { computed, onMounted, reactive, ref } from 'vue';
    import { account } from '../lib/account';
    import { friendlyError } from '../lib/supabase';
    import { toast } from '../lib/toast';
    import { loadMyHubCard, removeHubCard, saveHubCard, setHubCardEnabled } from '../lib/hubCard';

    const emit = defineEmits(['reviewer']);
    const data = ref(null);
    const loading = ref(true);
    const loadError = ref('');
    const busy = ref(false);
    const error = ref('');
    const form = reactive({ kind: 'market', image_url: '', headline: '', link_url: '', link_label: 'SHOP', extra_link_url: '' });

    async function load() {
        loading.value = true;
        loadError.value = '';
        try {
            const d = await loadMyHubCard(account.userId.value);
            data.value = d;
            if (!d.notReady) {
                const c = d.card || {};
                Object.assign(form, {
                    kind: c.kind || 'market',
                    image_url: c.image_url || d.images[0]?.url || '',
                    headline: c.headline || '',
                    link_url: c.link_url || d.profile.shop_url || '',
                    link_label: c.link_label || d.profile.shop_label || 'SHOP',
                    extra_link_url: c.extra_link_url || ''
                });
                emit('reviewer', d.reviewer);
            }
        } catch (e) {
            loadError.value = friendlyError(e);
        }
        loading.value = false;
    }
    onMounted(load);

    const status = computed(() => data.value?.card?.status || 'none');
    const statusClass = computed(() => `s-${status.value}`);
    const statusTitle = computed(() => ({ none: 'NO CARD YET', approved: 'APPROVED', rejected: 'NOT APPROVED', pending: 'PENDING' })[status.value] || status.value.toUpperCase());
    const statusText = computed(() => {
        const c = data.value?.card;
        if (!c) return 'Fill this in and staff will review it.';
        if (c.status === 'approved') return c.enabled ? "It's in the hub's Creator Room (updates within the hour)." : 'Switched off — turn it on to show it in the hub.';
        if (c.status === 'rejected') return `${c.review_note ? `Staff said: ${c.review_note}. ` : ''}Change it and save to send it again.`;
        return 'Waiting for staff to approve it.';
    });

    async function run(fn, ok) {
        busy.value = true;
        error.value = '';
        try {
            await fn();
            if (ok) toast(ok, 'ok');
            await load();
        } catch (e) {
            error.value = friendlyError(e);
        }
        busy.value = false;
    }
    const save = () => run(() => saveHubCard(account.userId.value, form), 'Saved — staff will review your hub card.');
    const toggle = (on) => run(() => setHubCardEnabled(account.userId.value, on), on ? 'Your card will show in the hub.' : 'Your card is hidden from the hub.');
    const remove = () => {
        if (!window.confirm('Remove your hub card? It disappears from the hub at the next update.')) return;
        run(() => removeHubCard(account.userId.value), 'Hub card removed.');
    };
</script>

<style scoped>
    .head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
    }
    .head .eyebrow {
        margin: 0;
        font-size: 12px;
    }
    .head h2 {
        font-size: 32px;
        margin: 4px 0 6px;
    }
    .head p.small {
        margin: 0;
        max-width: 560px;
    }
    .switch {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        min-height: 44px;
    }
    .switch input {
        width: 20px;
        height: 20px;
        accent-color: var(--acid);
    }
    .status {
        margin: 18px 0;
        padding: 12px 14px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--line-strong);
        background: var(--panel-2);
    }
    .status strong {
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0.1em;
        margin-right: 6px;
    }
    .s-approved {
        border-color: var(--acid);
    }
    .s-approved strong {
        color: var(--acid);
    }
    .s-pending strong {
        color: var(--caution);
    }
    .s-rejected {
        border-color: rgba(255, 92, 104, 0.5);
    }
    .s-rejected strong {
        color: #ff8a93;
    }
    .form {
        display: flex;
        flex-direction: column;
        gap: 18px;
    }
    fieldset {
        border: 0;
        margin: 0;
        padding: 0;
    }
    legend {
        font-weight: 700;
        margin-bottom: 8px;
    }
    .kinds {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 10px;
    }
    .kinds legend {
        grid-column: 1 / -1;
    }
    .kinds label {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: 10px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        cursor: pointer;
    }
    .kinds label.on {
        border-color: var(--acid);
        background: #06120a;
    }
    .kinds input {
        grid-row: span 2;
        accent-color: var(--acid);
    }
    .kinds small {
        color: var(--muted);
    }
    .images {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 10px;
    }
    .img {
        position: relative;
        display: flex;
        flex-direction: column;
        border: 2px solid var(--line);
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        background: var(--panel-2);
    }
    .img.on {
        border-color: var(--acid);
    }
    .img img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
    }
    .img span {
        padding: 6px 8px;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .wall-check {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 20px;
        height: 20px;
        accent-color: var(--acid);
    }
    .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: 14px;
    }
    .wall {
        margin-top: 28px;
        padding-top: 22px;
        border-top: 1px solid var(--line);
    }
    .wall h3 {
        font-size: 18px;
    }
    .wall p {
        margin: 4px 0 12px;
    }
</style>
