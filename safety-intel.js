/* Safety Intel shares the site's UnderWeb session and Supabase RLS policies. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const validId = value => /^usr_[A-Za-z0-9-]{8,}$/.test(value);
  const categories = {
    crashing:'Crashing', doxxing_privacy_threat:'Doxxing / privacy threat',
    harassment:'Harassment', scam_impersonation:'Scam / impersonation',
    malicious_client_behavior:'Malicious client behavior',
    ban_evasion:'Ban evasion', other:'Other harmful behavior'
  };
  const label = value => categories[value] || 'Other';
  const date = value => value ? new Date(value).toLocaleString() : 'Not specified';
  const client = () => typeof uwSupabase === 'undefined' ? null : uwSupabase;
  const message = (value, error = false) => {
    const el = $('uwsiFormStatus');
    if (el) { el.textContent = value; el.classList.toggle('error', error); }
  };
  let loadingQueue = false;

  async function session() {
    const sb = client();
    if (!sb) return null;
    return (await sb.auth.getSession()).data.session;
  }
  function safeLink(raw) {
    try {
      const url = new URL(raw);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }
  async function submit(event) {
    event.preventDefault();
    const sb = client(), account = await session();
    if (!account?.user) {
      message('Sign in to your UnderWeb account, then submit this report.', true);
      if (typeof passwordlessSignIn === 'function') passwordlessSignIn();
      return;
    }
    const id = $('uwsiUserId').value.trim();
    const summary = $('uwsiSummary').value.trim();
    const link = $('uwsiEvidence').value.trim();
    if (!validId(id)) return message('Enter a valid VRChat usr_ ID.', true);
    if (summary.length < 10 || summary.length > 2000) return message('Details must be 10–2000 characters.', true);
    if (link && !safeLink(link)) return message('Evidence links must start with https:// or http://.', true);
    const button = $('uwsiSubmit');
    button.disabled = true;
    message('Submitting privately…');
    try {
      const incident = $('uwsiIncidentAt').value;
      const payload = {
        vrchat_user_id: id,
        last_known_display_name: $('uwsiDisplayName').value.trim() || null,
        category: $('uwsiCategory').value,
        suggested_severity: $('uwsiSeverity').value,
        incident_at: incident ? new Date(incident).toISOString() : null,
        incident_world: $('uwsiWorld').value.trim() || null,
        summary,
        status: 'pending',
        reporter_user_id: account.user.id
      };
      const result = await sb.from('uwx_safety_reports').insert(payload).select('id').single();
      if (result.error) throw result.error;
      if (link) {
        const evidence = await sb.from('uwx_safety_evidence').insert({
          report_id: result.data.id, submitted_by: account.user.id,
          evidence_type: 'other', url: safeLink(link)
        });
        if (evidence.error) {
          message('Report submitted, but the evidence link failed to attach. Share it privately with staff and include report ID ' + result.data.id + '.', true);
        } else message('Private report submitted. Staff will review it before any public warning.');
      } else message('Private report submitted. Staff will review it before any public warning.');
      $('uwsiForm').reset();
      await loadMine();
      if (!$('uwsiStaff').hidden) await loadQueue();
    } catch (error) {
      message(error?.message || 'Report could not be submitted.', true);
    } finally {
      button.disabled = false;
    }
  }
  async function loadMine() {
    const box = $('uwsiMine'), sb = client(), account = await session();
    if (!box || !sb) return;
    if (!account?.user) {
      box.innerHTML = '<div class="uw-empty">Sign in to see your private reports.</div>';
      return;
    }
    box.innerHTML = '<div class="uw-empty">Loading your reports…</div>';
    const { data, error } = await sb.from('uwx_safety_reports')
      .select('id,vrchat_user_id,last_known_display_name,category,status,created_at,updated_at')
      .eq('reporter_user_id', account.user.id).order('created_at', { ascending:false }).limit(50);
    if (error) {
      box.textContent = 'Your reports could not be loaded: ' + error.message;
      return;
    }
    box.innerHTML = data?.length ? data.map(row => `<article class="uwsi-item">
      <div class="uwsi-item-head"><div><small>${esc(label(row.category))} · ${esc(date(row.created_at))}</small>
      <h3>${esc(row.last_known_display_name || row.vrchat_user_id)}</h3><small>${esc(row.vrchat_user_id)}</small></div>
      <span class="uwsi-badge ${esc(row.status)}">${esc(row.status)}</span></div>
    </article>`).join('') : '<div class="uw-empty">You have not submitted a Safety Intel report yet.</div>';
  }
  async function isStaff() {
    const account = await session();
    if (!account?.user) return false;
    const { data, error } = await client().rpc('uwx_can_review_safety');
    return !error && data === true;
  }
  async function loadQueue() {
    const box = $('uwsiQueue'), sb = client();
    if (!box || !sb || loadingQueue || !(await isStaff())) return;
    loadingQueue = true;
    box.innerHTML = '<div class="uw-empty">Loading private reports…</div>';
    try {
      const { data, error } = await sb.from('uwx_safety_reports')
        .select('id,vrchat_user_id,last_known_display_name,category,suggested_severity,incident_at,incident_world,summary,status,created_at,public_summary')
        .eq('status', $('uwsiFilter').value).order('created_at', { ascending:false }).limit(75);
      if (error) throw error;
      const ids = (data || []).map(row => row.id);
      let links = {};
      if (ids.length) {
        const evidence = await sb.from('uwx_safety_evidence')
          .select('report_id,url,description,evidence_type').in('report_id', ids);
        if (evidence.error) throw evidence.error;
        for (const item of evidence.data || []) {
          (links[item.report_id] ||= []).push(item);
        }
      }
      box.innerHTML = data?.length ? data.map(row => {
        const evidence = (links[row.id] || []).map(item => {
          const href = safeLink(item.url || '');
          return href ? `<a class="uwsi-evidence" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Private evidence link ↗</a>`
            : `<p>${esc(item.description || 'Evidence reference')}</p>`;
        }).join('');
        return `<article class="uwsi-item" data-uwsi-report="${esc(row.id)}">
          <div class="uwsi-item-head"><div><small>${esc(label(row.category))} · ${esc(date(row.created_at))}</small>
            <h3>${esc(row.last_known_display_name || row.vrchat_user_id)}</h3><small>${esc(row.vrchat_user_id)}</small></div>
            <span class="uwsi-badge ${esc(row.status)}">${esc(row.status)}</span></div>
          <p>${esc(row.summary)}</p>
          <small>Suggested: ${esc(row.suggested_severity)} · Incident: ${esc(date(row.incident_at))} · ${esc(row.incident_world || 'Location not specified')}</small>
          <div>${evidence}</div>
          <div class="uwsi-review">
            <label>Internal review note<textarea class="uw-textarea" data-uwsi-note maxlength="2000" placeholder="Required for rejection or expiry"></textarea></label>
            <label>Sanitized public summary<textarea class="uw-textarea" data-uwsi-public minlength="20" maxlength="500" placeholder="Only verified behavior. Never include evidence links, private details, reporter identity, or doxxed material.">${esc(row.public_summary || '')}</textarea></label>
            <div class="uwsi-two"><label>Reviewed risk<select class="uw-select" data-uwsi-risk><option value="info">Info</option><option value="caution" selected>Caution</option><option value="high">High Risk</option></select></label>
            <label>Warning expires in<select class="uw-select" data-uwsi-days><option value="30">30 days</option><option value="90" selected>90 days</option><option value="180">180 days</option><option value="365">1 year</option></select></label></div>
            <div class="uwsi-review-actions">
              <button class="uw-mini-btn" data-uwsi-decision="reviewing" type="button">REVIEWING</button>
              <button class="uw-mini-btn hot" data-uwsi-decision="verified" type="button">VERIFY &amp; PUBLISH</button>
              <button class="uw-mini-btn danger" data-uwsi-decision="rejected" type="button">REJECT</button>
              ${row.status === 'verified' ? '<button class="uw-mini-btn danger" data-uwsi-decision="expired" type="button">REMOVE WARNING</button>' : ''}
            </div>
          </div>
        </article>`;
      }).join('') : '<div class="uw-empty">No reports in this review state.</div>';
    } catch (error) {
      box.textContent = 'Review queue could not be loaded: ' + (error?.message || 'Unknown error');
    } finally { loadingQueue = false; }
  }
  async function review(button) {
    if (!(await isStaff())) return;
    const card = button.closest('[data-uwsi-report]');
    const decision = button.dataset.uwsiDecision;
    if (!card || !['reviewing','verified','rejected','expired'].includes(decision)) return;
    const note = card.querySelector('[data-uwsi-note]').value.trim();
    const publicSummary = card.querySelector('[data-uwsi-public]').value.trim();
    if (decision === 'verified' && (publicSummary.length < 20 || publicSummary.length > 500)) {
      return alert('Write a 20–500 character sanitized public summary first.');
    }
    if (['rejected','expired'].includes(decision) && note.length < 10) {
      return alert('Add an internal reason of at least 10 characters.');
    }
    if (decision === 'verified' && !confirm('Publish this sanitized summary to UWX? Check that it contains no private information.')) return;
    const days = Number(card.querySelector('[data-uwsi-days]').value);
    const expiry = new Date(Date.now() + days * 86400000).toISOString();
    button.disabled = true;
    try {
      const { error } = await client().rpc('uwx_review_safety_report', {
        p_report_id: card.dataset.uwsiReport, p_decision: decision,
        p_review_note: note || null,
        p_public_summary: decision === 'verified' ? publicSummary : null,
        p_risk_level: decision === 'verified' ? card.querySelector('[data-uwsi-risk]').value : null,
        p_expires_at: decision === 'verified' ? expiry : null
      });
      if (error) throw error;
      if (typeof toast === 'function') toast('Safety review saved.');
      await loadQueue();
      await loadMine();
    } catch (error) {
      alert('Review could not be saved: ' + (error?.message || 'Unknown error'));
    } finally { button.disabled = false; }
  }
  async function loadPage() {
    const account = await session();
    if (!account) message('Sign in with your UnderWeb account to submit a private report.');
    await loadMine();
    const staff = await isStaff();
    $('uwsiStaff').hidden = !staff;
    if (staff) await loadQueue();
  }
  $('uwsiForm')?.addEventListener('submit', submit);
  $('uwsiReloadMine')?.addEventListener('click', loadMine);
  $('uwsiReloadQueue')?.addEventListener('click', loadQueue);
  $('uwsiFilter')?.addEventListener('change', loadQueue);
  $('uwsiQueue')?.addEventListener('click', event => {
    const button = event.target.closest('[data-uwsi-decision]');
    if (button) review(button);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-page="safety"]')) setTimeout(loadPage, 0);
  });
  client()?.auth.onAuthStateChange(() => {
    if ($('page-safety')?.classList.contains('active')) setTimeout(loadPage, 0);
  });
  const params = new URLSearchParams(location.search);
  const target = params.get('safety');
  if (target && validId(target)) {
    $('uwsiUserId').value = target;
    setTimeout(() => { if (typeof showPage === 'function') showPage('safety'); loadPage(); }, 0);
  }
})();
