const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function formatDateTime(value, opts = {}) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts });
}

export function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "in 2 days", "3h ago" */
export function relativeTime(value) {
    if (!value) return '';
    const diff = new Date(value).getTime() - Date.now();
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const units = [
        ['day', 86400000],
        ['hour', 3600000],
        ['minute', 60000]
    ];
    for (const [unit, ms] of units) {
        if (abs >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit);
    }
    return '';
}

export function localTimeZone() {
    return tz();
}

/** Show an event time in the viewer's zone, plus Eastern for staff coordination. */
export function eventTimes(value) {
    if (!value) return { local: '', eastern: '' };
    const d = new Date(value);
    return {
        local: d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
        eastern: d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    };
}

export function initials(name) {
    return String(name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => Array.from(p)[0] || '')
        .join('')
        .toUpperCase();
}
