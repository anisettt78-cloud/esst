/* Log in + create account. Registration asks for the FULL birth date (day / month / year). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, F = E.forms, V = E.validate, T = (k, v) => E.t(k, v);
  const POS = ["goalkeeper", "defender", "midfielder", "forward"], FOOT = ["right", "left", "both"];
  const safeNext = (n) => (typeof n === "string" && /^\/[A-Za-z0-9_\-/]*(\?[A-Za-z0-9_\-=&%]*)?$/.test(n) && !n.startsWith("//") ? n : "/");
  const already = () => { if (E.api.auth.hasSession()) { E.router.go("/profile", { replace: true }); return true; } return false; };

  function submitButton(label) { return el("button", { type: "submit", class: "btn btn-primary btn-block" }, label); }

  E.router.add("/login", (ctx) => {
    if (already()) return;
    const email = F.field(T("auth.email"), F.input({ type: "email", name: "email", autocomplete: "email", inputmode: "email", autocapitalize: "off", spellcheck: "false", required: true }));
    const pw = F.field(T("auth.password"), F.password({ name: "password", autocomplete: "current-password" }));
    const top = el("div", { class: "form-error", role: "alert", hidden: true }), btn = submitButton(T("auth.login.cta"));
    const form = el("form", { novalidate: true, on: { submit: async (e) => {
      e.preventDefault(); top.hidden = true;
      const ok1 = email.setError(V.validEmail(email.input.value) ? "" : T("auth.err.email")), ok2 = pw.setError(pw.input.value ? "" : T("auth.err.password"));
      if (!ok1) return email.input.focus(); if (!ok2) return pw.input.focus();
      try {
        await E.ui.busy(btn, () => E.api.auth.signIn(email.input.value.trim(), pw.input.value));
        await E.session.load();
        E.ui.toast(T("auth.welcome", { name: E.u.nameOf(E.session.profile) || "" }), "ok");
        E.router.go(safeNext(ctx.query.next), { replace: true });
      } catch (err) {
        if (err.code === "invalid_credentials") { top.textContent = T("auth.err.invalid"); top.hidden = false; } else E.ui.toastError(err);
      }
    } } }, email.el, pw.el, top, btn);
    ctx.page.appendChild(el("div", { class: "auth-card" }, el("div", { class: "stack", style: { gap: "6px" } }, el("h1", { text: T("auth.login.title") }), el("p", { class: "muted", text: T("auth.login.sub") })),
      el("div", { class: "card" }, form), el("a", { class: "btn btn-ghost btn-block", href: "#/register" + (ctx.query.next ? "?next=" + encodeURIComponent(ctx.query.next) : "") }, T("auth.to_register"))));
  }, { titleKey: "auth.login.title" });

  E.router.add("/register", (ctx) => {
    if (already()) return;
    const name = F.field(T("profile.full_name"), F.input({ name: "name", autocomplete: "name", maxlength: "80", required: true }));
    const nick = F.field(T("profile.nickname"), F.input({ name: "nickname", autocomplete: "nickname", maxlength: "30" }), { optional: true });
    const bd = F.birthDate(null);
    const pos = F.segmented(POS.map((p) => [p, T("pos." + p)]), null, () => posF.setError(""), T("profile.pos.main"));
    const foot = F.segmented(FOOT.map((f) => [f, T("foot." + f)]), null, () => footF.setError(""), T("profile.foot"));
    const posF = F.field(T("profile.pos.main"), pos.el), footF = F.field(T("profile.foot"), foot.el);
    const email = F.field(T("auth.email"), F.input({ type: "email", name: "email", autocomplete: "email", inputmode: "email", autocapitalize: "off", spellcheck: "false", required: true }));
    const pw = F.field(T("auth.password"), F.password({ name: "new-password", autocomplete: "new-password" }), { hint: T("auth.password.hint") });
    const top = el("div", { class: "form-error", role: "alert", hidden: true }), btn = submitButton(T("auth.register.cta"));
    const form = el("form", { novalidate: true, on: { submit: async (e) => {
      e.preventDefault(); top.hidden = true;
      const checks = [[name, name.input.value.trim().length >= 2, "auth.err.fullname"], [email, V.validEmail(email.input.value), "auth.err.email"], [pw, V.validPassword(pw.input.value), "auth.err.password"]];
      let first = null;
      for (const [f, ok, key] of checks) { f.setError(ok ? "" : T(key)); if (!ok && !first) first = f.input; }
      const bdOk = bd.validate(); if (!bdOk && !first) first = true;
      const posOk = !!pos.value, footOk = !!foot.value; posF.setError(posOk ? "" : T("auth.err.position")); footF.setError(footOk ? "" : T("auth.err.foot"));
      if (first && first !== true) first.focus(); if (first || !bdOk || !posOk || !footOk) return;
      try {
        await E.ui.busy(btn, () => E.api.auth.signUp(email.input.value.trim(), pw.input.value, { full_name: name.input.value.trim(), nickname: nick.input.value.trim() || undefined, birth_date: bd.iso(), main_position: pos.value, preferred_foot: foot.value }));
        await E.session.load();
        E.ui.toast(T("auth.welcome", { name: name.input.value.trim() }), "ok");
        E.router.go(safeNext(ctx.query.next) !== "/" ? safeNext(ctx.query.next) : "/profile", { replace: true });
      } catch (err) {
        if (err.code === "user_already_exists") email.setError(T("auth.err.exists")); else if (err.code === "weak_password") pw.setError(T("auth.err.password")); else if (err.code === "validation_failed") email.setError(T("auth.err.email")); else E.ui.toastError(err);
      }
    } } }, el("h2", { text: T("auth.email") }), email.el, pw.el, el("div", { class: "sep" }), el("h2", { text: T("nav.profile") }), name.el, nick.el, bd.el, posF.el, footF.el, top, btn);
    ctx.page.appendChild(el("div", { class: "auth-card" }, el("div", { class: "stack", style: { gap: "6px" } }, el("h1", { text: T("auth.register.title") }), el("p", { class: "muted", text: T("auth.register.sub") })),
      el("div", { class: "card" }, form), el("a", { class: "btn btn-ghost btn-block", href: "#/login" + (ctx.query.next ? "?next=" + encodeURIComponent(ctx.query.next) : "") }, T("auth.to_login"))));
  }, { titleKey: "auth.register.title" });
})(window);
