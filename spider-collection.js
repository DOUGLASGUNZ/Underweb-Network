/* UnderWeb spiders: private locker and consent-only public showcase.
   Include after the site's existing profile scripts; no external dependencies. */
(() => {
  'use strict';

  const CATALOG = [
    ['dustling', 'Basement Dustling', 'Common'],
    ['cable', 'Cable Crawler', 'Common'],
    ['pocket', 'Pocket Spinner', 'Common'],
    ['server', 'Server-Rack Skitterer', 'Common'],
    ['glitch', 'Glitch Widow', 'Cursed'],
    ['hexbyte', 'Hexbyte Weaver', 'Cursed'],
    ['static', 'Static Fang', 'Cursed'],
    ['neon', 'Neon Orbweaver', 'Shiny'],
    ['chrome', 'Chrome Eightlegs', 'Shiny'],
    ['spring', 'Equinox Lanternling', 'Seasonal'],
    ['summer', 'Solstice Spinner', 'Seasonal'],
    ['autumn', 'Harvest Haunter', 'Seasonal'],
    ['winter', 'Frostbyte Spider', 'Seasonal'],
    ['null', 'The Null Weaver', 'Absurdly Rare'],
    ['ceo', 'CEO of Webs', 'Absurdly Rare']
  ].map(([id, name, rarity]) => ({ id, name, rarity }));
  const BY_ID = new Map(CATALOG.map(spider => [spider.id, spider]));
  const RARE = new Set(['Shiny', 'Seasonal', 'Absurdly Rare']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const sessionId = () => {
    try { return typeof currentSession !== 'undefined' ? String(currentSession?.user?.id || '') : ''; }
    catch (_) { return ''; }
  };
  const api = () => {
    try { return typeof uwSupabase !== 'undefined' ? uwSupabase : window.uwSupabase; }
    catch (_) { return window.uwSupabase; }
  };
  const message = (parent, heading, detail) => {
    const box = element('div', 'uwsp-state');
    box.append(element('strong', '', heading), element('span', '', detail));
    parent.append(box);
    return box;
  };
  const count = value => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  };
  const safeCollection = value => {
    const result = Object.create(null);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const spider of CATALOG) {
        const n = count(value[spider.id]);
        if (n) result[spider.id] = n;
      }
    }
    return result;
  };
  const entry = (spider, quantity, selectable, selected, onToggle) => {
    const card = element(selectable ? 'button' : 'div', 'uwsp-item' + (selectable ? ' uwsp-select' : ''));
    card.dataset.rarity = spider.rarity;
    if (selectable) {
      card.type = 'button';
      card.setAttribute('aria-pressed', String(selected));
      card.setAttribute('aria-label', `${selected ? 'Remove' : 'Select'} ${spider.name} for public showcase`);
      card.addEventListener('click', onToggle);
    }
    const mark = element('span', 'uwsp-mark', 'Ⅷ');
    mark.setAttribute('aria-hidden', 'true');
    const info = element('span', 'uwsp-info');
    info.append(element('b', '', spider.name), element('small', '', spider.rarity));
    card.append(mark, info, element('span', 'uwsp-quantity', `×${quantity}`));
    if (selectable) {
      const check = element('span', 'uwsp-check', selected ? '✓' : '');
      check.setAttribute('aria-hidden', 'true');
      card.append(check);
    }
    return card;
  };

  let owner = '';
  let privateGeneration = 0;
  let saving = false;
  let locker = null;
  let draft = { linked: false, collection: Object.create(null), showcase_enabled: false, showcase_ids: [] };
  let chosen = [];
  let enabled = false;
  let feedback = '';
  let feedbackError = false;

  function mountPrivate() {
    const page = document.getElementById('page-profile');
    if (!page) return null;
    if (locker?.isConnected) return locker;
    locker = element('section', 'uwsp-panel uwpo-editor-group');
    locker.id = 'uwSpiderCollection';
    locker.dataset.uwpoEditorGroup = 'identity';
    locker.setAttribute('aria-label', 'Your spider collection');
    const anchor = page.querySelector('#uwCosmeticsLocker');
    if (anchor) anchor.insertAdjacentElement('afterend', locker);
    else (page.querySelector('.uw40-profile-page') || page).append(locker);
    const tab = page.querySelector('.uwpo-editor-nav');
    if (tab && tab.dataset.active && tab.dataset.active !== 'identity') {
      locker.hidden = true;
      locker.style.display = 'none';
    }
    return locker;
  }

  function renderPrivate(mode = 'ready') {
    const panel = mountPrivate();
    if (!panel) return;
    panel.replaceChildren();
    const head = element('div', 'uwsp-head');
    const title = element('div');
    title.append(element('span', 'uwsp-eyebrow', 'PRIVATE COLLECTION / UNDERWEB'),
      element('h3', '', 'Spider collection'),
      element('p', '', 'Little finds from around the network. Collected for fun, never for rank.'));
    head.append(title);
    if (mode === 'ready' && draft.linked) {
      const distinct = Object.keys(draft.collection).length;
      head.append(element('span', 'uwsp-count', `${distinct} FOUND`));
    }
    panel.append(head);

    if (!owner) {
      message(panel, 'Sign in to see your spiders', 'Your collection belongs to your account and stays private.');
      return;
    }
    if (mode === 'loading') {
      const status = element('div', 'uwsp-state', 'Checking your collection…');
      status.setAttribute('role', 'status');
      panel.append(status, element('div', 'uwsp-skeleton'), element('div', 'uwsp-skeleton'));
      return;
    }
    if (mode === 'error') {
      message(panel, 'Collection could not load', 'Your spiders are still yours. Try again in a moment.');
      const retry = element('button', 'uwsp-button uwsp-button-secondary', 'TRY AGAIN');
      retry.type = 'button';
      retry.addEventListener('click', loadPrivate);
      panel.append(retry);
      return;
    }
    if (!draft.linked) {
      message(panel, 'Connect Discord to begin', 'Link your UnderWeb account to see the spiders you have found. Nothing is shown publicly by default.');
      const link = element('a', 'uwsp-link', 'LINK DISCORD ACCOUNT');
      link.href = '/account/discord/link/';
      panel.append(link);
      return;
    }
    const owned = CATALOG.filter(spider => draft.collection[spider.id]);
    if (!owned.length) {
      message(panel, 'A little room for discoveries', 'No spiders found yet. When you find one, it will settle in here.');
    } else {
      const grid = element('div', 'uwsp-grid');
      owned.forEach(spider => grid.append(entry(spider, draft.collection[spider.id], false)));
      panel.append(grid);
    }

    panel.append(element('div', 'uwsp-divider'));
    const showcaseHead = element('div', 'uwsp-head');
    const intro = element('div');
    intro.append(element('span', 'uwsp-eyebrow', 'OPTIONAL / PUBLIC PROFILE'),
      element('h3', '', 'Rare little sightings'),
      element('p', '', 'Choose up to three rare finds for your profile. Your full collection stays yours.'));
    showcaseHead.append(intro, element('span', 'uwsp-count', `${chosen.length} / 3`));
    panel.append(showcaseHead);
    const rareOwned = owned.filter(spider => RARE.has(spider.rarity));
    if (rareOwned.length) {
      const grid = element('div', 'uwsp-grid');
      rareOwned.forEach(spider => grid.append(entry(spider, draft.collection[spider.id], true, chosen.includes(spider.id), () => {
        if (saving) return;
        if (chosen.includes(spider.id)) chosen = chosen.filter(id => id !== spider.id);
        else if (chosen.length < 3) chosen = [...chosen, spider.id];
        else { feedback = 'Pick up to three rare spiders.'; feedbackError = true; renderPrivate(); return; }
        feedback = 'Unsaved changes'; feedbackError = false; renderPrivate();
      })));
      panel.append(grid);
    } else {
      message(panel, 'No rare finds yet', 'Shiny, seasonal, and absurdly rare spiders can appear here once found.');
    }
    const controls = element('div', 'uwsp-controls');
    controls.style.marginTop = '14px';
    const label = element('label', 'uwsp-switch');
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = enabled;
    toggle.disabled = saving;
    toggle.addEventListener('change', () => {
      enabled = toggle.checked;
      feedback = 'Unsaved changes'; feedbackError = false;
      renderPrivate();
    });
    label.append(toggle, element('span', '', 'Show selected spiders on my public profile'));
    const save = element('button', 'uwsp-button', saving ? 'SAVING…' : 'SAVE SHOWCASE');
    save.type = 'button';
    save.disabled = saving;
    save.addEventListener('click', savePrivate);
    controls.append(label, save);
    if (feedback) {
      const status = element('span', 'uwsp-feedback', feedback);
      status.dataset.tone = feedbackError ? 'error' : 'normal';
      status.setAttribute('role', 'status');
      controls.append(status);
    }
    panel.append(controls, element('p', 'uwsp-note', 'Showing spiders is entirely optional. This never changes roles, verification, or access.'));
  }

  async function loadPrivate() {
    const uid = owner;
    if (!uid || !api()) return false;
    const generation = ++privateGeneration;
    renderPrivate('loading');
    try {
      const { data, error } = await api().rpc('uw_my_spiders');
      if (uid !== owner || generation !== privateGeneration) return false;
      if (error || !data || typeof data !== 'object') throw error || new Error('Invalid collection');
      draft = {
        linked: data.linked === true,
        collection: safeCollection(data.collection),
        showcase_enabled: data.showcase_enabled === true,
        showcase_ids: Array.isArray(data.showcase_ids) ? data.showcase_ids : []
      };
      chosen = [...new Set(draft.showcase_ids.filter(id => {
        const spider = BY_ID.get(id);
        return spider && RARE.has(spider.rarity) && draft.collection[id];
      }))].slice(0, 3);
      enabled = draft.showcase_enabled;
      feedback = ''; feedbackError = false;
      renderPrivate();
      return true;
    } catch (_) {
      if (uid === owner && generation === privateGeneration) renderPrivate('error');
      return false;
    }
  }

  async function savePrivate() {
    if (saving || !owner || !draft.linked || !api()) return;
    const uid = owner;
    const generation = privateGeneration;
    saving = true;
    feedback = ''; renderPrivate();
    try {
      const { data, error } = await api().rpc('uw_set_spider_showcase', {
        p_enabled: enabled,
        p_spider_ids: chosen.slice(0, 3)
      });
      if (uid !== owner || generation !== privateGeneration) return;
      if (error || !data || typeof data !== 'object') throw error || new Error('Could not save');
      feedback = 'Saved to your profile.'; feedbackError = false;
      // Re-read the authoritative private state, including any server-side filtering.
      const refreshed = await loadPrivate();
      if (uid === owner && refreshed) { feedback = 'Showcase saved.'; renderPrivate(); }
      refreshPublicForOwner(uid);
    } catch (_) {
      if (uid === owner && generation === privateGeneration) {
        feedback = 'Could not save. Please try again.'; feedbackError = true;
      }
    } finally {
      saving = false;
      if (uid === owner && locker?.querySelector('.uwsp-controls')) renderPrivate();
    }
  }

  let publicGeneration = 0;
  let publicUid = '';
  let wasOpen = false;
  function removePublic() {
    document.getElementById('uwSpiderPublicShowcase')?.remove();
  }
  function activePublicUid() {
    try { return String(window.uw621ActiveCreator || '').trim(); }
    catch (_) { return ''; }
  }
  function modalCurrent(uid, generation) {
    const modal = document.getElementById('uw621ProfileModal');
    return generation === publicGeneration && modal?.classList.contains('open') && activePublicUid() === uid;
  }
  async function loadPublic(uid) {
    const generation = ++publicGeneration;
    removePublic(); // No old owner's collection even while the new RPC is loading.
    if (!UUID.test(uid) || !api()) return;
    try {
      const { data, error } = await api().rpc('uw_public_spiders', { p_user_id: uid });
      if (!modalCurrent(uid, generation) || error || !Array.isArray(data?.spiders)) return;
      // Public RPC returns only enabled, selected entries. Never query the private RPC here.
      const found = new Map();
      for (const row of data.spiders) {
        const spider = BY_ID.get(row?.id);
        const quantity = count(row?.count);
        if (spider && RARE.has(spider.rarity) && quantity && !found.has(spider.id) && found.size < 3) {
          found.set(spider.id, quantity);
        }
      }
      if (!found.size) return; // An opted-out profile has no spider UI at all.
      const modal = document.getElementById('uw621ProfileModal');
      const main = modal?.querySelector('.uw621-main');
      if (!main || !modalCurrent(uid, generation)) return;
      const panel = element('section', 'uwsp-public');
      panel.id = 'uwSpiderPublicShowcase';
      panel.setAttribute('aria-label', 'Rare spider sightings');
      const header = element('div', 'uwsp-head');
      const text = element('div');
      text.append(element('span', 'uwsp-eyebrow', 'SMALL FINDS / SHARED BY CHOICE'),
        element('h3', '', 'Rare spider sightings'));
      header.append(text);
      const grid = element('div', 'uwsp-grid');
      for (const [id, quantity] of found) grid.append(entry(BY_ID.get(id), quantity, false));
      panel.append(header, grid);
      main.append(panel);
    } catch (_) {
      // Privacy-first: network failures and opt-out both leave the public section absent.
    }
  }
  function checkModal(force = false) {
    const modal = document.getElementById('uw621ProfileModal');
    const open = Boolean(modal?.classList.contains('open'));
    const uid = open ? activePublicUid() : '';
    if (force || uid !== publicUid || open !== wasOpen) {
      publicUid = uid; wasOpen = open;
      if (open) loadPublic(uid);
      else { ++publicGeneration; removePublic(); }
    }
  }
  function refreshPublicForOwner(uid) {
    if (activePublicUid() === uid) checkModal(true);
  }
  function syncAuth() {
    const uid = sessionId();
    if (uid === owner) return;
    ++privateGeneration;
    owner = uid;
    draft = { linked: false, collection: Object.create(null), showcase_enabled: false, showcase_ids: [] };
    chosen = []; enabled = false; feedback = ''; feedbackError = false; saving = false;
    if (uid) loadPrivate();
    else renderPrivate();
  }

  function init() {
    mountPrivate();
    renderPrivate();
    syncAuth();
    checkModal();
    const modal = document.getElementById('uw621ProfileModal');
    if (modal) new MutationObserver(() => checkModal()).observe(modal, {
      attributes: true, attributeFilter: ['class'], childList: true, subtree: true
    });
    // Existing People and creator openers set the active ID through different paths.
    // Poll just that primitive while open so either path can refresh the showcase.
    setInterval(() => { syncAuth(); checkModal(); }, 350);
    api()?.auth?.onAuthStateChange?.(() => setTimeout(syncAuth, 0));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();