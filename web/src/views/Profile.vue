<template>
    <section class="page">
        <div v-if="state === 'loading'" class="wrap">
            <div class="skeleton" style="height: 200px"></div>
            <div class="skeleton" style="height: 120px; margin-top: 16px"></div>
        </div>

        <div v-else-if="state === 'locked'" class="wrap">
            <div class="notice notice-caution">
                <strong>Member profiles are for verified members.</strong>
                <p class="muted small">Verify your VRChat account to view other people's profiles.</p>
                <RouterLink to="/connections" class="btn btn-sm btn-primary">Verify now</RouterLink>
            </div>
        </div>

        <div v-else-if="state === 'missing'" class="wrap">
            <h1 class="page-title">Profile not found</h1>
            <p class="muted">That member doesn't exist, or their profile is private.</p>
            <RouterLink to="/discover" class="btn">Back to Discover</RouterLink>
        </div>

        <div v-else-if="state === 'error'" class="wrap">
            <p class="error-text" role="alert">{{ error }}</p>
            <button class="btn" type="button" @click="load">Try again</button>
        </div>

        <template v-else-if="p">
            <div class="wrap">
                <div class="banner">
                    <img v-if="p.bannerUrl" :src="p.bannerUrl" alt="" />
                </div>
                <header class="head">
                    <Avatar :src="p.avatarUrl" :name="p.displayName" :size="120" class="head-av" />
                    <div class="head-text">
                        <div class="cluster">
                            <h1>{{ p.displayName }}</h1>
                            <span v-if="p.vrchat" class="chip chip-acid" title="VRChat account verified">✓ VRCHAT</span>
                        </div>
                        <div class="muted small">
                            <span v-if="p.username">@{{ p.username }}</span>
                            <span v-if="p.title"> · {{ p.title }}</span>
                            <span v-if="p.underwebId"> · {{ p.underwebId }}</span>
                        </div>
                        <p v-if="p.creator?.headline" class="headline">{{ p.creator.headline }}</p>
                    </div>
                    <div class="head-actions cluster">
                        <RouterLink v-if="isMe" to="/me/edit" class="btn btn-primary btn-sm">Edit profile</RouterLink>
                        <a v-if="p.creator?.shop_url" :href="p.creator.shop_url" class="btn btn-sm" rel="noopener nofollow" target="_blank">
                            {{ p.creator.shop_label || 'Shop / commissions' }} ↗
                        </a>
                    </div>
                </header>
            </div>

            <div class="wrap layout">
                <aside class="side stack">
                    <section v-if="p.roles.length" class="panel">
                        <h2 class="label">Roles</h2>
                        <div class="cluster" style="margin-top: 10px">
                            <RoleChip v-for="r in p.roles" :key="r.slug" :role="r" />
                        </div>
                    </section>
                    <section class="panel">
                        <h2 class="label">Verified accounts</h2>
                        <div class="row-line acct">
                            <span>VRChat</span>
                            <a v-if="p.vrchat?.profile_url" :href="p.vrchat.profile_url" target="_blank" rel="noopener">{{ p.vrchat.display_name || 'Profile' }} ↗</a>
                            <span v-else class="muted small">Not verified</span>
                        </div>
                        <div class="row-line acct">
                            <span>Discord</span>
                            <span v-if="p.discord?.verified">{{ p.discord.discord_username || 'Linked' }}</span>
                            <span v-else class="muted small">Not linked</span>
                        </div>
                    </section>
                    <section v-if="p.links.length" class="panel">
                        <h2 class="label">Links</h2>
                        <a v-for="l in p.links" :key="l.id" :href="safeUrl(l.url)" class="row-line link" target="_blank" rel="noopener nofollow ugc">
                            <span>{{ l.label || l.platform }}</span><span aria-hidden="true">↗</span>
                        </a>
                    </section>
                    <section v-if="p.badges.length" class="panel">
                        <h2 class="label">Badges</h2>
                        <div class="cluster" style="margin-top: 10px">
                            <span v-for="b in p.badges" :key="b.slug" class="chip" :title="b.description">{{ b.name }}</span>
                        </div>
                    </section>
                </aside>

                <div class="main stack">
                    <section v-if="about" class="panel">
                        <h2>About</h2>
                        <p class="bio">{{ about }}</p>
                        <div v-if="tags.length" class="cluster">
                            <span v-for="t in tags" :key="t" class="chip">{{ t }}</span>
                        </div>
                    </section>
                    <section v-else-if="isMe" class="notice">
                        Your profile is empty. <RouterLink to="/me/edit">Add a bio, picture and links</RouterLink> so people know who you are.
                    </section>

                    <section v-if="p.showcase.length" aria-labelledby="sc-h">
                        <h2 id="sc-h" class="section-h">Showcase</h2>
                        <div class="gallery">
                            <figure v-for="m in p.showcase" :key="m.id">
                                <video v-if="m.media_type === 'video'" :src="m.media_url" controls preload="metadata" playsinline></video>
                                <img v-else :src="m.media_url" :alt="m.title || 'Showcase image'" loading="lazy" />
                                <figcaption v-if="m.title || m.caption">
                                    <strong v-if="m.title">{{ m.title }}</strong>
                                    <span v-if="m.caption" class="muted"> {{ m.caption }}</span>
                                </figcaption>
                            </figure>
                        </div>
                    </section>

                    <section v-if="p.milestones.length" class="panel">
                        <h2>Milestones</h2>
                        <div v-for="m in p.milestones" :key="m.slug" class="row-line">
                            <strong>{{ m.name }}</strong>
                            <span class="muted small"> · {{ formatDate(m.awarded_at) }}</span>
                        </div>
                    </section>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import Avatar from '../components/Avatar.vue';
    import RoleChip from '../components/RoleChip.vue';
    import { account } from '../lib/account';
    import { loadPublicProfile, resolveUsername } from '../lib/profiles';
    import { formatDate } from '../lib/format';

    const route = useRoute();
    const state = ref('loading');
    const error = ref('');
    const p = ref(null);
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const isMe = computed(() => p.value?.userId === account.userId.value);
    const about = computed(() => p.value?.creator?.bio || (isMe.value ? account.state.profile?.bio : '') || '');
    const tags = computed(() => {
        const c = p.value?.creator;
        if (!c) return [];
        return [c.primary_specialty, ...(c.specialties || []), ...(c.skills || [])].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).slice(0, 12);
    });

    function safeUrl(url) {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
        } catch {
            return '#';
        }
    }

    async function load() {
        const param = String(route.params.username || '');
        state.value = 'loading';
        error.value = '';
        try {
            const me = account.state.profile;
            let userId = '';
            if (param === me?.username || param === account.userId.value) userId = account.userId.value;
            else if (!account.hasAccess.value) {
                state.value = 'locked';
                return;
            } else if (UUID.test(param)) userId = param;
            else userId = (await resolveUsername(param))?.user_id || '';
            if (!userId) {
                state.value = 'missing';
                return;
            }
            const data = await loadPublicProfile(userId);
            if (!data.found && userId !== account.userId.value) {
                state.value = 'missing';
                return;
            }
            if (userId === account.userId.value) {
                // Your own page: fall back to your account details if you have no public identity row yet.
                data.displayName = data.creator?.display_name || me?.display_name || data.displayName;
                data.username = data.username || me?.username || '';
                data.avatarUrl = data.avatarUrl || me?.avatar_url || '';
                data.roles = data.roles.length ? data.roles : account.state.roles.map((r) => ({ ...r, authority_rank: r.rank }));
            }
            p.value = data;
            document.title = `${data.displayName} · UnderWeb`;
            state.value = 'ready';
        } catch (e) {
            error.value = e?.message || 'Could not load this profile.';
            state.value = 'error';
        }
    }

    watch(() => route.params.username, load, { immediate: true });
