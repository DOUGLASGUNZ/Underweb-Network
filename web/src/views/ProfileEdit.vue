<template>
    <section class="wrap page">
        <div class="eyebrow">Your profile</div>
        <h1 class="page-title">Edit profile</h1>

        <div v-if="loading" class="skeleton" style="height: 320px"></div>
        <form v-else class="layout" @submit.prevent="save">
            <div class="stack main">
                <section class="panel stack">
                    <h2 class="label">Basics</h2>
                    <div class="pics">
                        <div class="pic">
                            <Avatar :src="avatarPreview" :name="form.display_name" :size="96" />
                            <label class="btn btn-sm">
                                Change picture
                                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only" @change="pick($event, 'avatar')" />
                            </label>
                        </div>
                        <div v-if="isCreator" class="pic banner-pic">
                            <div class="banner-prev" :style="bannerPreview ? { backgroundImage: `url('${bannerPreview}')` } : {}"></div>
                            <label class="btn btn-sm">
                                Change banner
                                <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="pick($event, 'banner')" />
                            </label>
                        </div>
                    </div>
                    <p class="hint">PNG, JPG, WebP or GIF, up to 5 MB.</p>
                    <label class="field">
                        <span>Display name</span>
                        <input v-model.trim="form.display_name" class="input" maxlength="40" required />
                    </label>
                    <label class="field">
                        <span>Bio</span>
                        <textarea v-model="form.bio" class="textarea" maxlength="1200" placeholder="Who you are, what you make, where to find you in VRChat."></textarea>
                        <span class="hint">{{ form.bio.length }}/1200</span>
                    </label>
                    <label class="field">
                        <span>Time zone</span>
                        <select v-model="form.timezone" class="select">
                            <option v-for="z in zones" :key="z" :value="z">{{ z.replace(/_/g, ' ') }}</option>
                        </select>
                    </label>
                </section>

                <section v-if="isCreator" class="panel stack">
                    <h2 class="label">Creator profile</h2>
                    <label class="field">
                        <span>Headline</span>
                        <input v-model.trim="form.headline" class="input" maxlength="120" placeholder="e.g. Techno DJ · avatar commissions open" />
                    </label>
                    <label class="field">
                        <span>Specialties</span>
                        <input v-model="form.specialties" class="input" placeholder="Comma separated: DJ, Techno, Avatar editing" />
                        <span class="hint">Up to 20. These power Discover search and filters.</span>
                    </label>
                    <label class="field">
                        <span>Availability</span>
                        <select v-model="form.availability" class="select">
                            <option v-for="a in availabilityOptions" :key="a.v" :value="a.v">{{ a.l }}</option>
                        </select>
                    </label>
                    <label class="check">
                        <input v-model="form.collaboration_friendly" type="checkbox" />
                        Open to collaborations
                    </label>
                    <label class="check">
                        <input v-model="form.public_visible" type="checkbox" />
                        Show me in Discover
                    </label>
                    <div class="grid2">
                        <label class="field">
                            <span>Shop / commissions link</span>
                            <input v-model.trim="form.shop_url" class="input" inputmode="url" placeholder="https://…" />
                        </label>
                        <label class="field">
                            <span>Button label</span>
                            <input v-model.trim="form.shop_label" class="input" maxlength="40" placeholder="Commissions" />
                        </label>
                    </div>
                </section>
                <section v-else class="notice small">
                    Creator fields (headline, specialties, banner, Discover listing) unlock when you hold a creator role. Apply for one on the
                    <a :href="LEGACY_SITE" rel="noopener">current site ↗</a>.
                </section>
            </div>

            <aside class="stack side">
                <section class="panel stack">
                    <h2 class="label">Links</h2>
                    <div v-for="(l, i) in links" :key="l.key" class="link-row">
                        <input v-model.trim="l.label" class="input" placeholder="Label" aria-label="Link label" maxlength="40" />
                        <input v-model.trim="l.url" class="input" placeholder="https://…" aria-label="Link URL" inputmode="url" />
                        <button type="button" class="btn btn-ghost btn-sm" :aria-label="'Remove link ' + (l.label || i + 1)" @click="links.splice(i, 1)">✕</button>
                    </div>
                    <button v-if="links.length < 8" type="button" class="btn btn-sm" @click="addLink">Add link</button>
                </section>
                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <div class="cluster">
                    <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? status || 'Saving…' : 'Save profile' }}</button>
                    <RouterLink to="/me" class="btn btn-ghost">Cancel</RouterLink>
                </div>
            </aside>
        </form>
    </section>
