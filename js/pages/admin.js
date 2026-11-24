/* Super-admin area: tournament settings, team management (create / edit / captain / players / archive / delete), transfer approvals, handover.
   Buttons here are only hidden for other people - the SERVER refuses every one of these actions unless the caller is the super admin. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, F = E.forms, T = (k, v) => E.t(k, v), A = { auth: true, super: true };
  const back = (title, to) => el("div", { class: "page-head" }, E.u.iconBtn("arrow-left", T("common.back"), () => E.router.back(to || "/admin"), { class: "icon-flip" }), el("h1", { text: title }));
  const wrap = (...kids) => el("div", { class: "stack", style: { gap: "16px" } }, kids);
  const isDup = (e) => e.status === 409 || e.code === "DUPLICATE_TEAM" || e.code === "23505";

  /* ---- hub ---- */
  E.router.add("/admin", async (ctx) => {
    const tile = (href, ic, key) => el("a", { class: "card card-press row", href: "#" + href }, el("span", { class: "avatar md sq" }, icon(ic, { size: 24 })), el("strong", { class: "grow", style: { flex: 1 }, text: T(key) }), icon("chevron-right", { class: "icon-flip" }));
    const tr = el("section", { class: "stack" }, el("h2", { text: T("admin.transfers") }), E.ui.skeletonRows(1, 64));
    ctx.page.appendChild(wrap(el("div", { class: "page-head" }, el("h1", { text: T("admin.title") })), el("p", { class: "muted", text: T("admin.hub.text") }),
      el("div", { class: "grid grid-2" }, tile("/admin/league", "trophy", "league.title"), tile("/admin/settings", "settings", "admin.settings"), tile("/admin/teams", "users", "admin.teams"), tile("/admin/handover", "shield-check", "admin.handover")), E.admin.hubSlot = el("div", { class: "stack" }), tr));
    try {
      const rows = await E.api.rpc("admin_pending_transfers"); if (!ctx.isCurrent()) return;
      const act = async (r, ok) => { try { await E.api.rpc("finalize_transfer", { p_request_id: r.id, p_approve: ok }); E.router.render(); } catch (e) { E.ui.toastError(e); } };
      tr.replaceChildren(el("h2", { text: T("admin.transfers") }), rows.length ? el("div", { class: "card list" }, rows.map((r) => el("div", { class: "list-row", style: { flexWrap: "wrap" } }, E.ui.avatar(r.player, "md"),
        el("div", { class: "grow" }, el("div", { style: { fontWeight: "700" }, text: E.u.nameOf(r.player) }), el("div", { class: "small muted", text: (r.from_team ? r.from_team.name : "") + " → " + (r.to_team ? r.to_team.name : "") }),
          el("span", { class: "badge " + (r.status === "captain_approved" ? "" : "badge-muted"), text: r.status === "captain_approved" ? T("admin.transfer.captain_ok") : T("admin.transfer.waiting_captain") })),
        el("div", { class: "row" }, el("button", { type: "button", class: "btn btn-primary btn-sm", on: { click: () => act(r, true) } }, T("admin.transfer.approve")), el("button", { type: "button", class: "btn btn-sm", on: { click: () => act(r, false) } }, T("admin.transfer.reject")))))) : el("p", { class: "muted", text: T("admin.transfer.empty") }));
    } catch (e) { if (ctx.isCurrent()) tr.replaceChildren(E.ui.errorState(e)); }
  }, Object.assign({ titleKey: "admin.title" }, A));
  E.admin = {};

  /* ---- tournament settings ---- */
  E.router.add("/admin/settings", async (ctx) => {
    ctx.page.appendChild(E.ui.skeletonRows(3, 90));
    let s; try { s = await E.api.from("tournament_settings").select("*").eq("id", 1).single(); } catch (e) { ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return;
    const name = F.field(T("admin.settings.name"), F.input({ maxlength: "80", value: s.tournament_name || "" })), season = F.field(T("admin.settings.season"), F.input({ maxlength: "30", value: s.season_label || "" }));
    const pt = (k, v) => F.field(T(k), F.input({ type: "text", inputmode: "numeric", value: String(v) })), win = pt("admin.points.win", s.points_for_win), draw = pt("admin.points.draw", s.points_for_draw), loss = pt("admin.points.loss", s.points_for_loss);
    const rules = F.field(T("admin.settings.rules"), el("textarea", { class: "textarea", rows: "6", maxlength: "4000" }, s.rules_text || ""), { optional: true });
    const btn = el("button", { type: "submit", class: "btn btn-primary btn-block" }, T("common.save"));
    const okPts = (f) => /^\d{1,2}$/.test(f.input.value.trim()) && +f.input.value.trim() <= 10;
    ctx.page.replaceChildren(wrap(back(T("admin.settings")), el("form", { class: "card stack", novalidate: true, on: { submit: async (e) => {
      e.preventDefault(); const n = name.input.value.trim(); let bad = false;
      bad = !name.setError(n.length >= 2 ? "" : T("admin.err.name")) || bad; for (const f of [win, draw, loss]) bad = !f.setError(okPts(f) ? "" : T("admin.err.points")) || bad; if (bad) return;
      try { await E.ui.busy(btn, () => E.api.from("tournament_settings").update({ tournament_name: n, season_label: season.input.value.trim() || s.season_label, points_for_win: +win.input.value, points_for_draw: +draw.input.value, points_for_loss: +loss.input.value, rules_text: rules.input.value.trim() || null, updated_at: new Date().toISOString() }).eq("id", 1)); E.ui.toast(T("admin.settings.saved"), "ok"); } catch (err) { E.ui.toastError(err); }
    } } }, name.el, season.el, el("h2", { text: T("admin.settings.points") }), el("div", { class: "grid", style: { gridTemplateColumns: "repeat(3, 1fr)" } }, win.el, draw.el, loss.el), rules.el, btn)));
  }, Object.assign({ titleKey: "admin.settings" }, A));

  /* ---- team list ---- */
  E.router.add("/admin/teams", async (ctx) => {
    ctx.page.appendChild(E.ui.skeletonRows(3, 70));
    let rows; try { rows = await E.api.rpc("teams_overview"); } catch (e) { ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return;
    ctx.page.replaceChildren(wrap(el("div", { class: "page-head" }, E.u.iconBtn("arrow-left", T("common.back"), () => E.router.back("/admin"), { class: "icon-flip" }), el("h1", { text: T("admin.teams") }), el("a", { class: "btn btn-primary btn-sm", href: "#/admin/team/new" }, icon("plus", { size: 20 }), T("admin.team.new"))),
      rows.length ? el("div", { class: "card list", style: { padding: "4px 12px" } }, rows.map((t) => el("a", { class: "list-row", href: "#/admin/team/" + t.team_id }, E.ui.avatar({ logo_url: t.logo_url, full_name: t.name }, "md", { square: true }),
        el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" }, text: t.name }), el("div", { class: "small muted", text: t.short_name + " · " + t.players + (t.captain ? " · " + E.u.nameOf(t.captain) : "") })), t.archived ? el("span", { class: "badge badge-muted", text: T("team.archived") }) : icon("pencil", { size: 20 })))) :
        E.ui.empty("users", T("teams.empty.title"), T("teams.empty.text"), el("a", { class: "btn btn-primary", href: "#/admin/team/new" }, T("teams.empty.admin")))));
  }, Object.assign({ titleKey: "admin.teams" }, A));

  /* ---- create / edit team ---- */
  async function teamForm(ctx, id) {
    let team = null, roster = [];
    if (id) {
      ctx.page.appendChild(E.ui.skeletonRows(3, 110));
      try { const [ov, r] = await Promise.all([E.api.rpc("teams_overview"), E.api.rpc("team_roster", { p_team: id })]); team = ov.find((x) => x.team_id === id); roster = r; } catch (e) { ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
      if (!ctx.isCurrent()) return; ctx.page.replaceChildren();
      if (!team) { ctx.page.appendChild(E.ui.empty("users", T("err.team_not_found"))); return; }
    }
    let logo = team ? team.logo_url : null, captain = team && team.captain ? team.captain : null, logoHost = el("span");
    const paintLogo = () => { const n = E.ui.avatar({ logo_url: logo, full_name: name.input.value || "?" }, "lg", { square: true }); logoHost.replaceWith(n); logoHost = n; };
    const name = F.field(T("admin.team.name"), F.input({ maxlength: "60", value: team ? team.name : "" })), short = F.field(T("admin.team.short"), F.input({ maxlength: "6", autocapitalize: "characters", value: team ? team.short_name : "", style: { textTransform: "uppercase" } }));
    const c1 = el("input", { type: "color", value: team ? team.color_primary : "#9fd356", "aria-label": T("admin.team.color1"), style: { width: "100%", height: "48px", border: "1px solid var(--line-strong)", borderRadius: "12px", background: "var(--bg-2)", padding: "4px" } });
    const c2 = el("input", { type: "color", value: team ? team.color_secondary : "#0b0d0a", "aria-label": T("admin.team.color2"), style: { width: "100%", height: "48px", border: "1px solid var(--line-strong)", borderRadius: "12px", background: "var(--bg-2)", padding: "4px" } });
    const desc = F.field(T("admin.team.desc"), el("textarea", { class: "textarea", rows: "3", maxlength: "300" }, team && team.description || ""), { optional: true });
    logoHost = E.ui.avatar({ logo_url: logo, full_name: team ? team.name : "?" }, "lg", { square: true });
    const logoBtn = el("button", { type: "button", class: "btn", on: { click: async () => {
      const blob = await E.media.pickAndCrop({ size: 512, round: false, title: T("admin.team.logo") }); if (!blob) return;
      try { const r = await E.ui.busy(logoBtn, () => E.api.upload("logo", blob)); logo = r.url; paintLogo(); } catch (e) { E.ui.toastError(e); }
    } } }, icon("image", { size: 20 }), T("admin.team.logo.change"));
    const capLabel = el("div", { style: { fontWeight: "700", flex: 1 } }), paintCap = () => { capLabel.textContent = captain ? E.u.nameOf(captain) : T("admin.team.captain.none"); };
    paintCap();
    const capBtn = el("button", { type: "button", class: "btn", on: { click: async () => {
      const p = await E.pickers.player({ title: T("admin.team.captain") }); if (!p) return;
      const person = { id: p.player_id, full_name: p.full_name, nickname: p.nickname, display_name: p.display_name };
      if (!id) { captain = person; return paintCap(); }
      try { await E.api.rpc("admin_set_captain", { p_team: id, p_player: p.player_id }); E.ui.toast(T("admin.captain.set"), "ok"); E.router.render(); } catch (e) { E.ui.toastError(e); }
    } } }, icon("crown", { size: 20 }), T("admin.team.captain.change"));
    const btn = el("button", { type: "submit", class: "btn btn-primary btn-block" }, T("common.save"));
    const form = el("form", { class: "card stack", novalidate: true, on: { submit: async (e) => {
      e.preventDefault(); const n = name.input.value.trim(), sh = short.input.value.trim().toUpperCase(); let bad = false;
      bad = !name.setError(n.length >= 2 && n.length <= 60 ? "" : T("admin.err.team_name")) || bad; bad = !short.setError(sh.length >= 2 && sh.length <= 6 ? "" : T("admin.err.team_short")) || bad; if (bad) return;
      try {
        if (id) { await E.ui.busy(btn, () => E.api.from("teams").update({ name: n, short_name: sh, logo_url: logo, color_primary: c1.value, color_secondary: c2.value, description: desc.input.value.trim() || null }).eq("id", id)); E.ui.toast(T("admin.team.saved"), "ok"); }
        else { const t = await E.ui.busy(btn, () => E.api.rpc("admin_create_team", { p_name: n, p_short: sh, p_logo_url: logo, p_color_primary: c1.value, p_color_secondary: c2.value, p_description: desc.input.value.trim() || null, p_captain: captain ? captain.id : null })); E.ui.toast(T("admin.team.created"), "ok"); E.router.go("/admin/team/" + t.id, { replace: true }); }
      } catch (err) { if (isDup(err)) name.setError(T("admin.err.dup")); else E.ui.toastError(err); }
    } } }, el("div", { class: "row", style: { gap: "14px" } }, logoHost, logoBtn), name.el, short.el, el("div", { class: "field" }, el("label", { text: T("admin.team.colors") }), el("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" } }, c1, c2)), desc.el,
      el("div", { class: "field" }, el("label", { text: T("admin.team.captain") }), el("div", { class: "row" }, capLabel, capBtn)), btn);
    const kids = [back(id ? T("admin.team.edit") : T("admin.team.new"), "/admin/teams"), form];
    if (id) {
      const act = async (fn, msg) => { try { await fn(); E.ui.toast(msg, "ok"); E.router.render(); } catch (e) { E.ui.toastError(e); } };
      kids.push(el("section", { class: "card stack" }, el("div", { class: "row" }, el("h2", { style: { flex: 1 }, text: T("admin.team.players") }), el("button", { type: "button", class: "btn btn-sm btn-primary", on: { click: async () => {
        const p = await E.pickers.player({ title: T("admin.team.add_player"), filter: (r) => !r.team_id }); if (p) act(() => E.api.rpc("admin_add_player", { p_team: id, p_player: p.player_id }), T("admin.player.added")); } } }, icon("user-plus", { size: 20 }), T("admin.team.add_player"))),
        roster.length ? el("div", { class: "list" }, roster.map((p) => el("div", { class: "list-row" }, E.ui.avatar(p, "md"), el("a", { class: "grow ellipsis tap-link", href: "#/player/" + p.player_id }, E.u.nameOf(p), p.role_in_team === "captain" ? icon("crown", { size: 20, class: "inl" }) : null),
          p.role_in_team !== "captain" ? E.u.iconBtn("crown", T("admin.team.captain.change") + ": " + E.u.nameOf(p), () => act(() => E.api.rpc("admin_set_captain", { p_team: id, p_player: p.player_id }), T("admin.captain.set"))) : null,
          E.u.iconBtn("trash-2", T("admin.team.remove") + ": " + E.u.nameOf(p), async () => { if (await E.ui.confirm({ title: T("admin.team.remove.confirm", { name: E.u.nameOf(p) }), danger: true, confirmLabel: T("admin.team.remove") })) act(() => E.api.rpc("admin_remove_player", { p_team: id, p_player: p.player_id }), T("admin.player.removed")); })))) : E.ui.empty("users", T("team.roster.empty.title"), T("team.roster.empty.text"))));
      kids.push(el("section", { class: "card stack" },
        el("button", { type: "button", class: "btn", on: { click: async () => { if (team.archived || await E.ui.confirm({ title: T("admin.team.archive.confirm", { team: team.name }), confirmLabel: T("admin.team.archive") })) act(() => E.api.from("teams").update({ archived: !team.archived }).eq("id", id), team.archived ? T("admin.team.restored") : T("admin.team.archived")); } } }, icon("square", { size: 20 }), team.archived ? T("admin.team.unarchive") : T("admin.team.archive")),
        el("button", { type: "button", class: "btn btn-danger", on: { click: async () => {
          if (!(await E.ui.confirm({ title: T("admin.team.delete.confirm", { team: team.name }), danger: true, confirmLabel: T("admin.team.delete") }))) return;
          try { await E.api.from("teams").delete().eq("id", id); E.ui.toast(T("admin.team.deleted"), "ok"); E.router.go("/admin/teams", { replace: true }); } catch (e) { E.ui.toast(e.status === 409 ? T("admin.team.delete.blocked") : E.api.errorText(e), "err"); } } } }, icon("trash-2", { size: 20 }), T("admin.team.delete"))));
    }
    ctx.page.appendChild(wrap(kids));
  }
  E.router.add("/admin/team/new", (ctx) => teamForm(ctx, null), Object.assign({ titleKey: "admin.team.new" }, A));
  E.router.add("/admin/team/:id", (ctx) => teamForm(ctx, ctx.params.id), Object.assign({ titleKey: "admin.team.edit" }, A));

  /* ---- hand the role to another account ---- */
  E.router.add("/admin/handover", (ctx) => {
    let picked = null; const who = el("div", { style: { fontWeight: "700", flex: 1 }, text: "–" });
    const go = el("button", { type: "button", class: "btn btn-danger", disabled: true, on: { click: async () => {
      if (!(await E.ui.confirm({ title: T("admin.handover"), text: T("admin.handover.text"), danger: true, typeToConfirm: "HANDOVER", typeLabel: T("admin.handover.confirm"), confirmLabel: T("admin.handover") }))) return;
      try { await E.api.rpc("transfer_super_admin", { p_new: picked.player_id }); await E.session.load(); E.ui.toast(T("admin.handover.done"), "ok"); E.router.go("/", { replace: true }); } catch (e) { E.ui.toastError(e); } } } }, icon("shield-check", { size: 20 }), T("admin.handover"));
    ctx.page.appendChild(wrap(back(T("admin.handover")), el("section", { class: "card stack" }, el("p", { class: "muted", text: T("admin.handover.text") }), el("div", { class: "row" }, who,
      el("button", { type: "button", class: "btn", on: { click: async () => { const p = await E.pickers.player({ title: T("admin.handover.choose"), filter: (r) => r.player_id !== (E.api.auth.user() || {}).id }); if (p) { picked = p; who.textContent = E.u.nameOf(p); go.disabled = false; } } } }, icon("search", { size: 20 }), T("picker.title"))), go)));
  }, Object.assign({ titleKey: "admin.handover" }, A));
})(window);
