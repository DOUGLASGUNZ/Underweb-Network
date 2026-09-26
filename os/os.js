(() => {
  'use strict';

  const state = { client: null, configured: false };

  function setText(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  }

  function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderActivity(rows) {
    const host = document.querySelector('[data-os-activity]');
    if (!host) return;
    if (!rows?.length) {
      host.innerHTML = '<div class="empty"><b>NO PUBLIC ACTIVITY YET</b><span>The feed is connected, but there are no visible Network events to show.</span></div>';
      return;
    }
    host.innerHTML = '<div class="feed">' + rows.map(row => {
      const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
      return '<article class="feed-item"><div><b>' + escapeText(row.title) + '</b>' +
        (row.body ? '<p>' + escapeText(row.body) + '</p>' : '') +
        '</div><time>' + escapeText(when) + '</time></article>';
    }).join('') + '</div>';
  }

  function renderUnavailable(message) {
    const host = document.querySelector('[data-os-activity]');
    if (host) host.innerHTML = '<div class="empty"><b>ACTIVITY UNAVAILABLE</b><span>' + escapeText(message) + '</span></div>';
  }

  async function boot() {
    const cfg = window.UNDERWEB_OS_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase?.createClient) {
      renderUnavailable('Supabase configuration has not been attached to the OS beta yet.');
      return;
    }
    try {
      state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      state.configured = true;
      const { data, error } = await state.client
        .from('network_activity')
        .select('id,kind,title,body,object_type,object_id,created_at')
        .eq('public', true)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      renderActivity(data);
      setText('[data-os-feed-state]', 'LIVE DATA');
    } catch (err) {
      console.error('[UnderWeb OS] activity load failed', err);
      renderUnavailable('The Network feed could not be loaded.');
    }
  }

  window.UnderWebOS = { boot };
  boot();
})();