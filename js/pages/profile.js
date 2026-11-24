/* Player profile (own + others), FIFA-style card, edit profile with photo crop, follow / chat / share. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, F = E.forms, V = E.validate, T = (k, v) => E.t(k, v);
  const POS = ["goalkeeper", "defender", "midfielder", "forward"], FOOT = ["right", "left", "both"];
  const posShort = (p) => (p ? T("pos.short." + p) : "–"), posName = (p) => (p ? T("pos." + p) : "–");

  /* public link to a page of the site (works from the Railway site and from a double-clicked copy) */
  const shareUrl = (path) => (E.api.isFile ? E.api.base + "/" : location.origin + location.pathname) + "#" + path;
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); return true; } catch (_) {}
    const ta = el("textarea", { style: { position: "fixed", left: "-9999px" }, "aria-hidden": "true" }); ta.value = s; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (_) {} ta.remove(); return ok;
  }
  async function share(title, path) {
    const url = shareUrl(path);
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    if (await copyText(url)) E.ui.toast(T("profile.link_copied"), "ok"); else E.ui.modal([el("h2", { text: T("profile.share") }), el("div", { class: "code-box", text: url })]);
  }
  E.share = { shareUrl, share, copyText };

  /* ---- FIFA-style card (real data only: rating, position, team, photo, and the player's own stats) ---- */
  function playerCard(p) {
    const s = p.stats || {}, nm = E.u.nameOf(p), t = p.team;
    const photo = el("div", { class: "fut-photo", role: "img", "aria-label": nm }); if (p.photo_url) photo.appendChild(el("img", { src: E.api.mediaUrl(p.photo_url), alt: "", decoding: "async" })); else photo.textContent = E.u.initials(nm);
    const team = el("div", { class: "fut-team", title: t ? t.name : "" }); if (t && t.logo_url) team.appendChild(el("img", { src: E.api.mediaUrl(t.logo_url), alt: "" })); else team.textContent = t ? t.short_name.slice(0, 3) : "–";
    const cell = (v, k) => el("div", {}, el("b", { class: "num", text: E.i18n.number(v || 0) }), el("span", { text: T(k) }));
    return el("div", { class: "fut", "aria-label": nm + ", " + T("profile.card.ovr") + " " + p.ovr },
      el("div", { class: "fut-top" }, el("div", { class: "fut-rating" }, el("b", { class: "num", text: String(p.ovr) }), el("span", { text: posShort(p.main_position) })), team), photo,
      el("div", { class: "fut-name", text: p.nickname || nm }), el("div", { class: "fut-line" }),
      el("div", { class: "fut-stats" }, cell(s.matches, "stat.matches"), cell(s.goals, "stat.goals"), cell(s.assists, "stat.assists"), cell(s.yellow, "stat.yellow"), cell(s.red, "stat.red"),
        el("div", {}, el("b", { class: "num", text: p.height_cm ? String(Math.round(p.height_cm)) : "–" }), el("span", { text: T("profile.height_short") }))));
  }
  E.playerCard = playerCard;

  function peopleSheet(title, rows) {
    const m = E.ui.modal([el("h2", { text: title }), rows.length ? el("div", { class: "list" }, rows.map((r) =>
      el("a", { class: "list-row", href: "#/player/" + r.player_id, on: { click: () => m.close() } }, E.ui.avatar(r, "md"),
        el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" }, text: E.u.nameOf(r) }), el("div", { class: "small muted", text: posName(r.main_position) })),
        el("span", { class: "badge", text: String(r.ovr) })))) : E.ui.empty("users", T("profile.people.empty")),
      el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close() } }, T("common.close")))], { label: title });
  }

  function renderPlayer(page, p, own) {
    const nm = E.u.nameOf(p), uid = p.id, s = p.stats || {};
    let followers = Number(p.followers) || 0, isFollowing = !!p.is_following;
    const fCount = el("strong", { class: "num", text: E.i18n.number(followers) });
    const followBtn = el("button", { type: "button", class: "btn btn-primary", "aria-pressed": String(isFollowing), on: { click: async () => {
      if (!E.api.auth.hasSession()) { E.ui.toast(T("profile.login_to_follow")); return E.router.go("/login?next=" + encodeURIComponent("/player/" + uid)); }
      const was = isFollowing; isFollowing = !was; followers += was ? -1 : 1; paint();
      try { await E.api.rpc(was ? "unfollow_player" : "follow_player", { p_player: uid }); }
      catch (e) { isFollowing = was; followers += was ? 1 : -1; paint(); E.ui.toastError(e); }
    } } });
    const paint = () => { followBtn.setAttribute("aria-pressed", String(isFollowing)); followBtn.className = "btn " + (isFollowing ? "" : "btn-primary"); followBtn.replaceChildren(icon(isFollowing ? "user-check" : "user-plus", { size: 20 }), isFollowing ? T("profile.followed") : T("profile.follow")); fCount.textContent = E.i18n.number(followers); };
    paint();
    const chatBtn = el("button", { type: "button", class: "btn", on: { click: async () => {
      if (!E.api.auth.hasSession()) return E.router.go("/login?next=" + encodeURIComponent("/player/" + uid));
      try { const r = await E.ui.busy(chatBtn, () => E.api.post("/api/chat/direct", { user_id: uid })); E.router.go("/chat/" + r.id); } catch (err) { E.ui.toastError(err); }
    } } }, icon("message-circle", { size: 20 }), T("profile.chat"));
    const shareBtn = el("button", { type: "button", class: "btn", on: { click: () => share(nm, "/player/" + uid) } }, icon("share-2", { size: 20 }), T("profile.share"));
    const shareChatBtn = el("button", { type: "button", class: "btn", on: { click: () => E.chat.shareSheet({ type: "player", id: uid }) } }, icon("send", { size: 20 }), T("chat.share.btn"));
    const editBtn = el("a", { class: "btn btn-primary", href: "#/profile/edit" }, icon("pencil", { size: 20 }), T("profile.edit"));
    const openList = async (kind, title) => { try { peopleSheet(title, await E.api.rpc("follow_list", { p_player: uid, p_kind: kind })); } catch (e) { E.ui.toastError(e); } };
    const t = p.team;
    const bdLine = own && E.session.profile && E.session.profile.birth_date ? E.i18n.dateOnly(E.session.profile.birth_date + "T12:00:00") : null;

    const hero = el("section", { class: "player-hero" }, E.ui.avatar(p, "lg player-photo"), el("h1", { class: "player-name", text: nm }), p.nickname ? el("div", { class: "player-nick", text: "“" + p.nickname + "”" }) : null,
      el("div", { class: "row wrap", style: { justifyContent: "center" } }, el("span", { class: "badge" }, posShort(p.main_position) + " · " + posName(p.main_position)),
        p.age != null ? el("span", { class: "badge badge-muted", text: T("profile.age", { n: p.age }) }) : null,
        t ? el("a", { class: "team-chip", href: "#/team/" + t.id }, E.ui.avatar({ logo_url: t.logo_url, full_name: t.name }, "sm", { square: true }), t.name, t.role_in_team === "captain" ? icon("crown", { size: 20 }) : null) : el("span", { class: "badge badge-muted", text: T("profile.no_team") })),
      el("div", { class: "counts" }, el("button", { type: "button", class: "count", "aria-label": T("profile.followers"), on: { click: () => openList("followers", T("profile.followers")) } }, fCount, el("span", { text: T("profile.followers") })),
        el("button", { type: "button", class: "count", "aria-label": T("profile.following"), on: { click: () => openList("following", T("profile.following")) } }, el("strong", { class: "num", text: E.i18n.number(Number(p.following) || 0) }), el("span", { text: T("profile.following") }))),
      el("div", { class: "hero-actions" }, own ? [editBtn, shareBtn, shareChatBtn] : [followBtn, chatBtn, shareBtn, shareChatBtn]));

    const kv = [[T("profile.full_name"), p.full_name], [T("profile.nickname"), p.nickname], [T("profile.age_label"), p.age != null ? T("profile.age", { n: p.age }) : null], bdLine ? [T("profile.birth"), bdLine] : null,
      [T("profile.height"), p.height_cm ? E.i18n.number(Number(p.height_cm)) : null], [T("profile.weight"), p.weight_kg ? E.i18n.number(Number(p.weight_kg)) : null], [T("profile.foot"), p.preferred_foot ? T("foot." + p.preferred_foot) : null],
      [T("profile.pos.main"), p.main_position ? posName(p.main_position) : null], [T("profile.pos.second"), p.secondary_position ? posName(p.secondary_position) : null]].filter((r) => r && r[1]);
    const details = el("section", { class: "card stack" }, el("h2", { text: T("profile.details") }), el("dl", { class: "kv" }, kv.map(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])), p.bio ? el("p", { class: "muted", text: p.bio }) : null);
    const tile = (cls, k, v) => { const b = el("b", { class: "num", text: "0" }); E.ui.countTo(b, Number(v) || 0); return el("div", { class: "stat-tile " + cls }, b, el("span", { text: T(k) })); };
    const stats = el("section", { class: "stack" }, el("h2", { text: T("profile.stats") }), el("div", { class: "stat-tiles" }, tile("", "stat.matches", s.matches), tile("g", "stat.goals", s.goals), tile("g", "stat.assists", s.assists), tile("y", "stat.yellow", s.yellow), tile("r", "stat.red", s.red)));
    const hist = Array.isArray(p.history) ? p.history : [];
    const history = el("section", { class: "stack" }, el("h2", { text: T("profile.history") }), hist.length ? el("div", { class: "stack", style: { gap: "8px" } }, hist.map((h) => {
      const mine = h.team_id === h.home_id ? [h.home_score, h.away_score] : [h.away_score, h.home_score], r = mine[0] > mine[1] ? "W" : mine[0] === mine[1] ? "D" : "L";
      return el("a", { class: "match-row card-press", href: "#/match/" + h.match_id }, el("span", { class: "res " + r, text: r }),
        el("div", { class: "grow", style: { flex: 1, minWidth: 0 } }, el("div", { class: "ellipsis", style: { fontWeight: "700" }, text: h.home + "  " + h.home_score + " – " + h.away_score + "  " + h.away }), el("div", { class: "tiny muted", text: E.i18n.dateOnly(h.kickoff_at) })),
        h.goals ? el("span", { class: "badge" }, icon("target", { size: 20 }), String(h.goals)) : null, h.assists ? el("span", { class: "badge badge-muted" }, icon("zap", { size: 20 }), String(h.assists)) : null);
    })) : E.ui.empty("calendar", T("profile.history.empty.title"), T("profile.history.empty.text")));
    page.appendChild(el("div", { class: "stack", style: { gap: "16px" } }, hero, el("div", { class: "profile-grid" }, el("div", { class: "stack", style: { gap: "16px" } }, playerCard(p)), el("div", { class: "stack", style: { gap: "16px", marginTop: "0" } }, stats, details, history)),
      own ? el("button", { type: "button", class: "btn btn-block btn-danger", on: { click: async () => { await E.api.auth.signOut(); await E.session.load(); E.ui.toast(T("auth.logged_out")); E.router.go("/"); } } }, icon("log-out", { size: 20 }), T("auth.logout")) : null));
  }

  async function playerPage(ctx, id, own) {
    ctx.page.appendChild(E.ui.skeletonRows(3, 120));
    let p; try { p = await E.api.rpc("player_public", { p_id: id }); } catch (e) { if (!ctx.isCurrent()) return; ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return;
    ctx.page.replaceChildren();
    if (!p) { ctx.page.appendChild(E.ui.empty("user", T("profile.not_found"), null, el("a", { class: "btn", href: "#/" }, T("notfound.home")))); return; }
    renderPlayer(ctx.page, p, own || (E.api.auth.user() && E.api.auth.user().id === id));
    document.title = E.u.nameOf(p) + " · " + T("app.name");
  }
  E.router.add("/profile", (ctx) => playerPage(ctx, E.api.auth.user().id, true), { auth: true, titleKey: "nav.profile" });
  E.router.add("/player/:id", (ctx) => playerPage(ctx, ctx.params.id, false), { titleKey: "nav.profile" });

  /* ---- edit profile ---- */
  E.router.add("/profile/edit", (ctx) => {
    const P = E.session.profile; if (!P) { ctx.page.appendChild(E.ui.errorState({ status: 0 }, () => E.router.render())); return; }
    const uid = E.api.auth.user().id;
    let avatarHost = el("span"); const paintAvatar = () => { const n = E.ui.avatar(P, "lg player-photo"); avatarHost.replaceWith(n); avatarHost = n; }; avatarHost = E.ui.avatar(P, "lg player-photo");
    const photoBtn = el("button", { type: "button", class: "btn", on: { click: async () => {
      const blob = await E.media.pickAndCrop({ size: 512 }); if (!blob) return;
      try { const r = await E.ui.busy(photoBtn, () => E.api.upload("avatar", blob)); P.photo_url = r.url; paintAvatar(); E.ui.toast(T("profile.photo.saved"), "ok"); } catch (err) { E.ui.toastError(err); }
    } } }, icon("camera", { size: 20 }), T("profile.photo.change"));
    const name = F.field(T("profile.full_name"), F.input({ autocomplete: "name", maxlength: "80", value: P.full_name || "" }));
    const nick = F.field(T("profile.nickname"), F.input({ autocomplete: "nickname", maxlength: "30", value: P.nickname || "" }), { optional: true });
    const bd = F.birthDate(P.birth_date ? String(P.birth_date).slice(0, 10) : null);
    const height = F.field(T("profile.height"), F.input({ type: "text", inputmode: "decimal", value: P.height_cm != null ? String(Number(P.height_cm)) : "" }), { optional: true });
    const weight = F.field(T("profile.weight"), F.input({ type: "text", inputmode: "decimal", value: P.weight_kg != null ? String(Number(P.weight_kg)) : "" }), { optional: true });
    const foot = F.segmented(FOOT.map((f) => [f, T("foot." + f)]), P.preferred_foot, null, T("profile.foot"));
    const main = F.segmented(POS.map((p) => [p, T("pos." + p)]), P.main_position, null, T("profile.pos.main"));
    const second = F.segmented(POS.map((p) => [p, T("pos." + p)]), P.secondary_position, null, T("profile.pos.second"), true);
    const footF = F.field(T("profile.foot"), foot.el), mainF = F.field(T("profile.pos.main"), main.el), secondF = F.field(T("profile.pos.second"), second.el, { optional: true });
    const bio = F.field(T("profile.bio"), el("textarea", { class: "textarea", maxlength: "280", rows: "3" }, P.bio || ""), { optional: true });
    const btn = el("button", { type: "submit", class: "btn btn-primary btn-block" }, T("common.save"));
    const note = P.birth_date_estimated ? el("div", { class: "form-error", role: "status", text: T("profile.birth_estimated") }) : null;
    const form = el("form", { novalidate: true, class: "stack", on: { submit: async (e) => {
      e.preventDefault(); const fn = name.input.value.trim(); let first = null;
      const chk = (f, ok, msg) => { f.setError(ok ? "" : msg); if (!ok && !first) first = f.input; };
      chk(name, fn.length >= 2, T("auth.err.fullname")); chk(height, !V.rangeError(height.input.value, 100, 250), T("profile.err.height")); chk(weight, !V.rangeError(weight.input.value, 30, 200), T("profile.err.weight"));
      chk(bio, bio.input.value.length <= 280, T("profile.err.bio"));
      const bdOk = bd.validate(); mainF.setError(main.value ? "" : T("auth.err.position")); footF.setError(foot.value ? "" : T("auth.err.foot"));
      secondF.setError(second.value && second.value === main.value ? T("profile.err.second") : "");
      if (first) first.focus(); if (first || !bdOk || !main.value || !foot.value || (second.value && second.value === main.value)) return;
      const patch = { full_name: fn, nickname: nick.input.value.trim() || null, display_name: nick.input.value.trim() || fn, birth_date: bd.iso(), height_cm: V.toNumber(height.input.value), weight_kg: V.toNumber(weight.input.value),
        preferred_foot: foot.value, main_position: main.value, secondary_position: second.value || null, bio: bio.input.value.trim() || null, profile_complete: true };
      try { await E.ui.busy(btn, () => E.api.from("profiles").update(patch).eq("id", uid)); await E.session.load(); E.ui.toast(T("profile.saved"), "ok"); E.router.go("/profile", { replace: true }); }
      catch (err) { if (err.code === "INVALID_BIRTH_DATE") { bd.validate(); E.ui.toast(T("auth.err.birth_age"), "err"); } else E.ui.toastError(err); }
    } } }, note, name.el, nick.el, bd.el, el("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" } }, height.el, weight.el), footF.el, mainF.el, secondF.el, bio.el, btn);
    ctx.page.appendChild(el("div", { class: "auth-card" }, el("div", { class: "page-head" }, E.u.iconBtn("arrow-left", T("common.back"), () => E.router.back("/profile"), { class: "icon-flip" }), el("h1", { text: T("profile.edit") })),
      el("div", { class: "stack", style: { alignItems: "center" } }, avatarHost, photoBtn), el("div", { class: "card" }, form)));
  }, { auth: true, titleKey: "profile.edit" });
})(window);
