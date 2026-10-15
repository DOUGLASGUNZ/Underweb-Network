<template>
    <section class="wrap page">
        <div class="eyebrow">Your identity</div>
        <h1 class="page-title">Connected accounts</h1>
        <p class="muted intro">
            Linking proves you own these accounts. UnderWeb never asks for your VRChat or Discord password.
        </p>

        <div v-if="lockedFrom" class="notice notice-caution" role="status">
            <strong>{{ lockedLabel }} is for verified members.</strong> Verify your VRChat account below to unlock it.
        </div>

        <div class="grid-auto conns">
            <!-- VRChat -->
            <section class="panel" aria-labelledby="vrc-h">
                <div class="panel-head">
                    <h2 id="vrc-h">VRCHAT</h2>
                    <span class="chip" :class="vrcChip.cls">{{ vrcChip.label }}</span>
                </div>

                <div v-if="loading" class="skeleton" style="height: 120px"></div>

                <template v-else-if="vrcStatus === 'verified'">
                    <p>Verified as <a :href="vrc.profile_url" rel="noopener" target="_blank">{{ vrc.display_name || vrc.external_id }}</a>.</p>
                    <p class="muted small">To change it, ask staff — re-claiming would reset your verification.</p>
                </template>

                <template v-else>
                    <ol class="steps">
                        <li :class="{ done: !!vrc?.verification_code }">
                            <strong>Paste your VRChat profile link</strong>
                            <span class="muted small">On vrchat.com, open your profile and copy the address — it contains <code>usr_</code>.</span>
                            <form class="claim" @submit.prevent="claim">
                                <label class="sr-only" for="vrc-url">VRChat profile link</label>
                                <input
                                    id="vrc-url"
                                    v-model.trim="vrcUrl"
                                    class="input"
                                    inputmode="url"
                                    placeholder="https://vrchat.com/home/user/usr_…"
                                    autocomplete="off" />
                                <button class="btn btn-sm" type="submit" :disabled="busy">{{ vrc?.verification_code ? 'Change' : 'Get my code' }}</button>
                            </form>
                        </li>
                        <li v-if="vrc?.verification_code" :class="{ done: vrcStatus === 'pending' }">
                            <strong>Add this code to your VRChat bio</strong>
                            <div class="code-row">
                                <code class="vcode">{{ vrc.verification_code }}</code>
                                <button class="btn btn-sm btn-ghost" type="button" @click="copyCode">Copy</button>
                            </div>
                            <span class="muted small">Keep it there until staff verify you, then you can remove it.</span>
                        </li>
                        <li v-if="vrc?.verification_code">
                            <strong>Ask staff to check</strong>
                            <button class="btn btn-sm btn-primary" type="button" :disabled="busy || vrcStatus === 'pending'" @click="requestReview">
                                {{ vrcStatus === 'pending' ? 'Waiting for review' : "I've added it — verify me" }}
                            </button>
                            <span v-if="vrcStatus === 'pending'" class="muted small">Submitted {{ relativeTime(vrc.verification_requested_at) }}.</span>
                            <span v-if="vrcStatus === 'denied' || vrcStatus === 'rejected'" class="error-text">
                                Staff couldn't find the code on that profile. Check the bio, then submit again.
                            </span>
                        </li>
                    </ol>
                </template>
                <p v-if="vrcError" class="error-text" role="alert">{{ vrcError }}</p>
            </section>

            <!-- Discord -->
            <section class="panel" aria-labelledby="dc-h">
                <div class="panel-head">
                    <h2 id="dc-h">DISCORD</h2>
                    <span class="chip" :class="dcLinked ? 'chip-acid' : ''">{{ dcLinked ? 'LINKED' : 'NOT LINKED' }}</span>
                </div>
                <div v-if="loading" class="skeleton" style="height: 80px"></div>
                <template v-else>
                    <p v-if="dcIdentity" class="dc-who">
                        <img v-if="dcMeta.avatar" :src="dcMeta.avatar" alt="" width="36" height="36" />
                        <strong>{{ dcMeta.username }}</strong>
                    </p>
                    <p class="muted small">{{ dcNote }}</p>
                    <div class="cluster">
                        <button v-if="!dcIdentity" class="btn btn-primary btn-sm" type="button" :disabled="busy" @click="linkDiscord">Connect Discord</button>
                        <button v-if="dcIdentity || profileDiscordId" class="btn btn-danger btn-sm" type="button" :disabled="busy" @click="unlinkDiscord">Disconnect</button>
                    </div>
                </template>
                <p v-if="dcError" class="error-text" role="alert">{{ dcError }}</p>
            </section>
        </div>
    </section>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { useRoute } from 'vue-router';
    import { supabase, friendlyError } from '../lib/supabase';
    import { account, refreshAccount } from '../lib/account';
    import { relativeTime } from '../lib/format';
    import { toast } from '../lib/toast';

    const route = useRoute();
    const lockedFrom = computed(() => String(route.query.locked || ''));
    const lockedLabel = computed(() => ({ discover: 'Discover', events: 'Events', profile: 'Member profiles' })[lockedFrom.value] || 'That page');

    const loading = ref(true);
    const busy = ref(false);
    const vrc = ref(null);
    const vrcUrl = ref('');
    const vrcError = ref('');
    const user = ref(null);
    const profileDiscordId = ref('');
    const dcError = ref('');
    const dcSyncError = ref('');

    const vrcStatus = computed(() => String(vrc.value?.verification_status || '').toLowerCase());
    const vrcChip = computed(() => {
        if (vrcStatus.value === 'verified') return { label: 'VERIFIED', cls: 'chip-acid' };
        if (vrcStatus.value === 'pending') return { label: 'IN REVIEW', cls: 'chip-caution' };
        if (vrcStatus.value === 'denied' || vrcStatus.value === 'rejected') return { label: 'NEEDS ATTENTION', cls: 'chip-danger' };
        return { label: vrc.value ? 'NOT VERIFIED' : 'NOT CONNECTED', cls: '' };
    });

    const dcIdentity = computed(() => (user.value?.identities || []).find((i) => i.provider === 'discord') || null);
    const dcMeta = computed(() => {
        const d = dcIdentity.value?.identity_data || {};
        return { username: d.full_name || d.name || d.user_name || d.preferred_username || 'Discord account', avatar: d.avatar_url || '', id: d.provider_id || d.sub || '' };
    });
    const dcLinked = computed(() => Boolean(dcIdentity.value) && !dcSyncError.value);
    const dcNote = computed(() => {
        if (dcIdentity.value && dcSyncError.value) {
            if (dcSyncError.value.includes('owned_by_other_user')) return 'This Discord account is linked to a different UnderWeb account. Contact staff — nothing was changed.';
            if (dcSyncError.value.includes('profile_discord_link_conflict')) return 'Your profile has a different Discord linked for bot features. Disconnect first, then connect this one.';
            return 'Discord is connected, but bot features could not be linked yet. Try again later or contact staff.';
        }
        if (dcIdentity.value) return 'Linked for sign-in and UnderWeb bot features (roles, notifications).';
        if (profileDiscordId.value) return 'Bot features are linked but Discord sign-in isn’t. You can disconnect it here.';
        return 'Link Discord to get your UnderWeb roles and notifications in the Discord server.';
    });

    async function load() {
        loading.value = true;
        const [{ data: u }, conn, prof] = await Promise.all([
            supabase.auth.getUser(),
            supabase.from('network_connections').select('*').eq('user_id', account.userId.value).eq('provider', 'vrchat').maybeSingle(),
            supabase.from('profiles').select('discord_user_id').eq('id', account.userId.value).maybeSingle()
        ]);
        user.value = u?.user || null;
        vrc.value = conn.data || null;
        if (vrc.value?.profile_url && !vrcUrl.value) vrcUrl.value = vrc.value.profile_url;
        profileDiscordId.value = prof.data?.discord_user_id || '';
        dcSyncError.value = '';
        if (dcIdentity.value) {
            // The server reads the Discord ID from your verified sign-in identity — not from anything typed here.
            const { error } = await supabase.rpc('uw_sync_my_discord_link');
            dcSyncError.value = error ? String(error.message || '') : '';
        }
        loading.value = false;
    }

    async function claim() {
        vrcError.value = '';
        if (vrcStatus.value === 'verified') return;
        if (!/^https:\/\/(www\.)?vrchat\.com\/home\/user\/usr_[A-Za-z0-9_-]+/i.test(vrcUrl.value)) {
            vrcError.value = 'Paste the full link to your VRChat profile — it starts with https://vrchat.com/home/user/usr_';
            return;
        }
        busy.value = true;
        const { data, error } = await supabase.rpc('uw_claim_vrchat_profile', { p_profile_url: vrcUrl.value });
        busy.value = false;
        if (error) {
            vrcError.value = /already verified to another/i.test(error.message) ? 'That VRChat account is already verified to a different UnderWeb account.' : friendlyError(error);
            return;
        }
        vrc.value = Array.isArray(data) ? data[0] : data;
        await refreshAccount();
    }

    async function requestReview() {
        vrcError.value = '';
        busy.value = true;
        const { error } = await supabase.rpc('uw_request_vrchat_verification');
        busy.value = false;
        if (error) {
            vrcError.value = friendlyError(error);
            return;
        }
        toast('Sent to staff for review.', 'ok');
        await load();
        await refreshAccount();
    }

    async function copyCode() {
        try {
            await navigator.clipboard.writeText(vrc.value.verification_code);
            toast('Code copied.', 'ok');
        } catch {
            toast('Copy failed — select the code and copy it manually.', 'error');
        }
    }

    async function linkDiscord() {
        dcError.value = '';
        busy.value = true;
        const { data, error } = await supabase.auth.linkIdentity({ provider: 'discord', options: { redirectTo: `${window.location.origin}/connections` } });
        busy.value = false;
        if (error) {
            dcError.value = /manual linking/i.test(error.message) ? 'Discord linking is turned off in UnderWeb’s auth settings. Tell staff.' : friendlyError(error);
            return;
        }
        if (data?.url) window.location.assign(data.url);
    }

    async function unlinkDiscord() {
        if (!window.confirm('Disconnect Discord from UnderWeb? Bot features stop working. Server roles may need staff review.')) return;
        dcError.value = '';
        busy.value = true;
        let removedOauth = false;
        try {
            if (dcIdentity.value) {
                if ((user.value?.identities || []).length < 2) throw new Error('Discord is your only sign-in method. Add email sign-in first, or contact staff.');
                const { error } = await supabase.auth.unlinkIdentity(dcIdentity.value);
                if (error) throw error;
                removedOauth = true;
            }
            const { error } = await supabase.rpc('uw_revoke_my_discord_link');
            if (error) throw error;
            toast('Discord disconnected.', 'ok');
        } catch (error) {
            dcError.value = removedOauth
                ? 'Discord sign-in was removed, but the bot link could not be released. Press Disconnect again or contact staff.'
                : friendlyError(error);
        } finally {
            busy.value = false;
            await load();
        }
    }

    onMounted(load);
</script>

<style scoped>
    .intro {
        max-width: 640px;
        margin: 0 0 16px;
    }
    .conns {
        margin-top: 16px;
        align-items: start;
    }
    .steps {
        margin: 0;
        padding-left: 20px;
        display: flex;
        flex-direction: column;
        gap: 18px;
    }
    .steps li {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .steps li.done::marker {
        color: var(--acid);
    }
    .claim {
        display: flex;
        gap: 8px;
    }
    .code-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .vcode {
        font-family: var(--font-mono);
        font-size: 20px;
        letter-spacing: 0.1em;
        color: var(--acid);
        border: 1px dashed var(--line-strong);
        padding: 6px 12px;
        border-radius: var(--radius-sm);
    }
    .dc-who {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .dc-who img {
        border-radius: 50%;
    }
    code {
        font-family: var(--font-mono);
    }
</style>
