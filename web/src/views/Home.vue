<template>
    <!-- Signed out: what UnderWeb is -->
    <template v-if="!account.signedIn.value">
        <section class="hero">
            <div class="wrap hero-in">
                <div class="hero-copy">
                    <div class="eyebrow">The UnderWeb Network · VRChat · 18+</div>
                    <h1>Find your people.<br />Build the scene.</h1>
                    <p class="lead">
                        A creator and community network for VRChat — DJs, performers, avatar and world creators, photographers, and the friends
                        who show up. Find collaborators, join events, and keep your crew in one place.
                    </p>
                    <div class="cluster">
                        <RouterLink to="/signin" class="btn btn-primary">Join or sign in</RouterLink>
                        <a href="#what" class="btn">What's here</a>
                    </div>
                </div>
                <div class="hero-art">
                    <img src="/media/hero.webp" alt="UnderWeb members together in a VRChat world" width="640" height="768" />
                </div>
            </div>
        </section>
        <section id="what" class="wrap page">
            <div class="grid-auto">
                <div v-for="f in features" :key="f.title" class="panel feature">
                    <div class="eyebrow">{{ f.kicker }}</div>
                    <h2>{{ f.title }}</h2>
                    <p class="muted">{{ f.body }}</p>
                </div>
            </div>
            <div class="notice notice-acid join-note">
                <strong>How joining works:</strong> sign in with your email, pick a username, then verify you own your VRChat account. Verified members
                get the creator directory, events and projects. We never ask for your VRChat password.
            </div>
        </section>
    </template>

    <!-- Signed in: your dashboard -->
    <section v-else class="wrap page">
        <div class="eyebrow">Welcome back</div>
        <h1 class="page-title">{{ account.displayName.value }}</h1>

        <div v-if="!account.onboarded.value" class="notice notice-caution step">
            <strong>Finish setting up your profile.</strong>
            <RouterLink to="/welcome" class="btn btn-sm btn-primary">Set up profile</RouterLink>
        </div>
        <div v-else-if="!account.hasAccess.value" class="notice notice-caution step">
            <div>
                <strong>{{ accessCopy.title }}</strong>
                <p class="muted small" style="margin: 2px 0 0">{{ accessCopy.body }}</p>
            </div>
            <RouterLink to="/connections" class="btn btn-sm btn-primary">{{ accessCopy.cta }}</RouterLink>
        </div>

        <div class="grid-auto dash">
            <section class="panel" aria-labelledby="ev-h">
                <div class="panel-head">
                    <h2 id="ev-h">UPCOMING EVENTS</h2>
                    <RouterLink v-if="account.hasAccess.value" to="/events" class="small">All events</RouterLink>
                </div>
                <div v-if="eventsLoading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 52px"></div></div>
                <p v-else-if="eventsError" class="error-text">{{ eventsError }}</p>
                <p v-else-if="!events.length" class="muted small">No upcoming events yet. Check back soon.</p>
                <EventRow v-for="ev in events" :key="ev.id" :event="ev" />
            </section>

            <section class="panel" aria-labelledby="pulse-h">
                <div class="panel-head"><h2 id="pulse-h">NETWORK PULSE</h2></div>
                <div v-if="pulseLoading" class="stack"><div v-for="i in 4" :key="i" class="skeleton" style="height: 40px"></div></div>
                <p v-else-if="!pulse.length" class="muted small">Nothing new yet.</p>
                <div v-for="(p, i) in pulse" :key="i" class="row-line pulse">
                    <span class="chip" :class="{ 'chip-acid': p.event_type === 'announcement' }">{{ pulseLabel(p.event_type) }}</span>
                    <div>
                        <div>{{ p.headline }}</div>
                        <div v-if="p.detail" class="muted small">{{ p.detail }}</div>
                        <div class="label" style="margin-top: 2px">{{ relativeTime(p.created_at) }}</div>
                    </div>
                </div>
            </section>

            <section class="panel" aria-labelledby="you-h">
                <div class="panel-head"><h2 id="you-h">YOUR ACCOUNT</h2></div>
                <div class="row-line acct">
                    <span>Roles</span>
                    <span class="cluster" style="justify-content: flex-end">
                        <RoleChip v-for="r in account.state.roles.slice(0, 4)" :key="r.slug" :role="r" />
                        <span v-if="!account.state.roles.length" class="muted small">Member</span>
                    </span>
                </div>
                <div class="row-line acct">
                    <span>VRChat</span>
                    <span :class="account.hasAccess.value ? 'ok' : 'muted'">{{ account.hasAccess.value ? 'Verified' : accessCopy.short }}</span>
                </div>
                <div v-if="account.state.identity?.underweb_id" class="row-line acct">
                    <span>Network ID</span>
                    <span class="label">{{ account.state.identity.underweb_id }}</span>
                </div>
                <div class="cluster" style="margin-top: 12px">
                    <RouterLink to="/me" class="btn btn-sm">View profile</RouterLink>
                    <RouterLink to="/me/edit" class="btn btn-sm">Edit profile</RouterLink>
                </div>
            </section>
        </div>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import EventRow from '../components/EventRow.vue';
    import RoleChip from '../components/RoleChip.vue';
    import { account } from '../lib/account';
    import { supabase, friendlyError } from '../lib/supabase';
    import { relativeTime } from '../lib/format';

    const features = [
        { kicker: 'Discover', title: 'A directory worth sharing', body: 'Verified creators with portfolios, specialties and how to book or collaborate with them.' },
        { kicker: 'Events', title: 'Nights you can find', body: 'Upcoming, live and past UnderWeb events with times in your own time zone.' },
        { kicker: 'Projects', title: 'Build things together', body: 'Open roles on worlds, sets and shoots — apply in a tap, get invited by name.' },
        { kicker: 'Identity', title: 'One verified you', body: 'Link VRChat and Discord once. Your roles and badges follow you across UnderWeb.' }
    ];

    const accessCopy = computed(() => {
        const s = account.state.accessState;
        if (s === 'pending') return { title: 'VRChat verification is waiting for review', body: 'Staff will check your code shortly.', cta: 'View status', short: 'Pending review' };
        if (s === 'needs_attention') return { title: 'Your VRChat verification needs attention', body: 'Staff couldn’t confirm it. Check the code and try again.', cta: 'Fix it', short: 'Needs attention' };
        if (s === 'unverified') return { title: 'Finish verifying your VRChat account', body: 'Put your code in your VRChat bio, then submit.', cta: 'Continue', short: 'Not verified' };
        return { title: 'Verify your VRChat account to unlock UnderWeb', body: 'The directory, events and projects are for verified members.', cta: 'Verify now', short: 'Not connected' };
    });

    const events = ref([]);
    const eventsLoading = ref(false);
    const eventsError = ref('');
    const pulse = ref([]);
    const pulseLoading = ref(false);

    const pulseLabel = (t) => ({ creator: 'Creator', announcement: 'News', profile_picture: 'Profile', event: 'Event' })[t] || 'Update';

    async function load() {
        if (!account.signedIn.value || !account.hasAccess.value) return;
        eventsLoading.value = pulseLoading.value = true;
        const since = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
        const [ev, pu] = await Promise.all([
            supabase
                .from('network_events')
                .select('id,title,starts_at,ends_at,location,group_scope,status,cover_url')
                .eq('status', 'published')
                .gte('starts_at', since)
                .order('starts_at')
                .limit(5),
            supabase.rpc('uw_network_pulse_v2', { p_limit: 6 })
        ]);
        events.value = ev.data || [];
        eventsError.value = ev.error ? friendlyError(ev.error) : '';
        pulse.value = pu.data || [];
        eventsLoading.value = pulseLoading.value = false;
    }

    watch(() => [account.signedIn.value, account.hasAccess.value], load, { immediate: true });
