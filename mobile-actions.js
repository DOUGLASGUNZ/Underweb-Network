/* Register future mobile floating actions here instead of adding fixed buttons.
   uwMobileActions.register({ id, label, run, visible?, order? }) */
(function () {
  "use strict";

  var trigger = document.getElementById("uwCreateFab");
  if (!trigger) return;
  var mobile = window.matchMedia("(max-width: 1050px)");
  var nav = document.querySelector(".mobilebar");
  var actions = new Map();
  var menu = document.createElement("nav");
  menu.id = "uwMobileActionsMenu";
  menu.setAttribute("aria-label", "Quick actions");
  menu.hidden = true;
  document.body.appendChild(menu);
  trigger.setAttribute("aria-controls", menu.id);
  trigger.setAttribute("aria-expanded", "false");

  var desktopLabel = trigger.getAttribute("aria-label");
  var desktopTitle = trigger.title;

  function syncNavSpace() {
    if (!nav || !mobile.matches) return;
    var height = Math.ceil(window.innerHeight - nav.getBoundingClientRect().top);
    document.documentElement.style.setProperty("--uw-mobile-nav-top", Math.max(62, height) + "px");
  }

  function render() {
    menu.replaceChildren();
    Array.from(actions.values())
      .filter(function (action) { return !action.visible || action.visible(); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .forEach(function (action) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.dataset.mobileAction = action.id;
        button.addEventListener("click", function () {
          setOpen(false);
          action.run();
        });
        menu.appendChild(button);
      });
  }

  function setOpen(open) {
    var next = Boolean(open && mobile.matches);
    if (next) render();
    menu.hidden = !next;
    trigger.setAttribute("aria-expanded", String(next));
  }

  function updateMode() {
    syncNavSpace();
    if (!mobile.matches) setOpen(false);
    trigger.setAttribute("aria-label", mobile.matches ? "Quick Actions" : desktopLabel);
    trigger.title = mobile.matches ? "Quick Actions" : desktopTitle;
  }

  window.uwMobileActions = Object.freeze({
    register: function (action) {
      if (!action || !action.id || !action.label || typeof action.run !== "function") {
        throw new Error("A mobile action needs an id, label and run function");
      }
      actions.set(action.id, action);
      if (!menu.hidden) render();
    },
    unregister: function (id) {
      actions.delete(id);
      if (!menu.hidden) render();
    },
    refresh: render,
    close: function () { setOpen(false); }
  });

  window.uwMobileActions.register({
    id: "help", label: "Help", order: 10,
    run: function () {
      if (typeof showPage === "function") showPage("help");
      setTimeout(function () { window.uwHelpRefresh?.(); }, 40);
    }
  });
  window.uwMobileActions.register({
    id: "guides", label: "Guides", order: 20,
    run: function () { document.getElementById("uwOpenGuides")?.click(); }
  });
  window.uwMobileActions.register({
    id: "darko-vault", label: "Darko Vault", order: 30,
    visible: function () { return Boolean(window.uwVaultGuideAccess?.isOwner()); },
    run: function () {
      if (window.uwVaultGuideAccess?.isOwner()) document.getElementById("uwOpenVault")?.click();
    }
  });

  // Capture before the original + button's direct Help listener, on mobile only.
  document.addEventListener("click", function (event) {
    if (!mobile.matches) return;
    if (event.target.closest("#uwCreateFab")) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(menu.hidden);
    } else if (!event.target.closest("#uwMobileActionsMenu")) {
      setOpen(false);
    }
  }, true);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !menu.hidden) {
      setOpen(false);
      trigger.focus();
    }
  });

  if (typeof uwSupabase !== "undefined" && uwSupabase.auth?.onAuthStateChange) {
    uwSupabase.auth.onAuthStateChange(function () { setTimeout(render, 0); });
  }
  if (window.ResizeObserver && nav) new ResizeObserver(syncNavSpace).observe(nav);
  window.addEventListener("resize", updateMode);
  mobile.addEventListener("change", updateMode);
  updateMode();
})();