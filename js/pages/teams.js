/* Teams list, team page (squad, join / transfer / leave, captain request inbox, team chat). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k, v) => E.t(k, v), S = E.session;
  const posShort = (p) => (p ? T("pos.short." + p) : "");
  const count = (n) => (n === 1 ? T("team.player_one") : T("team.players", { n: E.i18n.number(n) }));
  const tint = (c) => ({ borderInlineStart: "4px solid " + (c || "var(--accent)") });
  const teamAvatar = (t, size) => E.ui.avatar({ logo_url: t.logo_url, full_name: t.name }, size, { square: true });

  E.router.add("/teams", async (ctx) => {
    ctx.page.append(el("div", { class: "page-head" }, el("h1", { text: T("teams.title") })), E.ui.skeletonRows(4, 84));
    let rows; try { rows = await E.api.rpc("teams_overview"); } catch (e) { if (ctx.isCurrent()) ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return;
    const head = el("div", { class: "page-head" }, el("h1", { text: T("teams.title") }), S.isSuper ? el("a", { class: "btn btn-primary btn-sm", href: "#/admin/team/new" }, icon("plus", { size: 20 }), T("admin.team.new")) : null);
    ctx.page.replaceChildren(head, rows.length ? el("div", { class: "grid grid-2" }, rows.map((t) => el("a", { class: "card card-press row", href: "#/team/" + t.team_id, style: tint(t.color_primary) },
      teamAvatar(t, "md"), el("div", { class: "grow", style: { flex: 1, minWidth: 0 } }, el("div", { class: "ellipsis", style: { fontWeight: "750" }, text: t.name }),
        el("div", { class: "small muted ellipsis" }, count(t.players), t.captain ? " · " : "", t.captain ? el("span", {}, icon("crown", { size: 20, class: "inl" }), " ", E.u.nameOf(t.captain)) : ""),
        t.archived ? el("span", { class: "badge badge-muted", text: T("team.archived") }) : null), el("span", { class: "badge", text: t.short_name })))) :
      E.ui.empty("users", T("teams.empty.title"), T("teams.empty.text"), S.isSuper ? el("a", { class: "btn btn-primary", href: "#/admin/team/new" }, T("teams.empty.admin")) : null));
  }, { titleKey: "teams.title" });

  E.router.add("/team/:id", async (ctx) => {
    const id = ctx.params.id; ctx.page.appendChild(E.ui.skeletonRows(3, 110));
    const logged = E.api.auth.hasSession(), canReview = S.isCaptainOf(id) || S.isSuper;
    let ov, roster, mine, reqs;
    try {
      [ov, roster, mine, reqs] = await Promise.all([E.api.rpc("teams_overview"), E.api.rpc("team_roster", { p_team: id }), logged ? E.api.rpc("my_requests") : null, canReview ? E.api.rpc("team_requests", { p_team: id }) : null]);
    } catch (e) { if (ctx.isCurrent()) ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return;
    const t = ov.find((x) => x.team_id === id);
    ctx.page.replaceChildren();
    if (!t) { ctx.page.appendChild(E.ui.empty("users", T("err.team_not_found"), null, el("a", { class: "btn", href: "#/teams" }, T("teams.title")))); return; }
    document.title = t.name + " · " + T("app.name");
    const reload = () => E.router.render(), run = async (fn, okMsg) => { try { await fn(); if (okMsg) E.ui.toast(okMsg, "ok"); reload(); } catch (e) { E.ui.toastError(e); } };
    const mem = S.membership, mine_join = mine && mine.join.find((r) => r.team_id === id), mine_tr = mine && mine.transfers.find((r) => r.to_team_id === id);
    const actions = el("div", { class: "hero-actions" });
    if (S.teamId === id || S.isSuper) {
      actions.appendChild(el("button", { type: "button", class: "btn btn-primary", on: { click: async () => { try { const r = await E.api.get("/api/chat/team/" + id); E.router.go("/chat/" + r.id); } catch (e) { E.ui.toastError(e); } } } }, icon("message-circle", { size: 20 }), T("team.chat")));
      if (S.isSuper) actions.appendChild(el("a", { class: "btn", href: "#/admin/team/" + id }, icon("settings", { size: 20 }), T("team.manage")));
      if (S.teamId === id && !S.isCaptainOf(id)) actions.appendChild(el("button", { type: "button", class: "btn btn-danger", on: { click: async () => { if (await E.ui.confirm({ title: T("team.leave.confirm", { team: t.name }), danger: true, confirmLabel: T("team.leave") })) run(async () => { await E.api.rpc("leave_team"); await S.load(); }, T("team.left")); } } }, icon("log-out", { size: 20 }), T("team.leave")));
    } else if (!logged) actions.appendChild(el("a", { class: "btn btn-primary", href: "#/login?next=" + encodeURIComponent("/team/" + id) }, icon("log-in", { size: 20 }), T("team.join")));
    else if (!S.teamId) {
      if (mine_join) actions.append(el("span", { class: "badge" }, T("team.join.pending")), el("button", { type: "button", class: "btn", on: { click: () => run(() => E.api.rpc("cancel_join_request", { p_request: mine_join.id })) } }, T("team.join.cancel")));
      else actions.appendChild(el("button", { type: "button", class: "btn btn-primary", on: { click: () => requestSheet("join", t, run) } }, icon("user-plus", { size: 20 }), T("team.join")));
    } else if (mine_tr) actions.appendChild(el("span", { class: "badge" }, T("team.transfer.pending")));
    else if (!S.isCaptainOf(S.teamId)) actions.appendChild(el("button", { type: "button", class: "btn", on: { click: () => requestSheet("transfer", t, run) } }, icon("arrow-left-right", { size: 20 }), T("team.transfer")));

    actions.append(el("button", { type: "button", class: "btn", on: { click: () => E.share.share(t.name, "/team/" + id) } }, icon("share-2", { size: 20 }), T("profile.share")),
      el("button", { type: "button", class: "btn", on: { click: () => E.chat.shareSheet({ type: "team", id }) } }, icon("send", { size: 20 }), T("chat.share.btn")));
    const hero = el("section", { class: "player-hero", style: { borderTop: "4px solid " + (t.color_primary || "var(--accent)") } }, teamAvatar(t, "lg"), el("h1", { class: "player-name", text: t.name }),
      el("div", { class: "row wrap", style: { justifyContent: "center" } }, el("span", { class: "badge", text: t.short_name }), el("span", { class: "badge badge-muted", text: count(t.players) }), t.archived ? el("span", { class: "badge badge-danger", text: T("team.archived") }) : null,
        S.teamId === id ? el("span", { class: "badge" }, T("team.yours")) : null),
      t.description ? el("p", { class: "muted", text: t.description }) : null,
      el("div", { class: "muted small" }, icon("crown", { size: 20, class: "inl" }), " ", T("team.captain") + ": ", t.captain ? el("a", { class: "tap-link", href: "#/player/" + t.captain.id, text: E.u.nameOf(t.captain) }) : T("team.no_captain")), actions);

    const requests = reqs ? el("section", { class: "card stack" }, el("h2", { text: T("team.requests") }), (reqs.join.length + reqs.transfers.length) ? el("div", { class: "list" }, [
      ...reqs.join.map((r) => reqRow(r, T("team.join_request"), r.message, (acc) => run(() => E.api.rpc("decide_join_request", { p_request_id: r.id, p_accept: acc }), T("team.decided")))),
      ...reqs.transfers.map((r) => reqRow(r, T("team.transfer_request", { team: r.from_team ? r.from_team.name : "" }), r.reason, (acc) => run(() => E.api.rpc("captain_approve_transfer", { p_request_id: r.id, p_accept: acc }), T("team.decided"))))]) : el("p", { class: "muted", text: T("team.requests.empty") })) : null;

    const squad = el("section", { class: "stack" }, el("h2", { text: T("team.roster") }), roster.length ? el("div", { class: "card list", style: { padding: "4px 12px" } }, roster.map((p) =>
      el("a", { class: "list-row", href: "#/player/" + p.player_id }, E.ui.avatar(p, "md"), el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" } }, E.u.nameOf(p), p.role_in_team === "captain" ? icon("crown", { size: 20, class: "inl" }) : null),
        el("div", { class: "small muted", text: (p.nickname ? "“" + p.nickname + "” · " : "") + posShort(p.main_position) + (p.jersey_number ? " · #" + p.jersey_number : "") })), el("span", { class: "badge", text: String(p.ovr) })))) :
      E.ui.empty("users", T("team.roster.empty.title"), T("team.roster.empty.text")));
    ctx.page.appendChild(el("div", { class: "stack", style: { gap: "16px" } }, hero, requests, el("div", { id: "formation-slot" }), squad));
    E.bus.emit("team-page", { page: ctx.page, team: t, roster, ctx });                      // Stage 7 adds the formation view here
  }, { titleKey: "nav.teams" });

  function reqRow(r, what, note, decide) {
    return el("div", { class: "list-row", style: { flexWrap: "wrap" } }, E.ui.avatar(r.player, "md"), el("div", { class: "grow" }, el("a", { class: "tap-link", href: "#/player/" + (r.player && r.player.id), text: E.u.nameOf(r.player) }), el("div", { class: "small muted", text: what }), note ? el("div", { class: "small", text: "“" + note + "”" }) : null),
      el("div", { class: "row" }, el("button", { type: "button", class: "btn btn-primary btn-sm", on: { click: () => decide(true) } }, T("team.accept")), el("button", { type: "button", class: "btn btn-sm", on: { click: () => decide(false) } }, T("team.refuse"))));
  }
  function requestSheet(kind, t, run) {
    const ta = el("textarea", { class: "textarea", maxlength: "300", rows: "3", "aria-label": kind === "join" ? T("team.join.msg") : T("team.transfer.reason") }), m = E.ui.modal([
      el("h2", { text: kind === "join" ? T("team.join.title", { team: t.name }) : T("team.transfer.title", { team: t.name }) }), el("div", { class: "field" }, el("label", { text: kind === "join" ? T("team.join.msg") : T("team.transfer.reason") }), ta),
      el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close() } }, T("common.cancel")),
        el("button", { type: "button", class: "btn btn-primary", on: { click: () => { m.close(); run(() => kind === "join" ? E.api.rpc("request_join_team", { p_team_id: t.team_id, p_message: ta.value.trim() || null }) : E.api.rpc("request_transfer", { p_from_team: S.teamId, p_to_team: t.team_id, p_reason: ta.value.trim() || null }), kind === "join" ? T("team.join.sent") : T("team.transfer.sent")); } } }, T("team.join.send")))]);
  }
})(window);
