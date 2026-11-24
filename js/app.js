/* ESST app shell: boot, header, bottom navigation, language sheet, first-run (config.js) screen. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon, iconBtn } = E.u, T = (k, v) => E.t(k, v);
  const root = document.getElementById("root");
  const MARK = '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#050605"/><circle cx="32" cy="32" r="21" fill="none" stroke="#9fd356" stroke-width="3.5"/><path d="M32 21.5l9.6 7-3.7 11.3H26.1l-3.7-11.3z" fill="#9fd356"/><path d="M32 21.5V11M41.6 28.5l9.9-3.2M37.9 39.8l6.1 8.4M26.1 39.8L20 48.2M22.4 28.5l-9.9-3.2" stroke="#9fd356" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';
  const NAV = [["/", "home", "nav.home"], ["/matches", "calendar", "nav.matches"], ["/standings", "list-ordered", "nav.standings"], ["/teams", "users", "nav.teams"], ["/chat", "message-circle", "nav.chat"], ["/profile", "user", "nav.profile"]];
  const BOTTOM = ["/", "/matches", "/standings", "/chat", "/profile"];
  const badges = {};

  function langSheet() {
    const m = E.ui.modal([el("h2", { text: T("settings.language") }), el("div", { class: "stack" }, E.i18n.LANGS.map((l) =>
      el("button", { type: "button", class: "btn btn-block" + (l === E.i18n.lang ? " btn-primary" : ""), on: { click: () => { m.close(); E.i18n.set(l); } } }, T("lang." + l))))], { label: T("settings.language") });
  }
  function langChips() {
    return el("div", { class: "row wrap", style: { justifyContent: "center" }, role: "group" }, E.i18n.LANGS.map((l) =>
      el("button", { type: "button", class: "chip", "aria-pressed": String(l === E.i18n.lang), on: { click: () => E.i18n.set(l) } }, T("lang." + l))));
  }

  /* shown when index.html is opened by double-click and config.js has no Railway address yet */
  function setupScreen() {
    root.replaceChildren(el("main", { class: "main" }, el("div", { class: "setup-screen" },
      el("span", { html: MARK, style: { display: "block", width: "64px", height: "64px" } }),
      el("h1", { text: T("setup.title") }), el("p", { class: "muted", text: T("setup.text") }),
      E.api.baseInvalid ? el("p", { class: "field-error", role: "alert", text: T("setup.invalid") }) : null,
      el("ol", { class: "muted", style: { textAlign: "start", margin: 0, paddingInlineStart: "20px" } }, el("li", { text: T("setup.step1") }), el("li", { text: T("setup.step2") }), el("li", { text: T("setup.step3") })),
      el("div", { class: "code-box" }, 'window.ESST_CONFIG = {\n  API_BASE: "https://your-app.up.railway.app"\n};'),
      el("button", { type: "button", class: "btn btn-primary", on: { click: () => location.reload() } }, icon("refresh-cw", { size: 20 }), T("common.reload")),
      langChips())));
  }

  function link(path, ic, key, cls) {
    const a = el("a", { href: "#" + path, "data-path": path }, icon(ic, { size: 24 }), el("span", { text: T(key) }));
    if (cls) a.className = cls; return a;
  }
  function buildShell() {
    const topLinks = el("nav", { class: "top-links", "aria-label": T("nav.main") }, NAV.map(([p, ic, k]) => link(p, ic, k)));
    topLinks.querySelectorAll(".icon").forEach((n) => { n.setAttribute("width", "20"); n.setAttribute("height", "20"); });
    const header = el("header", { class: "topbar" }, el("div", { class: "topbar-in" },
      el("a", { class: "brand", href: "#/", "aria-label": T("app.name") }, el("span", { html: MARK, style: { display: "contents" } }), el("span", {}, T("app.short"), el("small", { text: T("app.tagline") }))),
      topLinks, el("span", { class: "spacer" }),
      el("a", { class: "icon-btn", href: "#/search", "aria-label": T("nav.search"), title: T("nav.search") }, icon("search")),
      iconBtn("globe", T("settings.language"), langSheet),
      el("a", { class: "icon-btn", href: "#/settings", "aria-label": T("nav.settings"), title: T("nav.settings") }, icon("settings"))));
    syncAdminLink(header);
    const nav = el("nav", { class: "bottom-nav", "aria-label": T("nav.main") }, el("ul", {}, BOTTOM.map((p) => { const [, ic, k] = NAV.find((n) => n[0] === p); return el("li", {}, link(p, ic, k)); })));
    const view = el("div", { class: "view", id: "view" });
    root.replaceChildren(el("div", { class: "app" }, header, el("main", { class: "main", id: "main" }, view), nav));
    markActive(E.router.current.path); Object.keys(badges).forEach((k) => setBadge(k, badges[k]));
    return view;
  }
  /* the shield button only appears for the super admin (the server enforces the permission anyway) */
  function syncAdminLink(header) {
    const bar = (header || document).querySelector(".topbar-in"); if (!bar) return;
    const old = bar.querySelector("[data-admin]"); if (old) old.remove();
    if (!E.session.isSuper) return;
    const a = el("a", { class: "icon-btn", href: "#/admin", "data-admin": "1", "aria-label": T("admin.title"), title: T("admin.title") }, icon("shield-check")); bar.insertBefore(a, bar.querySelector('a[href="#/search"]'));
  }
  function markActive(path) {
    document.querySelectorAll("[data-path]").forEach((a) => {
      const p = a.getAttribute("data-path"), on = p === "/" ? path === "/" : path === p || path.startsWith(p + "/");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  function setBadge(name, n) {                         // e.g. setBadge("/chat", 3)
    badges[name] = n;
    document.querySelectorAll('[data-path="' + name + '"]').forEach((a) => {
      const old = a.querySelector(".nav-badge"); if (old) old.remove();
      if (n > 0) a.appendChild(el("span", { class: "nav-badge", role: "img", "aria-label": T("chat.unread_n", { n }) }, n > 99 ? "99+" : String(n)));      // bottom bar (phones) and top links (desktop)
    });
  }
  E.app = { setBadge };

  let started = false;
  function boot() {
    E.i18n.init();
    if (E.api.needsConfig || E.api.baseInvalid) { setupScreen(); E.bus.on("lang", setupScreen); return; }
    buildShell();
    document.getElementById("view").appendChild(E.ui.spinner());
    // a logged-in visitor's profile (role, team) is loaded BEFORE the first page is drawn, so role-based buttons are right from the start
    const ready = E.api.auth.hasSession() ? Promise.race([E.session.load(), E.u.sleep(4000)]) : (E.session.load(), Promise.resolve());
    ready.then(() => { buildShell(); started = true; E.router.start(); });
    E.bus.on("lang", () => { buildShell(); E.router.render(); });
    E.bus.on("route", (r) => markActive(r.path));
    let shownFor = E.api.auth.user() ? E.api.auth.user().id : null;
    E.bus.on("profile", () => {                                   // another person logged in / out: the page on screen must not keep the old person's buttons
      syncAdminLink(); const now = E.api.auth.user() ? E.api.auth.user().id : null;
      if (started && now !== shownFor) { shownFor = now; E.router.render(); } else shownFor = now;
    });
  }
  boot();
})(window);
