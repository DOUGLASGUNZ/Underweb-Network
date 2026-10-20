<template>
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <template v-if="name === 'silk'"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></template>
        <template v-else-if="name === 'lock'"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></template>
        <template v-else-if="name === 'gift'"><path d="M20 12v9H4v-9" /><rect x="2" y="7" width="20" height="5" /><path d="M12 21V7" /><path d="M12 7H8a2.5 2.5 0 0 1 0-5c3 0 4 5 4 5z" /><path d="M12 7h4a2.5 2.5 0 0 0 0-5c-3 0-4 5-4 5z" /></template>
        <template v-else-if="name === 'friend'"><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M19 8v6M16 11h6" /></template>
        <template v-else-if="name === 'stage'"><circle cx="6" cy="12" r="3" /><circle cx="18" cy="12" r="3" /><path d="M9 12h6" /><path d="M6 9V4M18 9V4" /></template>
        <template v-else-if="name === 'screen'"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></template>
        <template v-else-if="name === 'badge'"><circle cx="12" cy="9" r="6" /><path d="M8.5 14 7 22l5-3 5 3-1.5-8" /></template>
        <template v-else-if="name === 'check'"><path d="M5 12.5l4.5 4.5L19 7.5" /></template>
        <template v-else><circle cx="12" cy="12" r="9" /></template>
    </svg>
</template>

<script setup>
    defineProps({ name: { type: String, required: true }, size: { type: Number, default: 28 } });
</script>