</script>

<style scoped>
    .hero {
        border-bottom: 1px solid var(--line);
    }
    .hero-in {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 40px;
        padding-top: 48px;
        padding-bottom: 48px;
    }
    .hero-copy {
        flex: 1 1 460px;
        min-width: 0;
    }
    .hero-copy h1 {
        font-size: clamp(40px, 8vw, 68px);
        line-height: 1.02;
        margin: 14px 0 18px;
    }
    .lead {
        color: var(--text-2);
        font-size: 18px;
        max-width: 560px;
        margin: 0 0 28px;
    }
    .hero-art {
        flex: 1 1 340px;
        min-width: 0;
    }
    .hero-art img {
        width: 100%;
        height: auto;
        max-height: 460px;
        object-fit: cover;
        object-position: center 30%;
        border-radius: var(--radius);
        border: 1px solid var(--line);
        display: block;
    }
    .feature h2 {
        font-size: 20px;
        margin: 8px 0 6px;
    }
    .feature p {
        margin: 0;
    }
    .join-note {
        margin-top: 20px;
    }
    .step {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 16px 0;
    }
    .dash {
        margin-top: 20px;
        align-items: start;
    }
    .pulse {
        display: flex;
        gap: 12px;
        align-items: flex-start;
    }
    .pulse .chip {
        margin-top: 3px;
    }
    .acct {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
    }
    .ok {
        color: var(--acid);
    }
</style>
