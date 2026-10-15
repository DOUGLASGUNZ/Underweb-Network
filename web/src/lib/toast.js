import { reactive } from 'vue';

export const toasts = reactive([]);
let nextId = 1;

/** Show a short message. kind: 'ok' | 'error' | 'info' */
export function toast(message, kind = 'info', ms = 4000) {
    const id = nextId++;
    toasts.push({ id, message, kind });
    setTimeout(() => {
        const i = toasts.findIndex((t) => t.id === id);
        if (i >= 0) toasts.splice(i, 1);
    }, ms);
}
