<template>
    <span class="chip role" :class="{ 'chip-acid': role.rank >= 80 || role.authority_rank >= 80 }" :title="role.name">
        <img v-if="sigil" :src="sigil" alt="" width="14" height="14" />
        {{ role.name }}
    </span>
</template>

<script setup>
    import { computed } from 'vue';
    import { ROLE_SIGILS } from '../lib/config';

    const props = defineProps({ role: { type: Object, required: true } });
    const sigil = computed(() => ROLE_SIGILS[props.role.slug] || '');
</script>

<style scoped>
    .role img {
        border-radius: 2px;
        background: #000;
    }
</style>
