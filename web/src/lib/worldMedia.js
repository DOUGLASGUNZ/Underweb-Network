import { supabase, friendlyError } from './supabase';

export const CATEGORIES = [
    ['group', 'Group photos'],
    ['avatar', 'Avatar showcase'],
    ['shader', 'Shader showcase'],
    ['event', 'Event posters'],
    ['creator', 'Creator ads'],
    ['announcement', 'Announcements'],
    ['artwork', 'Artwork'],
    ['other', 'Other']
];

export const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_BASE_URL || '';

/** The fixed address a world uses for one slot position. */
export function slotImageUrl(worldSlug, slotKey, position = 1) {
    return MEDIA_BASE_URL ? `${MEDIA_BASE_URL.replace(/\/$/, '')}/w/${worldSlug}/${slotKey}/${position}.jpg` : '';
}
export function manifestUrl(worldSlug) {
    return MEDIA_BASE_URL ? `${MEDIA_BASE_URL.replace(/\/$/, '')}/w/${worldSlug}/manifest.json` : '';
}

async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function toJpeg(canvas, quality = 0.88) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), 'image/jpeg', quality));
}

/**
 * Render an image into a slot's shape for VRChat: exact aspect, longest side ≤ maxPx
 * (VRChat rejects anything over 2048), JPEG (posters don't need transparency; JPEG
 * keeps downloads small, and VRChat downloads one image every 5 seconds per world).
 * mode 'fill' crops to fill; 'fit' letterboxes on black. offsetX/offsetY (-1…1) pan the crop.
 */
export async function renderForSlot(file, { aspectW, aspectH, maxPx = 2048, mode = 'fill', offsetX = 0, offsetY = 0 }) {
    const img = await loadImage(file);
    const ratio = aspectW / aspectH;
    let outW = maxPx;
    let outH = Math.round(maxPx / ratio);
    if (outH > maxPx) {
        outH = maxPx;
        outW = Math.round(maxPx * ratio);
    }
    // Don't upscale tiny images more than needed.
    const srcRatio = img.naturalWidth / img.naturalHeight;
    const natural = mode === 'fill' ? (srcRatio > ratio ? img.naturalHeight * ratio : img.naturalWidth) : Math.max(img.naturalWidth, img.naturalHeight * ratio);
    if (natural < outW) {
        const scale = Math.max(natural, 256) / outW;
        outW = Math.round(outW * scale);
        outH = Math.round(outH * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingQuality = 'high';
    if (mode === 'fill') {
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (srcRatio > ratio) sw = sh * ratio;
        else sh = sw / ratio;
        const sx = ((img.naturalWidth - sw) / 2) * (1 + Math.max(-1, Math.min(1, offsetX)));
        const sy = ((img.naturalHeight - sh) / 2) * (1 + Math.max(-1, Math.min(1, offsetY)));
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    } else {
        const scale = Math.min(outW / img.naturalWidth, outH / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    }
    let blob = await toJpeg(canvas, 0.88);
    if (blob.size > 3 * 1024 * 1024) blob = await toJpeg(canvas, 0.75);
    return { blob, width: outW, height: outH };
}

/** Normalise any upload into a library original: JPEG, longest side ≤ 2048. */
export async function normaliseUpload(file) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPG, WebP or GIF image.');
    if (file.size > 25 * 1024 * 1024) throw new Error('That image is over 25 MB.');
    const img = await loadImage(file);
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { blob: await toJpeg(canvas, 0.9), width: w, height: h };
}

export async function uploadAsset(blob, { title, category, width, height }) {
    const { data: u } = await supabase.auth.getUser();
    const path = `${u.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await supabase.storage.from('world-media').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw new Error(friendlyError(up.error));
    const { data, error } = await supabase
        .from('world_media_assets')
        .insert({ storage_path: path, title: title || '', category: category || 'other', width, height, bytes: blob.size })
        .select('*')
        .single();
    if (error) {
        await supabase.storage.from('world-media').remove([path]);
        throw new Error(friendlyError(error));
    }
    return data;
}

/** Short-lived links to private originals for thumbnails. */
export async function signedUrls(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return {};
    const { data } = await supabase.storage.from('world-media').createSignedUrls(unique, 3600);
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

export async function publishWorld(worldId) {
    const { data, error } = await supabase.functions.invoke('world-media-publish', { body: { world_id: worldId } });
    if (error) {
        let detail = '';
        try {
            detail = (await error.context?.json?.())?.error || '';
        } catch {
            /* ignore */
        }
        if (detail === 'publisher_not_configured') throw new Error('Publishing isn’t set up yet: the GitHub token and media repo secrets are missing.');
        if (detail === 'not_allowed') throw new Error('Your role can’t publish world media.');
        throw new Error(detail ? `Publish failed (${detail}).` : friendlyError(error, 'Publish failed.'));
    }
    return data;
}
