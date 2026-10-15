<template>
    <section class="wrap page">
        <div class="eyebrow">404</div>
        <h1 class="page-title">Nothing here</h1>
        <p class="muted">That page doesn't exist on the new site. It may still be on the current one.</p>
        <div class="cluster">
            <RouterLink to="/" class="btn btn-primary">Home</RouterLink>
            <a :href="LEGACY_SITE" class="btn" rel="noopener">Current site ↗</a>
        </div>
    </section>
</template>

<script setup>
    import { LEGACY_SITE } from '../lib/config';
</script>