</template>

<script setup>
    import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
    import { useRouter } from 'vue-router';
    import Avatar from '../components/Avatar.vue';
    import { supabase, friendlyError } from '../lib/supabase';
    import { account, refreshAccount } from '../lib/account';
    import { isConfirmedCreator, uploadProfileImage } from '../lib/profiles';
    import { LEGACY_SITE } from '../lib/config';
    import { toast } from '../lib/toast';

    const router = useRouter();
    const loading = ref(true);
    const saving = ref(false);
    const status = ref('');
    const error = ref('');
    const isCreator = ref(false);
    const creatorRowId = ref('');
    const files = reactive({ avatar: null, banner: null });
    const objectUrls = [];

    const form = reactive({
        display_name: '',
        bio: '',
        timezone: '',
        avatar_url: '',
        banner_url: '',
        headline: '',
        specialties: '',
        availability: 'by_request',
        collaboration_friendly: false,
        public_visible: true,
        shop_url: '',
        shop_label: ''
    });
    const links = ref([]);
    let originalLinkIds = [];

    const zones = (() => {
        try {
            return Intl.supportedValuesOf('timeZone');
        } catch {
            return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney'];
        }
    })();
    const availabilityOptions = [
        { v: 'available', l: 'Available' },
        { v: 'limited', l: 'Limited' },
        { v: 'by_request', l: 'By request' },
        { v: 'booked', l: 'Booked up' },
        { v: 'unavailable', l: 'Not taking work' }
    ];

    const avatarPreview = computed(() => (files.avatar ? files.avatar.preview : form.avatar_url));
    const bannerPreview = computed(() => (files.banner ? files.banner.preview : form.banner_url));

    function pick(event, kind) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast('That image is over 5 MB.', 'error');
            return;
        }
        const preview = URL.createObjectURL(file);
        objectUrls.push(preview);
        files[kind] = { file, preview };
    }
    onBeforeUnmount(() => objectUrls.forEach((u) => URL.revokeObjectURL(u)));

    let linkKey = 0;
    function addLink() {
        links.value.push({ key: `n${linkKey++}`, id: null, label: '', url: '' });
    }

    onMounted(async () => {
        const uid = account.userId.value;
        const [prof, creator, linkRows, creatorRole] = await Promise.all([
            supabase.from('profiles').select('display_name,bio,timezone,avatar_url').eq('id', uid).maybeSingle(),
            supabase
                .from('creator_profiles')
                .select('id,headline,bio,specialties,availability,collaboration_friendly,public_visible,avatar_url,banner_url,shop_url,shop_label')
                .eq('user_id', uid)
                .maybeSingle(),
            supabase.from('profile_external_links').select('id,platform,label,url,sort_order').eq('user_id', uid).order('sort_order'),
            isConfirmedCreator(uid)
        ]);
        const meta = (await supabase.auth.getUser()).data.user?.user_metadata || {};
        const p = prof.data || {};
        const c = creator.data || null;
        isCreator.value = Boolean(creatorRole && c);
        creatorRowId.value = c?.id || '';
        Object.assign(form, {
            display_name: p.display_name || '',
            // Older versions of the site kept member bios/avatars in account metadata; carry them over.
            bio: c?.bio || p.bio || meta.uw_bio || '',
            timezone: p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            avatar_url: c?.avatar_url || p.avatar_url || meta.uw_avatar_url || '',
            banner_url: c?.banner_url || meta.uw_banner_url || '',
            headline: c?.headline || meta.uw_headline || '',
            specialties: (c?.specialties || []).join(', '),
            availability: c?.availability || meta.uw_availability || 'by_request',
            collaboration_friendly: Boolean(c?.collaboration_friendly),
            public_visible: c ? c.public_visible !== false : true,
            shop_url: c?.shop_url || '',
            shop_label: c?.shop_label || ''
        });
        links.value = (linkRows.data || []).map((l) => ({ key: l.id, id: l.id, label: l.label || l.platform || '', url: l.url }));
        originalLinkIds = links.value.map((l) => l.id);
        loading.value = false;
    });

    function validUrl(url) {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' || u.protocol === 'http:';
        } catch {
            return false;
        }
    }

    async function save() {
        error.value = '';
        if (!form.display_name) {
            error.value = 'Display name is required.';
            return;
        }
        const cleanLinks = links.value.filter((l) => l.url || l.label);
        const bad = cleanLinks.find((l) => !validUrl(l.url));
        if (bad) {
            error.value = `"${bad.label || bad.url}" isn't a valid web link (it must start with https://).`;
            return;
        }
        if (isCreator.value && form.shop_url && !validUrl(form.shop_url)) {
            error.value = 'The shop link must be a full web address starting with https://.';
            return;
        }
        saving.value = true;
        const uid = account.userId.value;
        try {
            if (files.avatar) {
                status.value = 'Uploading picture…';
                form.avatar_url = await uploadProfileImage(uid, files.avatar.file, 'avatar');
            }
            if (files.banner && isCreator.value) {
                status.value = 'Uploading banner…';
                form.banner_url = await uploadProfileImage(uid, files.banner.file, 'banner');
            }
            status.value = 'Saving…';
            const prof = await supabase
                .from('profiles')
                .update({ display_name: form.display_name, bio: form.bio.trim(), timezone: form.timezone, avatar_url: form.avatar_url || null })
                .eq('id', uid);
            if (prof.error) throw prof.error;

            // Keep the old site in sync while both are live.
            await supabase.auth.updateUser({
                data: { display_name: form.display_name, uw_bio: form.bio.trim(), uw_avatar_url: form.avatar_url || null, uw_banner_url: form.banner_url || null }
            });

            if (isCreator.value && creatorRowId.value) {
                const specialties = form.specialties
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 20);
                const c = await supabase
                    .from('creator_profiles')
                    .update({
                        display_name: form.display_name,
                        headline: form.headline,
                        bio: form.bio.trim(),
                        specialties,
                        availability: form.availability,
                        collaboration_friendly: form.collaboration_friendly,
                        public_visible: form.public_visible,
                        avatar_url: form.avatar_url || null,
                        banner_url: form.banner_url || null,
                        shop_url: form.shop_url || null,
                        shop_label: form.shop_url ? form.shop_label || 'Commissions' : null
                    })
                    .eq('id', creatorRowId.value);
                if (c.error) throw c.error;
            }

            // Links: update/insert what's there, delete what was removed.
            const keepIds = new Set(cleanLinks.filter((l) => l.id).map((l) => l.id));
            const removed = originalLinkIds.filter((id) => !keepIds.has(id));
            if (removed.length) {
                const d = await supabase.from('profile_external_links').delete().in('id', removed).eq('user_id', uid);
                if (d.error) throw d.error;
            }
            for (const [i, l] of cleanLinks.entries()) {
                const row = { user_id: uid, label: l.label || new URL(l.url).hostname, platform: new URL(l.url).hostname.replace(/^www\./, ''), url: l.url, sort_order: i };
                const r = l.id ? await supabase.from('profile_external_links').update(row).eq('id', l.id) : await supabase.from('profile_external_links').insert(row);
                if (r.error) throw r.error;
            }

            await refreshAccount();
            toast('Profile saved.', 'ok');
            router.push('/me');
        } catch (e) {
            error.value = friendlyError(e, 'Your profile could not be saved.');
        } finally {
            saving.value = false;
            status.value = '';
        }
    }
</script>

<style scoped>
    .layout {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: flex-start;
        margin-top: 16px;
    }
    .main {
        flex: 999 1 480px;
        min-width: 0;
    }
    .side {
        flex: 1 1 300px;
    }
    .pics {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: flex-end;
    }
    .pic {
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: flex-start;
    }
    .banner-pic {
        flex: 1 1 240px;
    }
    .banner-prev {
        width: 100%;
        height: 96px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--line-strong);
        background: var(--panel-2) center / cover no-repeat;
    }
    .check {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        cursor: pointer;
    }
    .check input {
        width: 18px;
        height: 18px;
        accent-color: var(--acid);
    }
    .grid2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
        gap: 12px;
    }
    .link-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) auto;
        gap: 6px;
    }
    @media (max-width: 420px) {
        .link-row {
            grid-template-columns: 1fr auto;
        }
        .link-row input:first-child {
            grid-column: 1 / -1;
        }
    }
</style>
