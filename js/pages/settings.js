/* Settings: language + appearance. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k) => E.t(k);
  function setTheme(v) {
    try { localStorage.setItem("esst.theme", v); } catch (_) {}
    document.documentElement.setAttribute("data-theme", v);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", v === "light" ? "#f7faf3" : "#050605");
  }
  E.setTheme = setTheme;

  /* account + tournament-admin activation (the server decides: wrong password, lockout and "only one super admin" are enforced there) */
  function account() {
    if (!E.session.loggedIn) return el("a", { class: "btn btn-primary", href: "#/login" }, icon("log-in", { size: 20 }), T("nav.login"));
    const u = E.session.user, box = el("section", { class: "card stack" }, el("h2", { text: T("settings.account") }), el("div", { class: "kv" }, el("dt", { text: T("settings.email") }), el("dd", { text: u.email || "" })));
    if (E.session.isSuper) box.appendChild(el("span", { class: "badge" }, icon("shield-check", { size: 20 }), T("admin.is")));
    else {
      const pw = E.forms.field(T("admin.password"), E.forms.password({ autocomplete: "off", name: "admin-password" })), btn = el("button", { type: "submit", class: "btn btn-primary" }, T("admin.activate"));
      box.appendChild(el("details", { class: "card" }, el("summary", {}, T("admin.section"), icon("chevron-down", { size: 20 })), el("form", { class: "stack", style: { marginTop: "10px" }, novalidate: true, on: { submit: async (e) => {
        e.preventDefault(); if (!pw.input.value) return pw.setError(T("admin.wrong")); pw.setError("");
        try { await E.ui.busy(btn, () => E.api.post("/api/activate-admin", { password: pw.input.value })); await E.session.load(); E.ui.toast(T("admin.ok"), "ok"); E.router.render(); }
        catch (err) { pw.setError(err.code === "WRONG_PASSWORD" ? T("admin.wrong") : err.code === "SUPER_ADMIN_EXISTS" ? T("admin.exists") : err.code === "TOO_MANY_ATTEMPTS" ? T("admin.toomany") : E.api.errorText(err)); }
      } } }, el("p", { class: "small muted", text: T("admin.hint") }), pw.el, btn)));
    }
    box.appendChild(el("button", { type: "button", class: "btn btn-danger", on: { click: async () => { await E.api.auth.signOut(); await E.session.load(); E.ui.toast(T("auth.logged_out")); E.router.go("/"); } } }, icon("log-out", { size: 20 }), T("auth.logout")));
    return box;
  }
  E.router.add("/settings", (ctx) => {
    const group = (title, items, pressed, onPick) => el("section", { class: "card stack" }, el("h2", { text: title }),
      el("div", { class: "row wrap", role: "group", "aria-label": title }, items.map(([v, label]) =>
        el("button", { type: "button", class: "chip", "aria-pressed": String(pressed === v), on: { click: () => onPick(v) } }, pressed === v ? icon("check", { size: 20 }) : null, label))));
    const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    ctx.page.appendChild(el("div", { class: "stack", style: { gap: "16px" } },
      el("div", { class: "page-head" }, el("h1", { text: T("settings.title") })),
      group(T("settings.language"), E.i18n.LANGS.map((l) => [l, T("lang." + l)]), E.i18n.lang, (l) => E.i18n.set(l)),
      group(T("settings.theme"), [["dark", T("theme.dark")], ["light", T("theme.light")]], theme, (v) => { setTheme(v); E.router.render(); }),
      account(), el("section", { class: "card stack" }, el("h2", { text: T("settings.about") }), el("p", { class: "muted", text: T("settings.about.text") }))));
  }, { titleKey: "settings.title" });
})(window);