</script>

<style scoped>
    .banner {
        height: clamp(120px, 24vw, 240px);
        border-radius: var(--radius);
        border: 1px solid var(--line);
        overflow: hidden;
        background:
            radial-gradient(circle at 20% 130%, rgba(61, 245, 20, 0.22), transparent 55%),
            url('/media/network-banner.webp') center / cover no-repeat,
            var(--panel-2);
    }
    .banner img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 16px 20px;
        margin-top: -48px;
        padding: 0 8px;
    }
    .head-av {
        border: 3px solid var(--void);
        width: clamp(88px, 18vw, 120px) !important;
        height: clamp(88px, 18vw, 120px) !important;
    }
    .head-text {
        flex: 1 1 300px;
        min-width: 0;
        padding-bottom: 4px;
    }
    .head-text h1 {
        font-size: clamp(28px, 5vw, 40px);
    }
    .headline {
        margin: 6px 0 0;
        color: var(--text-2);
    }
    .head-actions {
        padding-bottom: 6px;
    }
    .layout {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        margin-top: 24px;
        align-items: flex-start;
    }
    .side {
        flex: 1 1 280px;
        max-width: 100%;
    }
    @media (min-width: 900px) {
        .side {
            max-width: 340px;
        }
    }
    .main {
        flex: 999 1 480px;
        min-width: 0;
    }
    .main h2,
    .section-h {
        font-size: 20px;
        margin-bottom: 10px;
    }
    .bio {
        white-space: pre-line;
        color: var(--text-2);
        margin: 0 0 12px;
    }
    .acct,
    .link {
        display: flex;
        justify-content: space-between;
        gap: 10px;
    }
    .link {
        color: var(--text);
    }
    .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
        gap: 12px;
    }
    .gallery figure {
        margin: 0;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--panel);
    }
    .gallery img,
    .gallery video {
        width: 100%;
        aspect-ratio: 4 / 5;
        object-fit: cover;
        display: block;
        background: #000;
    }
    figcaption {
        padding: 8px 10px;
        font-size: 13px;
    }
</style>
