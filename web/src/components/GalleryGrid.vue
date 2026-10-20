<template>
    <div v-if="loading" class="grid">
        <div v-for="i in placeholders" :key="i" class="skeleton ph"></div>
    </div>
    <div v-else-if="items.length" class="grid">
        <figure v-for="p in items" :key="p.id" class="shot">
            <a :href="p.image_url" target="_blank" rel="noopener" class="img"><img :src="p.image_url" :alt="p.title" loading="lazy" /></a>
            <figcaption>
                <strong>{{ p.title }}</strong> · by
                <RouterLink v-if="p.byId && account.signedIn.value" :to="`/u/${p.byId}`">{{ p.by }}</RouterLink>
                <span v-else>{{ p.by }}</span>
            </figcaption>
        </figure>
    </div>
    <div v-else class="empty">
        <slot name="empty">No photos yet — be the first. Post from your profile, or straight from VRChat with UWX.</slot>
    </div>
</template>

<script setup>
    import { account } from '../lib/account';
    defineProps({ items: { type: Array, default: () => [] }, loading: Boolean, placeholders: { type: Number, default: 3 } });
</script>

<style scoped>
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
        gap: 12px;
    }
    .ph {
        aspect-ratio: 16 / 10;
        border-radius: 14px;
    }
    .shot {
        margin: 0;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid var(--line);
        background: var(--panel-2);
    }
    .img {
        display: block;
        aspect-ratio: 16 / 10;
        background: #0b1a10;
    }
    .img img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    figcaption {
        padding: 10px 14px;
        font-size: 14px;
        color: var(--text-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    figcaption strong {
        color: var(--text);
    }
    .empty {
        padding: 28px;
        border: 1px dashed var(--line-strong);
        border-radius: 14px;
        color: var(--muted);
        text-align: center;
    }
</style>
