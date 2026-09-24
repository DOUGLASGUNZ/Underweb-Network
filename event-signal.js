/* UnderWeb Event Signal: local preview and inert payload only. No network requests. */
(function () {
  "use strict";

  var FIELD_IDS = {
    title: "eventPostTitle", group: "eventPostGroup", startDate: "eventPostDate",
    startTime: "eventPostClock", endDate: "eventPostEndDate",
    endTime: "eventPostEndClock", location: "eventPostLocation",
    description: "eventPostDescription"
  };
  var OPTIONAL = ["host", "partner", "doors", "platform", "genres", "performers", "groupUrl", "eventUrl", "instanceUrl"];
  var BUTTONS = [
    ["VIEW EVENT", "eventUrl"],
    ["VRCHAT GROUP", "groupUrl"],
    ["JOIN INSTANCE", "instanceUrl"]
  ];

  function clean(value, max) {
    return String(value == null ? "" : value).trim().slice(0, max || 1024);
  }
  function present(value) { return clean(value) || "Not set"; }
  function discordSafe(value, max) {
    return clean(value, max).replace(/@/g, "@\u200b").replace(/([\\*_`~|>[\]])/g, "\\$1");
  }
  function publicHttps(value) {
    var raw = clean(value, 2048), url;
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
    try { url = new URL(raw); } catch (_) { return null; }
    var host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
        host.indexOf(":") !== -1 || /^\d+(?:\.\d+){3}$/.test(host) ||
        !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host)) return null;
    return url.href;
  }
  function buttonUrl(key, value) {
    var safe = publicHttps(value);
    if (!safe) return null;
    var url = new URL(safe), host = url.hostname.toLowerCase();
    if (key === "eventUrl") return ["underweb.cloud", "www.underweb.cloud"].includes(host) ? safe : null;
    if (!["vrchat.com", "www.vrchat.com"].includes(host)) return null;
    if (key === "instanceUrl" && (url.pathname !== "/home/launch" ||
        !url.searchParams.get("worldId") || !url.searchParams.get("instanceId"))) return null;
    return safe;
  }
  function localDate(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) return null;
    var result = new Date(date + "T" + time + ":00");
    return !isNaN(result.getTime()) && result.getFullYear() === Number(date.slice(0, 4)) &&
      result.getMonth() + 1 === Number(date.slice(5, 7)) &&
      result.getDate() === Number(date.slice(8, 10)) ? result : null;
  }
  function eventTimes(d) {
    var start = localDate(d.startDate, d.startTime);
    var end = localDate(d.endDate, d.endTime);
    if (!start || !end || end <= start) return { start: start, end: null, valid: false };
    return { start: start, end: end, valid: true };
  }
  function status(times, now) {
    if (!times.valid) return "Not set";
    if (now < times.start) return "Upcoming";
    if (now >= times.end) return "Ended";
    return "Live";
  }
  function formatDate(date) {
    return date ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "Not set";
  }
  function clockLabel(value) {
    var match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
    if (!match) return "Not set";
    var hour = Number(match[1]);
    return (hour % 12 || 12) + ":" + match[2] + " " + (hour < 12 ? "AM" : "PM");
  }
  function parseSchedule(lines, times, now) {
    var previous = times.start, dayOffset = 0;
    var rows = clean(lines, 3000).split(/\r?\n/).map(function (line) {
      var match = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*\|\s*(.{1,120}?)\s*$/.exec(line);
      if (!match) return null;
      var when = null, minutes = Number(match[1]) * 60 + Number(match[2]);
      if (times.start) {
        when = new Date(times.start);
        when.setHours(0, 0, 0, 0);
        when.setDate(when.getDate() + dayOffset);
        when.setMinutes(minutes);
        if (previous && when < previous) {
          dayOffset += 1;
          when.setDate(when.getDate() + 1);
        }
        previous = when;
      }
      return { time: match[1] + ":" + match[2], name: clean(match[3], 120), when: when };
    }).filter(Boolean).slice(0, 20);
    if (status(times, now) === "Live") {
      var currentIndex = -1;
      rows.forEach(function (row, i) { if (row.when && row.when <= now && row.when < times.end) currentIndex = i; });
      if (currentIndex >= 0) rows[currentIndex].marker = "NOW TRANSMITTING";
      var next = rows.find(function (row) { return row.when && row.when > now && row.when < times.end; });
      if (next) next.marker = "UP NEXT";
    } else if (status(times, now) === "Upcoming") {
      var first = rows.find(function (row) { return row.when && row.when >= times.start && row.when < times.end; });
      if (first) first.marker = "UP NEXT";
    }
    return rows;
  }
  function payload(draft) {
    var d = draft || {}, times = eventTimes(d), now = new Date(), rows = parseSchedule(d.performers, times, now);
    var fields = [
      { name: "SIGNAL INFO", value: "Group: " + discordSafe(present(d.group), 80) + "\nHost: " + discordSafe(present(d.host), 150) + "\nPartner: " + discordSafe(present(d.partner), 150), inline: false },
      { name: "TRANSMISSION SCHEDULE", value: ("Start: " + discordSafe(formatDate(times.start)) + "\nEnd: " + discordSafe(formatDate(times.end)) + "\nDoors: " + clockLabel(d.doors) + "\n" + (rows.length ? rows.map(function (r) { return clockLabel(r.time) + " ━━● " + discordSafe(r.name, 120); }).join("\n") : "Performers: Not set")).slice(0, 900), inline: false },
      { name: "ACCESS", value: "Location: " + discordSafe(present(d.location), 240) + "\nPlatform: " + discordSafe(present(d.platform), 80) + "\nGenres: " + discordSafe(present(d.genres), 240), inline: false },
      { name: "CONNECTED THROUGH", value: "Event page: " + discordSafe(buttonUrl("eventUrl", d.eventUrl) || "Not set", 270) + "\nVRChat group: " + discordSafe(buttonUrl("groupUrl", d.groupUrl) || "Not set", 270) + "\nInstance: " + discordSafe(buttonUrl("instanceUrl", d.instanceUrl) || "Not set", 270), inline: false },
      { name: "SIGNAL STATUS", value: status(times, now) + " / Draft preview only", inline: false }
    ];
    var embed = {
      title: "UNDERWEB // EVENT SIGNAL — " + discordSafe(present(d.title), 220),
      description: discordSafe(present(d.description), 1800),
      color: 0x3898ff,
      fields: fields,
      footer: { text: "Preview draft • Submitting an event does not publish this signal." }
    };
    // A local cover file uses a blob: URL for the browser preview. Only a saved
    // public HTTPS cover URL may go into a future Discord embed.
    var coverUrl = publicHttps(d.cover_url || d.coverUrl);
    if (coverUrl) embed.image = { url: coverUrl };
    var buttons = BUTTONS.map(function (item) {
      var url = buttonUrl(item[1], d[item[1]]);
      return { label: item[0], url: url, disabled: !url };
    });
    var activeButtons = buttons.filter(function (button) { return button.url; });
    return {
      embed: embed,
      // Discord link buttons (style 5) are emitted only for valid public URLs.
      components: activeButtons.length ? [{ type: 1, components: activeButtons.map(function (button) {
        return { type: 2, style: 5, label: button.label, url: button.url };
      }) }] : [],
      allowed_mentions: { parse: [] }
    };
  }
  window.UnderwebEventSignal = Object.freeze({ createPayload: payload });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function add(parent, tag, className, text) {
    var node = el(tag, className, text);
    parent.appendChild(node);
    return node;
  }
  function fact(parent, label, value) {
    var box = add(parent, "div", "uwes-fact");
    add(box, "span", "uwes-label", label);
    add(box, "div", "uwes-value" + (value === "Not set" ? " is-missing" : ""), value);
  }
  function section(parent, heading) {
    var block = add(parent, "section", "uwes-section");
    add(block, "h3", "uwes-section-title", heading);
    return block;
  }
  function field(parent, label, key, opts) {
    var wrapper = add(parent, "label", opts && opts.wide ? "uwes-wide" : "");
    add(wrapper, "span", "", label);
    var input = document.createElement(opts && opts.multiline ? "textarea" : "input");
    if (!(opts && opts.multiline)) input.type = opts && opts.type || "text";
    input.id = "uwes-" + key;
    input.name = "eventSignalPreview_" + key;
    input.autocomplete = "off";
    input.placeholder = opts && opts.placeholder || "Optional";
    input.setAttribute("data-testid", "input-signal-" + key);
    if (opts && opts.multiline) input.rows = 3;
    wrapper.appendChild(input);
  }
  function init() {
    var page = document.getElementById("page-eventbuilder");
    if (!page || page.querySelector(".uwes-shell")) return;
    var grid = page.querySelector(".grid2"), editor = page.querySelector(".uw-event-editor");
    if (!grid || !editor) return;
    var coverage = editor.nextElementSibling;
    grid.classList.add("uwes-editor-layout");
    if (coverage) coverage.classList.add("uwes-coverage");

    var options = add(editor, "section", "uwes-options");
    options.setAttribute("aria-label", "Optional Event Signal preview fields");
    add(options, "h4", "", "Signal details");
    add(options, "p", "", "Preview-only draft fields. NOT saved on Submit Event and NOT published to Discord. Keep a separate copy if needed.");
    var optionGrid = add(options, "div", "uwes-option-grid");
    field(optionGrid, "Host", "host");
    field(optionGrid, "Partner", "partner");
    field(optionGrid, "Doors time", "doors", { type: "time" });
    field(optionGrid, "PC / Quest", "platform", { placeholder: "PC, Quest, or both" });
    field(optionGrid, "Genres", "genres", { wide: true, placeholder: "e.g. industrial, ambient" });
    field(optionGrid, "Performers + set times", "performers", { wide: true, multiline: true, placeholder: "22:00 | Performer name\n23:30 | Next performer" });
    field(optionGrid, "VRChat group URL (https)", "groupUrl", { wide: true, type: "url", placeholder: "https://vrchat.com/home/group/..." });
    field(optionGrid, "Event page URL (https)", "eventUrl", { wide: true, type: "url", placeholder: "https://www.underweb.cloud/..." });
    field(optionGrid, "Instance URL (https)", "instanceUrl", { wide: true, type: "url", placeholder: "https://vrchat.com/home/launch?worldId=...&instanceId=..." });
    var submit = document.getElementById("saveEventBtn");
    if (submit) editor.insertBefore(options, submit);

    var preview = el("aside", "uwes-shell");
    preview.setAttribute("aria-label", "Live Event Signal preview");
    preview.setAttribute("data-testid", "panel-event-signal");
    if (coverage) grid.insertBefore(preview, coverage);
    else grid.appendChild(preview);
    var legacyPreview = document.getElementById("previewDiscordBtn");
    var legacyCopy = document.getElementById("copyDiscordBtn");
    if (legacyPreview) legacyPreview.textContent = "Preview saved-fields post";
    if (legacyCopy) legacyCopy.textContent = "Copy saved-fields post";
    var legacyNote = el("small", "uwes-legacy-note", "These existing post tools use saved event fields only; preview-only Signal details are excluded.");
    if (legacyPreview) editor.insertBefore(legacyNote, legacyPreview);
    var overlay = document.getElementById("discordPreviewOverlay");
    if (overlay) {
      var dialog = overlay.querySelector(".uw-dialog");
      if (dialog) dialog.insertBefore(el("p", "uwes-legacy-note", "Existing text post preview: Signal draft-only details are not included or saved."), dialog.querySelector("#discordPreviewText"));
    }

    var posterUrl = null;
    var fileInput = document.getElementById("eventCoverInput");
    function readDraft() {
      var d = {};
      Object.keys(FIELD_IDS).forEach(function (key) { d[key] = document.getElementById(FIELD_IDS[key])?.value || ""; });
      OPTIONAL.forEach(function (key) { d[key] = document.getElementById("uwes-" + key)?.value || ""; });
      d.group = d.group === "symbiotes" ? "Symbiotes" : d.group === "underweb" ? "UnderWeb" : present(d.group);
      return d;
    }
    function render() {
      var d = readDraft(), times = eventTimes(d), now = new Date(), state = status(times, now);
      var rows = parseSchedule(d.performers, times, now);
      preview.replaceChildren();
      add(preview, "div", "uwes-kicker", "UNDERWEB // EVENT SIGNAL");
      var head = add(preview, "header", "uwes-head"), headCopy = add(head, "div");
      add(headCopy, "h2", "", "Event transmission");
      add(headCopy, "p", "", "Local draft preview · not a published Discord post");
      var badge = add(head, "span", "uwes-status");
      badge.dataset.state = state.toLowerCase().replace(" ", "-");
      add(badge, "i", "uwes-dot").setAttribute("aria-hidden", "true");
      add(badge, "span", "", state.toUpperCase());
      var poster = add(preview, "div", "uwes-poster");
      if (posterUrl) {
        var img = add(poster, "img");
        img.alt = "Local cover preview";
        img.src = posterUrl;
        img.onerror = function () { poster.replaceChildren(); posterFallback(poster); };
      } else posterFallback(poster);
      add(poster, "span", "uwes-poster-tag", "LOCAL PREVIEW / NOT UPLOADED");
      add(preview, "div", "uwes-title", present(d.title));
      add(preview, "div", "uwes-group", d.group);
      add(preview, "p", "uwes-description", present(d.description));
      var info = add(section(preview, "SIGNAL INFO"), "div", "uwes-facts");
      fact(info, "HOST", present(d.host));
      fact(info, "PARTNER", present(d.partner));
      var schedule = section(preview, "TRANSMISSION SCHEDULE");
      var scheduleFacts = add(schedule, "div", "uwes-facts");
      fact(scheduleFacts, "START · LOCAL TIME", formatDate(times.start));
      fact(scheduleFacts, "END · LOCAL TIME", formatDate(times.end));
       fact(scheduleFacts, "DOORS · LOCAL TIME", clockLabel(d.doors));
      fact(scheduleFacts, "TIMING", times.valid ? "Event window set" : "Not set");
      var timeline = add(schedule, "div", "uwes-timeline");
      if (!rows.length) add(timeline, "p", "uwes-no-schedule", "Not set · Enter HH:MM | performer name");
      rows.forEach(function (row) {
        var slot = add(timeline, "div", "uwes-slot" + (row.marker === "NOW TRANSMITTING" ? " is-now" : ""));
         add(slot, "span", "uwes-time", clockLabel(row.time));
        var label = add(slot, "div", "uwes-act");
        add(label, "span", "", row.name);
        if (row.marker) add(label, "em", "", row.marker);
      });
      var access = add(section(preview, "ACCESS"), "div", "uwes-facts");
      fact(access, "WORLD / LOCATION", present(d.location));
      fact(access, "PC / QUEST", present(d.platform));
      fact(access, "GENRES", present(d.genres));
      var connected = section(preview, "CONNECTED THROUGH");
      var links = add(connected, "div", "uwes-links");
      fact(links, "EVENT PAGE", buttonUrl("eventUrl", d.eventUrl) ? new URL(buttonUrl("eventUrl", d.eventUrl)).hostname : "Not set");
      fact(links, "VRCHAT GROUP", buttonUrl("groupUrl", d.groupUrl) ? new URL(buttonUrl("groupUrl", d.groupUrl)).hostname : "Not set");
      fact(links, "INSTANCE / JOIN", buttonUrl("instanceUrl", d.instanceUrl) ? new URL(buttonUrl("instanceUrl", d.instanceUrl)).hostname : "Not set");
      var actions = add(connected, "div", "uwes-actions");
      BUTTONS.forEach(function (button) {
        var url = buttonUrl(button[1], d[button[1]]);
        var a = add(actions, "a", "uwes-action", button[0]);
        a.setAttribute("data-testid", "link-signal-" + button[1]);
        if (url) { a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; }
        else { a.setAttribute("aria-disabled", "true"); a.tabIndex = -1; }
      });
      var stateSection = section(preview, "SIGNAL STATUS");
      add(stateSection, "div", "uwes-value", state === "Not set" ? "Not set · Add a valid start and end to determine status." : state + " · Based on the event window in your local time.");
      add(preview, "p", "uwes-footnote", "Signal details and links are preview-only. Submit Event saves the existing event fields for approval; it does not send this preview.");
    }
    function posterFallback(parent) {
      var fallback = add(parent, "div", "uwes-poster-fallback");
      var inner = add(fallback, "div");
      add(inner, "b", "", "UNDERWEB");
      add(inner, "small", "", "SIGNAL / NO POSTER SET");
    }
    function updatePoster() {
      if (posterUrl) URL.revokeObjectURL(posterUrl);
      posterUrl = null;
      var file = fileInput?.files?.[0];
      if (file && /^image\/(jpeg|png|webp)$/.test(file.type)) posterUrl = URL.createObjectURL(file);
      render();
    }
    page.addEventListener("input", function (event) {
      if (event.target.closest(".uw-event-editor")) render();
    });
    page.addEventListener("change", function (event) {
      if (event.target === fileInput) updatePoster();
      else if (event.target.closest(".uw-event-editor")) render();
    });
    var saveStatus = document.getElementById("eventSaveStatus");
    if (saveStatus) new MutationObserver(function () {
      if (/^PENDING APPROVAL/.test(saveStatus.textContent.trim())) {
        OPTIONAL.forEach(function (key) { var input = document.getElementById("uwes-" + key); if (input) input.value = ""; });
        updatePoster();
      }
    }).observe(saveStatus, { childList: true, characterData: true, subtree: true });
    window.setInterval(function () {
      if (!document.hidden && page.classList.contains("active")) render();
    }, 60000);
    window.addEventListener("pagehide", function () { if (posterUrl) URL.revokeObjectURL(posterUrl); }, { once: true });
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();