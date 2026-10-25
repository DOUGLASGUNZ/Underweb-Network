/* UnderWeb hub creator cards.
 * - Profile page: "Your hub card" (Creator Market or Resident DJ), pick the image, headline and link;
 *   tick which approved photos go on the hub's art wall.
 * - Staff (media reviewers): approve / reject cards waiting for review.
 * - Links like https://underweb.cloud/#profile=<id> (QR codes in the hub, Discord posts) open that creator.
 * Approved cards are drawn and published to the hub world by the "Hub feeds" GitHub Pages job.
 */
(() => {
  const STORAGE = 'https://pxipclkptxpqukefwexh.supabase.co/storage/v1/object/public/';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => (typeof uwSupabase === 'undefined' ? null : uwSupabase);
  const say = (msg) => (typeof window.toast === 'function' ? window.toast(msg) : console.log(msg));
  const ownImage = (url, uid) =>
    typeof url === 'string' && (url.startsWith(`${STORAGE}creator-showcase/${uid}/`) || url.startsWith(`${STORAGE}profile-media/${uid}/`));
  const httpsUrl = (raw) => {
    const v = String(raw || '').trim();
    if (!v) return '';
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
    } catch {
      return null;
    }
  };

  // ---------- #profile=<id> deep links ----------
  function openProfileFromHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const id = params.get('profile');
    if (!id || !UUID.test(id)) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (typeof uw758Open === 'function') {
        clearInterval(timer);
        history.replaceState({}, document.title, location.pathname + location.search);
        uw758Open(id);
      } else if (++tries > 40) clearInterval(timer);
    }, 250);
  }

  // ---------- profile panel ----------
  let mounted = false;
  let busy = false;
  const state = { uid: '', card: null, images: [], photos: [], reviewer: false, queue: [] };

  async function load() {
    const client = sb();
    if (!client) return false;
    const { data } = await client.auth.getSession();
    const uid = data?.session?.user?.id;
    if (!uid) return false;
    state.uid = uid;
    state.notReady = false;
    const [cardR, profR, showR, revR, likeR] = await Promise.all([
      client.from('hub_creator_cards').select('*').eq('user_id', uid).maybeSingle(),
      client.from('creator_profiles').select('avatar_url,banner_url,display_name,shop_url,shop_label').eq('user_id', uid).maybeSingle(),
      client.from('creator_showcase').select('id,title,media_url,media_type,moderation_status,show_in_hub').eq('user_id', uid).eq('moderation_status', 'approved').order('created_at', { ascending: false }),
      client.rpc('uw_can_review_media'),
      client.rpc('hub_my_likes')
    ]);
    if (cardR.error && /hub_creator_cards/.test(cardR.error.message || '')) {
      state.notReady = true;
      return true;
    }
    state.card = cardR.data || null;
    state.profile = profR.data || {};
    const photos = (showR.data || []).filter((x) => x.media_type === 'image' && ownImage(x.media_url, uid));
    state.photos = photos;
    state.images = [
      ...(ownImage(state.profile.banner_url, uid) ? [{ url: state.profile.banner_url, label: 'Profile banner' }] : []),
      ...(ownImage(state.profile.avatar_url, uid) ? [{ url: state.profile.avatar_url, label: 'Profile picture' }] : []),
      ...photos.map((p) => ({ url: p.media_url, label: p.title || 'Showcase' }))
    ];
    state.reviewer = revR.data === true;
    const lk = Array.isArray(likeR?.data) ? likeR.data[0] : likeR?.data;
    state.likes = lk && !likeR.error ? { total: Number(lk.total) || 0, week: Number(lk.this_week) || 0 } : null;
    if (state.reviewer) await loadQueue();
    return true;
  }

  async function loadQueue() {
    const client = sb();
    const { data } = await client.from('hub_creator_cards').select('*').eq('status', 'pending').order('updated_at', { ascending: true });
    const rows = data || [];
    const ids = rows.map((r) => r.user_id);
    let names = {};
    if (ids.length) {
      const { data: cp } = await client.from('creator_profiles').select('user_id,display_name').in('user_id', ids);
      names = Object.fromEntries((cp || []).map((c) => [c.user_id, c.display_name]));
    }
    state.queue = rows.map((r) => ({ ...r, name: names[r.user_id] || 'Member' }));
  }

  const statusLine = (card) => {
    if (!card) return '<p class="uwhc-note">You don\'t have a hub card yet.</p>';
    const s = card.status;
    const text =
      s === 'approved'
        ? card.enabled
          ? 'Approved — it\'s in the hub\'s Creator Room (new changes show up a few minutes after staff approve them).'
          : 'Approved, but switched off — turn it on to show it in the hub.'
        : s === 'rejected'
          ? `Not approved${card.review_note ? `: ${esc(card.review_note)}` : '.'} Change it and save to send it again.`
          : 'Waiting for staff to approve it.';
    return `<p class="uwhc-status ${esc(s)}"><b>${esc(s.toUpperCase())}</b> ${text}</p>`;
  };

  function render() {
    const host = $('#uwHubCardPanel');
    if (!host) return;
    if (state.notReady) {
      host.innerHTML = '<div class="uwhc-card"><h2>YOUR HUB CARD</h2><p class="uwhc-note">Coming soon — hub cards are being switched on.</p></div>';
      return;
    }
    const c = state.card || {};
    const kind = c.kind || 'market';
    const chosen = c.image_url || state.images[0]?.url || '';
    host.innerHTML = `
      <div class="uwhc-card">
        <div class="uwhc-head">
          <div>
            <span class="uwhc-kicker">THE HUB</span>
            <h2>YOUR HUB CARD</h2>
            <p class="uwhc-note">Get your work into the hub's Creator Room. Staff approve every card first; any change sends it back for review.</p>
          </div>
          ${state.card ? `<label class="uwhc-switch"><input type="checkbox" id="uwhcEnabled" ${c.enabled !== false ? 'checked' : ''}> Show in the hub</label>` : ''}
        </div>
        ${statusLine(state.card)}
        ${
          state.likes && (state.likes.total > 0 || state.card?.status === 'approved')
            ? `<p class="uwhc-note"><b style="color:#38ff72">♥ ${state.likes.total}</b> ${state.likes.total === 1 ? 'like' : 'likes'} in the hub${state.likes.week ? ` · ${state.likes.week} this week` : ''} <small>(people tapping ♥ under your card and your art-wall pieces in the Creator Room)</small></p>`
            : ''
        }
        <form id="uwhcForm" class="uwhc-form">
          <fieldset class="uwhc-kinds"><legend>What kind of card?</legend>
            <label><input type="radio" name="kind" value="market" ${kind === 'market' ? 'checked' : ''}> <b>Creator Market</b><small>Avatars, assets, art — shown with a QR code to your shop</small></label>
            <label><input type="radio" name="kind" value="dj" ${kind === 'dj' ? 'checked' : ''}> <b>Resident DJ</b><small>On the Stage screen with a QR code to your music</small></label>
          </fieldset>
          <fieldset><legend>Card image</legend>
            ${
              state.images.length
                ? `<div class="uwhc-images">${state.images
                    .map(
                      (im, i) => `<label class="uwhc-img"><input type="radio" name="image" value="${esc(im.url)}" ${im.url === chosen ? 'checked' : ''}><img src="${esc(im.url)}" alt="" loading="lazy"><span>${esc(im.label)}</span></label>`
                    )
                    .join('')}</div><p class="uwhc-note">DJs: a logo with a transparent background looks best.</p>`
                : '<p class="uwhc-note">Add a profile picture, banner or an approved showcase piece first.</p>'
            }
          </fieldset>
          <label class="uwhc-field"><span>Headline <small>(max 60)</small></span><input name="headline" maxlength="60" value="${esc(c.headline || '')}" placeholder="${kind === 'dj' ? 'DJ · Rapper · Producer' : 'Digital art · Avatars · Commissions'}"></label>
          <label class="uwhc-field"><span>Main link <small>(shop, SoundCloud, Twitch… must start with https://)</small></span><input name="link_url" maxlength="200" value="${esc(c.link_url || state.profile.shop_url || '')}" placeholder="https://"></label>
          <label class="uwhc-field"><span>Button label <small>(market cards)</small></span><input name="link_label" maxlength="40" value="${esc(c.link_label || state.profile.shop_label || 'SHOP')}"></label>
          <label class="uwhc-field"><span>Second link <small>(optional, shown on DJ cards)</small></span><input name="extra_link_url" maxlength="200" value="${esc(c.extra_link_url || '')}" placeholder="https://"></label>
          <div class="uwhc-actions">
            <button class="btn hot" type="submit" ${state.images.length ? '' : 'disabled'}>${state.card ? 'SAVE & SEND FOR REVIEW' : 'CREATE MY HUB CARD'}</button>
            ${state.card ? '<button class="btn" type="button" id="uwhcDelete">REMOVE CARD</button>' : ''}
          </div>
        </form>
        ${
          state.photos.length
            ? `<div class="uwhc-wall"><h3>On the hub's art wall</h3><p class="uwhc-note">Tick approved photos or art to show on the hub's screens. Anyone visiting the hub can see them.</p>
               <div class="uwhc-images">${state.photos
                 .map(
                   (p) => `<label class="uwhc-img"><input type="checkbox" data-uwhc-wall="${esc(p.id)}" ${p.show_in_hub ? 'checked' : ''}><img src="${esc(p.media_url)}" alt="" loading="lazy"><span>${esc(p.title || 'Untitled')}</span></label>`
                 )
                 .join('')}</div></div>`
            : ''
        }
        ${state.reviewer ? renderQueue() : ''}
      </div>`;
  }

  function renderQueue() {
    const rows = state.queue;
    return `<div class="uwhc-queue"><h3>Hub cards waiting for review <span>${rows.length}</span></h3>
      ${
        rows.length
          ? rows
              .map(
                (r) => `<article class="uwhc-qrow">
            <img src="${ownImage(r.image_url, r.user_id) ? esc(r.image_url) : ''}" alt="">
            <div><b>${esc(r.name)}</b> <span class="uwhc-tag">${r.kind === 'dj' ? 'RESIDENT DJ' : 'CREATOR MARKET'}</span>
              <p>${esc(r.headline || '—')}</p>
              <p class="uwhc-link">${esc(r.link_url || 'no link')}${r.extra_link_url ? ` · ${esc(r.extra_link_url)}` : ''}</p></div>
            <div class="uwhc-qbtns"><button class="btn hot" type="button" data-uwhc-review="${esc(r.user_id)}|1">APPROVE</button>
              <button class="btn danger" type="button" data-uwhc-review="${esc(r.user_id)}|0">REJECT</button></div>
          </article>`
              )
              .join('')
          : '<p class="uwhc-note">Nothing waiting.</p>'
      }</div>`;
  }

  async function save(form) {
    if (busy) return;
    const fd = new FormData(form);
    const link = httpsUrl(fd.get('link_url'));
    const extra = httpsUrl(fd.get('extra_link_url'));
    if (link === null || extra === null) return say('Links must start with https://');
    const image = String(fd.get('image') || '');
    if (!ownImage(image, state.uid)) return say('Pick one of your images for the card.');
    const row = {
      user_id: state.uid,
      kind: fd.get('kind') === 'dj' ? 'dj' : 'market',
      image_url: image,
      headline: String(fd.get('headline') || '').trim().slice(0, 60),
      link_url: link || null,
      link_label: String(fd.get('link_label') || '').trim().slice(0, 40),
      extra_link_url: extra || null
    };
    busy = true;
    try {
      const { error } = await sb().from('hub_creator_cards').upsert(row, { onConflict: 'user_id' });
      if (error) return say(error.message || 'Could not save your hub card.');
      say('Saved — staff will review your hub card.');
      await refresh();
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    await load();
    render();
  }

  document.addEventListener('submit', (e) => {
    if (e.target?.id === 'uwhcForm') {
      e.preventDefault();
      save(e.target);
    }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t?.id === 'uwhcEnabled') {
      const { error } = await sb().from('hub_creator_cards').update({ enabled: t.checked }).eq('user_id', state.uid);
      if (error) say(error.message);
      else say(t.checked ? 'Your card will show in the hub.' : 'Your card is hidden from the hub.');
      await refresh();
    }
    const wallId = t?.dataset?.uwhcWall;
    if (wallId) {
      const { error } = await sb().from('creator_showcase').update({ show_in_hub: t.checked }).eq('id', wallId).eq('user_id', state.uid);
      if (error) say(error.message);
      else say(t.checked ? 'Added to the hub art wall.' : 'Removed from the hub art wall.');
    }
  });
  document.addEventListener('click', async (e) => {
    if (e.target?.id === 'uwhcDelete') {
      if (!confirm('Remove your hub card? It disappears from the hub at the next update.')) return;
      const { error } = await sb().from('hub_creator_cards').delete().eq('user_id', state.uid);
      if (error) say(error.message);
      await refresh();
      return;
    }
    const btn = e.target?.closest?.('[data-uwhc-review]');
    if (btn) {
      const [uid, ok] = btn.dataset.uwhcReview.split('|');
      let note = null;
      if (ok !== '1') {
        note = prompt('Why not? (shown to the creator, optional)') ?? null;
        if (note === null) return;
      }
      btn.disabled = true;
      const { error } = await sb().rpc('uw_review_hub_card', { p_user_id: uid, p_approve: ok === '1', p_note: note });
      if (error) say(error.message);
      else say(ok === '1' ? 'Approved — it goes into the hub at the next update.' : 'Rejected.');
      await refresh();
    }
  });

  async function mountIfVisible() {
    const page = document.getElementById('page-profile');
    if (!page || page.offsetParent === null) {
      return;
    }
    let host = document.getElementById('uwHubCardPanel');
    if (!host) {
      const wrap = page.querySelector('.wrap') || page;
      host = document.createElement('section');
      host.id = 'uwHubCardPanel';
      host.className = 'uwhc';
      wrap.appendChild(host);
      mounted = false;
    }
    if (mounted) return;
    mounted = true;
    if (await load()) render();
    else host.innerHTML = '';
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-page="profile"]')) {
      mounted = false;
      setTimeout(mountIfVisible, 300);
    }
  });
  window.addEventListener('DOMContentLoaded', () => {
    openProfileFromHash();
    setInterval(mountIfVisible, 1500);
  });
  window.addEventListener('hashchange', openProfileFromHash);
  window.UWHubCards = { refresh, _state: state };
})();
