<template>
    <span class="av" :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' }">
        <img v-if="src && !failed" :src="src" alt="" loading="lazy" @error="failed = true" />
        <span v-else aria-hidden="true">{{ initials(name) }}</span>
    </span>
</template>

<script setup>
    import { ref, watch } from 'vue';
    import { initials } from '../lib/format';

    const props = defineProps({ src: { type: String, default: '' }, name: { type: String, default: '' }, size: { type: Number, default: 40 } });
    const failed = ref(false);
    watch(() => props.src, () => (failed.value = false));
</script>

<style scoped>
    .av {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        border-radius: var(--radius-sm);
        background: var(--panel-2);
        border: 1px solid var(--line-strong);
        overflow: hidden;
        font-family: var(--font-ui);
        font-weight: 800;
        color: var(--acid);
    }
    .av img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
</style>
