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


  /* UW_HOMEPAGE_CLARITY_PASS_V1 */
  const homeNorm = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const homeVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && !el.hidden;
  };
  const homeFindExact = (selector, label) => {
    const wanted = homeNorm(label);
    const nodes = Array.from(document.querySelectorAll(selector)).filter((el) => homeNorm(el.textContent) === wanted);
    return nodes.find(homeVisible) || nodes[0] || null;
  };
  const homeStripIds = (root) => {
    if (root.id) root.removeAttribute("id");
    root.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  };
  const homeFindSectionByHeading = (pattern, visibleOnly = false) => {
    const sections = Array.from(document.querySelectorAll("section, [role='region']"));
    return sections.find((section) => {
      if (visibleOnly && !homeVisible(section)) return false;
      const heading = section.querySelector("h1,h2,h3,h4,[role='heading']");
      return heading && pattern.test(homeNorm(heading.textContent));
    }) || null;
  };
  const homeEnsureStyles = () => {
    if (get("uwHomepageClarityStyles")) return;
    const style = document.createElement("style");
    style.id = "uwHomepageClarityStyles";
    style.textContent = [
      ".uw-home-purpose{max-width:760px;margin:14px auto 0;color:rgba(235,255,242,.82);font-size:clamp(.98rem,1.5vw,1.08rem);line-height:1.65}",
      "#uwHomepageValueStack{width:min(1180px,calc(100% - 34px));margin:0 auto 54px;display:grid;gap:18px}",
      ".uw-home-value-section{border:1px solid rgba(98,255,143,.16);background:linear-gradient(135deg,rgba(8,18,12,.92),rgba(2,6,4,.96));border-radius:20px;padding:24px;overflow:hidden}",
      ".uw-home-value-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:18px}",
      ".uw-home-value-head h2{margin:4px 0 0;font-size:clamp(1.7rem,4vw,2.7rem);letter-spacing:-.035em}",
      ".uw-home-value-kicker{font:800 .7rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#62ff8f}",
      ".uw-home-value-note{max-width:500px;text-align:right;color:#91a89a;font-size:.82rem;line-height:1.5}",
      ".uw-home-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}",
      ".uw-home-feature-card{min-width:0!important;display:block!important;opacity:1!important;visibility:visible!important;transform:none!important}",
      ".uw-home-feature-card img{max-width:100%;height:auto}",
      ".uw-home-latest-card{display:block!important;opacity:1!important;visibility:visible!important;transform:none!important}",
      ".uw-home-empty-events-hidden{display:none!important}",
      ".uw-partner-fallback{min-height:120px;display:grid;place-items:center;border:1px dashed rgba(98,255,143,.2);background:rgba(98,255,143,.035);color:#7f9b89;font:800 .7rem ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase}",
      "nav a,nav button{font-size:max(12px,.78rem)}",
      "small{font-size:max(12px,.75rem);line-height:1.45}",
      "[class*='card'] [class*='meta'],[class*='card'] [class*='label']{font-size:max(12px,.74rem)}",
      "@media(max-width:760px){#uwHomepageValueStack{width:min(100% - 22px,1180px);margin-bottom:34px}.uw-home-card-grid{grid-template-columns:1fr}.uw-home-value-head{display:block}.uw-home-value-note{text-align:left;margin-top:8px}.uw-home-value-section{padding:18px}}"
    ].join("");
    document.head.appendChild(style);
  };
  const homeHero = () => {
    const tagline = Array.from(document.querySelectorAll("h1,h2,h3,p,div,span"))
      .find((el) => homeNorm(el.textContent) === "a darker place to create together");
    if (!tagline) return null;
    if (!document.querySelector(".uw-home-purpose")) {
      const purpose = document.createElement("p");
      purpose.className = "uw-home-purpose";
      purpose.textContent = "Find creators. Showcase your work. Join events, collaborations, and projects across the network.";
      tagline.insertAdjacentElement("afterend", purpose);
    }
    return tagline.closest("header,section,.hero,[class*='hero']") || tagline.parentElement;
  };
  const homeClarifyCtas = () => {
    const mappings = [
      ["Enter Network", "Browse Creators", "Browse creator profiles and work"],
      ["Join Network", "Create Your Profile", "Create your UnderWeb creator profile"]
    ];
    mappings.forEach(([from, to, aria]) => {
      document.querySelectorAll("a,button").forEach((el) => {
        if (homeNorm(el.textContent) !== homeNorm(from)) return;
        el.textContent = to;
        el.setAttribute("aria-label", aria);
      });
    });
    const signIn = homeFindExact("a,button", "Sign In");
    if (signIn) signIn.setAttribute("aria-label", "Sign in to your UnderWeb account");
  };
  const homeEnsureValueStack = (hero) => {
    let stack = get("uwHomepageValueStack");
    if (stack) return stack;
    if (!hero) return null;
    stack = document.createElement("div");
    stack.id = "uwHomepageValueStack";
    stack.setAttribute("aria-label", "Featured UnderWeb network activity");
    hero.insertAdjacentElement("afterend", stack);
    return stack;
  };
  const homeCreatorCandidates = () => {
    const selectors = [
      "[data-profile-id]",
      "[data-creator-id]",
      ".creator-card",
      ".profile-card",
      "[class*='creator-card']",
      "[class*='profile-card']"
    ];
    let cards = Array.from(document.querySelectorAll(selectors.join(",")));
    cards = cards.filter((el) =>
      !el.closest("#uwHomepageValueStack") &&
      !el.closest("nav") &&
      !el.querySelector("form") &&
      homeNorm(el.textContent).length > 12
    );
    if (cards.length < 3) {
      const creatorSection = homeFindSectionByHeading(/creator|network directory|directory/);
      if (creatorSection) {
        const fallback = Array.from(creatorSection.querySelectorAll("article,.card,[class*='card']"))
          .filter((el) => !el.querySelector("form") && homeNorm(el.textContent).length > 12);
        cards.push(...fallback);
      }
    }
    return Array.from(new Set(cards)).slice(0, 3);
  };
  const homeMountFeaturedCreators = (stack) => {
    if (!stack || get("uwHomepageFeatured")) return !!get("uwHomepageFeatured");
    const sources = homeCreatorCandidates();
    if (!sources.length) return false;
    const section = document.createElement("section");
    section.id = "uwHomepageFeatured";
    section.className = "uw-home-value-section";
    section.innerHTML = '<div class="uw-home-value-head"><div><div class="uw-home-value-kicker">Network spotlight</div><h2>Featured creators & work</h2></div><div class="uw-home-value-note">Meet people already building, performing, shooting, designing, and creating inside UnderWeb.</div></div><div class="uw-home-card-grid"></div>';
    const grid = section.querySelector(".uw-home-card-grid");
    sources.forEach((source) => {
      const clone = source.cloneNode(true);
      homeStripIds(clone);
      clone.classList.add("uw-home-feature-card");
      if (!clone.querySelector("a[href]") && typeof source.click === "function") {
        clone.style.cursor = "pointer";
        clone.addEventListener("click", () => source.click());
      }
      grid.appendChild(clone);
    });
    stack.appendChild(section);
    return true;
  };
  const homeAnnouncementCandidates = () => {
    const selectors = [
      "[data-activity-kind='website_announcement']",
      "[data-kind='website_announcement']",
      ".announcement-card",
      "[class*='announcement-card']",
      "#page-announcements article",
      "#page-announcements .card",
      "#page-announcements [class*='card']"
    ];
    return Array.from(document.querySelectorAll(selectors.join(","))).filter((el) => {
      if (el.closest("#uwHomepageValueStack")) return false;
      if (el.querySelector("form")) return false;
      const t = homeNorm(el.textContent);
      return t.length > 20 && !t.includes("publish public") && !t.includes("release key / version");
    });
  };
  const homeMountLatestSignal = (stack) => {
    if (!stack || get("uwHomepageLatestSignal")) return !!get("uwHomepageLatestSignal");
    const source = homeAnnouncementCandidates()[0];
    if (!source) return false;
    const section = document.createElement("section");
    section.id = "uwHomepageLatestSignal";
    section.className = "uw-home-value-section";
    section.innerHTML = '<div class="uw-home-value-head"><div><div class="uw-home-value-kicker">Latest signal</div><h2>What’s happening now</h2></div><div class="uw-home-value-note">The newest public update from the network.</div></div>';
    const clone = source.cloneNode(true);
    homeStripIds(clone);
    clone.classList.add("uw-home-latest-card");
    if (!clone.querySelector("a[href]") && typeof source.click === "function") {
      clone.style.cursor = "pointer";
      clone.addEventListener("click", () => source.click());
    }
    section.appendChild(clone);
    stack.appendChild(section);
    return true;
  };
  const homeHideEmptyEvents = () => {
    const sections = Array.from(document.querySelectorAll("section,[role='region']")).filter(homeVisible);
    sections.forEach((section) => {
      const heading = section.querySelector("h1,h2,h3,h4,[role='heading']");
      if (!heading || !/event/.test(homeNorm(heading.textContent))) return;
      const t = homeNorm(section.textContent);
      const empty = /no upcoming events|no events scheduled|nothing scheduled|no events yet|check back.*event/.test(t);
      if (empty) section.classList.add("uw-home-empty-events-hidden");
    });
  };
  const homeFixPartnerImages = () => {
    const partnerSections = Array.from(document.querySelectorAll("section,[role='region']")).filter((section) => {
      const heading = section.querySelector("h1,h2,h3,h4,[role='heading']");
      return heading && /partner/.test(homeNorm(heading.textContent));
    });
    partnerSections.forEach((section) => {
      section.querySelectorAll("img").forEach((img) => {
        const applyFallback = () => {
          if (img.dataset.uwFallbackApplied === "1") return;
          img.dataset.uwFallbackApplied = "1";
          const host = img.parentElement || section;
          img.style.display = "none";
          if (!host.querySelector(".uw-partner-fallback")) {
            const fallback = document.createElement("div");
            fallback.className = "uw-partner-fallback";
            fallback.textContent = "UnderWeb Partner";
            host.appendChild(fallback);
          }
        };
        if (!img.getAttribute("src") || img.getAttribute("src") === "#") applyFallback();
        img.addEventListener("error", applyFallback, { once: true });
        if (img.complete && img.naturalWidth === 0) applyFallback();
      });
    });
  };
  function mountHomepageClarityPass() {
    homeEnsureStyles();
    const hero = homeHero();
    homeClarifyCtas();
    const stack = homeEnsureValueStack(hero);
    homeMountFeaturedCreators(stack);
    homeMountLatestSignal(stack);
    homeHideEmptyEvents();
    homeFixPartnerImages();
  }

  function mountWebsiteForms() {
    mountReleaseForm();
    mountPublicAnnouncementPanel();
    mountHomepageClarityPass();
    let homePolishRuns = 0;
    const homePolishTimer = window.setInterval(() => {
      mountHomepageClarityPass();
      homePolishRuns += 1;
      if (homePolishRuns >= 12) window.clearInterval(homePolishTimer);
    }, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWebsiteForms, { once: true });
  } else {
    mountWebsiteForms();
  }
})();
