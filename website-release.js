(() => {
  "use strict";
  const adminNames = new Set(["Owner", "Director", "Admin"]);
  const adminSlugs = new Set(["owner", "director", "admin"]);
  const get = (id) => document.getElementById(id);
  const isValidPublicUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && ["underweb.cloud", "www.underweb.cloud"].includes(url.hostname);
    } catch { return false; }
  };
  const hasAdminRole = () => {
    try {
      if (!currentSession) return false;
      const memberships = Array.isArray(currentMemberships) ? currentMemberships : [];
      const roles = Array.isArray(uw50Roles) ? uw50Roles : [];
      return memberships.some((membership) =>
        membership.status === "approved" && adminNames.has(membership.role_name),
      ) || roles.some((role) =>
        role.status === "active" && adminSlugs.has(role.role_slug),
      );
    } catch {
      return false;
    }
  };

  function mountReleaseForm() {
    if (!document.getElementById("uwPublicReleaseHiddenStyle")) {
      const hiddenStyle = document.createElement("style");
      hiddenStyle.id = "uwPublicReleaseHiddenStyle";
      hiddenStyle.textContent = "#uwPublicReleasePanel[hidden],#uwPublicAnnouncementPanel[hidden]{display:none!important}";
      document.head.appendChild(hiddenStyle);
    }
    const page = get("page-announcements");
    const postButton = get("postAnnouncementBtn");
    if (!page || !postButton || get("uwPublicReleasePanel")) return;
    const staffSection = postButton.closest("section");
    if (!staffSection) return;
    staffSection.insertAdjacentHTML("afterend", `
      <section class="uw-section" id="uwPublicReleasePanel" hidden style="margin-bottom:16px">
        <div class="uw-section-head"><h3>Publish Public Website Release</h3><small>Owner, Director, or Admin</small></div>
        <form id="uwPublicReleaseForm" class="uw-form-grid">
          <label class="uw-label">Release key / version
            <input class="uw-input" name="releaseKey" required maxlength="80" pattern="[a-z0-9][a-z0-9._-]{0,79}" placeholder="0.8.0-beta.1" autocomplete="off">
          </label>
          <label class="uw-label">Title
            <input class="uw-input" name="title" required maxlength="240" placeholder="UnderWeb beta update">
          </label>
          <label class="uw-label full">Release notes
            <textarea class="uw-textarea" name="body" required maxlength="3300" placeholder="What changed in this release?"></textarea>
          </label>
          <label class="uw-label full">Public UnderWeb URL (optional)
            <input class="uw-input" name="publicUrl" type="url" maxlength="500" placeholder="https://www.underweb.cloud/updates/0.8.0">
          </label>
          <div class="full"><button class="btn hot" type="submit" id="uwPublicReleaseSubmit">PUBLISH PUBLIC RELEASE</button>
            <p id="uwPublicReleaseStatus" role="status" aria-live="polite" style="margin:10px 0 0"></p>
            <small>Publishing records a public release and queues it for the Discord bot. Reusing a release key will not create a second announcement.</small>
          </div>
        </form>
      </section>`);

    const form = get("uwPublicReleaseForm");
    const submit = get("uwPublicReleaseSubmit");
    const status = get("uwPublicReleaseStatus");
    const syncVisibility = () => {
      const panel = get("uwPublicReleasePanel");
      if (panel) panel.hidden = !hasAdminRole();
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!hasAdminRole()) {
        status.textContent = "Only an active Owner, Director, or Admin can publish a public release.";
        return;
      }
      const data = new FormData(form);
      const releaseKey = String(data.get("releaseKey") || "").trim();
      const title = String(data.get("title") || "").trim();
      const body = String(data.get("body") || "").trim();
      const publicUrl = String(data.get("publicUrl") || "").trim();
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(releaseKey)) {
        status.textContent = "Use a lowercase release key with letters, numbers, dots, dashes, or underscores.";
        return;
      }
      if (publicUrl && (!isValidPublicUrl(publicUrl) || publicUrl.length > 500)) {
        status.textContent = "The optional link must be an HTTPS page on underweb.cloud.";
        return;
      }
      if (typeof uwSupabase === "undefined") {
        status.textContent = "The website database client is not available. Please refresh and try again.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "PUBLISHING…";
      status.textContent = "Publishing release…";
      try {
        const { data: activityId, error } = await uwSupabase.rpc("publish_website_release", {
          p_release_key: releaseKey,
          p_title: title,
          p_body: body,
          p_public_url: publicUrl || null,
        });
        if (error) throw error;
        if (!activityId) throw new Error("The release publisher returned no activity ID.");
        form.reset();
        status.textContent = "Public release recorded. The Discord bot will post it after its next successful check.";
      } catch (error) {
        status.textContent = error?.message || "The release could not be published. Please try again.";
      } finally {
        submit.disabled = false;
        submit.textContent = "PUBLISH PUBLIC RELEASE";
        syncVisibility();
      }
    });
    syncVisibility();
    if (typeof uwSupabase !== "undefined" && uwSupabase.auth?.onAuthStateChange) {
      uwSupabase.auth.onAuthStateChange(() => setTimeout(syncVisibility, 0));
    }
    page.addEventListener("click", () => setTimeout(syncVisibility, 250));
    window.setInterval(() => {
      if (page.classList.contains("active")) syncVisibility();
    }, 1000);
  }

  function mountPublicAnnouncementPanel() {
    const page = get("page-announcements");
    const releasePanel = get("uwPublicReleasePanel");
    if (!page || !releasePanel || get("uwPublicAnnouncementPanel")) return;
    releasePanel.insertAdjacentHTML("afterend", [
      '<section class="uw-section" id="uwPublicAnnouncementPanel" hidden style="margin-bottom:16px">',
      '<div class="uw-section-head"><h3>Public Discord Announcement</h3><small>Owner, Director, or Admin</small></div>',
      '<p role="note" style="border-left:3px solid #ffb020;padding:10px 12px;background:rgba(255,176,32,.08)"><strong>PUBLIC:</strong> Publishing sends this message to the public UnderWeb activity feed and the configured Discord website channel. Do not include staff-only or private information. This is separate from the internal Staff Feed and release publisher.</p>',
      '<form id="uwPublicAnnouncementForm" class="uw-form-grid">',
      '<label class="uw-label full">Announcement title<input class="uw-input" name="title" required maxlength="240" placeholder="What should the community know?"></label>',
      '<label class="uw-label full">Public message<textarea class="uw-textarea" name="body" required maxlength="3300" placeholder="Write the public announcement."></textarea></label>',
      '<label class="uw-label full">Public UnderWeb URL (optional)<input class="uw-input" name="publicUrl" type="url" maxlength="500" placeholder="https://www.underweb.cloud/updates"></label>',
      '<div class="full"><button class="btn hot" type="submit" id="uwPublicAnnouncementSubmit">PUBLISH PUBLIC ANNOUNCEMENT</button>',
      '<p id="uwPublicAnnouncementStatus" role="status" aria-live="polite" style="margin:10px 0 0"></p>',
      '<small>Only an active Owner, Director, or Admin can publish. Repeating the same pending submission is idempotent.</small></div>',
      '</form></section>'
    ].join(""));

    const form = get("uwPublicAnnouncementForm");
    const submit = get("uwPublicAnnouncementSubmit");
    const status = get("uwPublicAnnouncementStatus");
    let pendingSubmission = null;
    const syncVisibility = () => {
      const panel = get("uwPublicAnnouncementPanel");
      if (panel) panel.hidden = !hasAdminRole();
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!hasAdminRole()) {
        status.textContent = "Only an active Owner, Director, or Admin can publish a public announcement.";
        return;
      }
      const data = new FormData(form);
      const title = String(data.get("title") || "").trim();
      const body = String(data.get("body") || "").trim();
      const publicUrl = String(data.get("publicUrl") || "").trim();
      if (!title || title.length > 240) {
        status.textContent = "Enter a title between 1 and 240 characters.";
        return;
      }
      if (!body || body.length > 3300) {
        status.textContent = "Enter a public message between 1 and 3,300 characters.";
        return;
      }
      if (publicUrl && (!isValidPublicUrl(publicUrl) || publicUrl.length > 500)) {
        status.textContent = "The optional link must be an HTTPS page on underweb.cloud.";
        return;
      }
      if (typeof uwSupabase === "undefined") {
        status.textContent = "The website database client is not available. Please refresh and try again.";
        return;
      }
      const signature = JSON.stringify([title, body, publicUrl]);
      if (!pendingSubmission || pendingSubmission.signature !== signature) {
        try {
          const secureCrypto = window.crypto;
          let key;
          if (secureCrypto && typeof secureCrypto.randomUUID === "function") {
            key = secureCrypto.randomUUID();
          } else if (secureCrypto && typeof secureCrypto.getRandomValues === "function") {
            const bytes = secureCrypto.getRandomValues(new Uint8Array(16));
            bytes[6] = (bytes[6] & 15) | 64;
            bytes[8] = (bytes[8] & 63) | 128;
            const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
            key = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
          } else {
            throw new Error("Secure announcement key generation is unavailable in this browser.");
          }
          pendingSubmission = { signature, key };
        } catch (error) {
          status.textContent = error?.message || "Could not prepare a safe announcement request.";
          return;
        }
      }
      submit.disabled = true;
      submit.textContent = "PUBLISHING…";
      status.textContent = "Publishing public announcement…";
      try {
        const { data: activityId, error } = await uwSupabase.rpc("publish_public_announcement", {
          p_announcement_key: pendingSubmission.key,
          p_title: title,
          p_body: body,
          p_public_url: publicUrl || null,
        });
        if (error) throw error;
        if (!activityId) throw new Error("The public announcement publisher returned no activity ID.");
        form.reset();
        pendingSubmission = null;
        status.textContent = "Public announcement recorded. The Discord bot will post it after its next successful check.";
      } catch (error) {
        status.textContent = error?.message || "The public announcement could not be published. Please try again.";
      } finally {
        submit.disabled = false;
        submit.textContent = "PUBLISH PUBLIC ANNOUNCEMENT";
        syncVisibility();
      }
    });
    syncVisibility();
    if (typeof uwSupabase !== "undefined" && uwSupabase.auth?.onAuthStateChange) {
      uwSupabase.auth.onAuthStateChange(() => setTimeout(syncVisibility, 0));
    }
    page.addEventListener("click", () => setTimeout(syncVisibility, 250));
    window.setInterval(() => {
      if (page.classList.contains("active")) syncVisibility();
    }, 1000);
  }

  function mountWebsiteForms() {
    mountReleaseForm();
    mountPublicAnnouncementPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWebsiteForms, { once: true });
  } else {
    mountWebsiteForms();
  }
})();
