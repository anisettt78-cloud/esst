/* Public league pages: fixtures by matchday, standings + leaders, match page, home. Everything is computed on the server from the saved events. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, L = E.league, T = (k, v) => E.t(k, v), S = E.session, N = (n) => E.i18n.number(n);

  /* swipe-friendly tab bar. items: [[id, label]] */
  function tabs(items, active, onPick, label) {
    const bar = el("div", { class: "tabs", role: "tablist", "aria-label": label || null });
    items.forEach(([id, text]) => bar.appendChild(el("button", { type: "button", class: "tab", role: "tab", "aria-selected": String(id === active), id: "tab-" + id, on: { click: () => onPick(id) } }, text)));
    return bar;
  }
  /* horizontal swipe on a container moves to the next / previous tab */
  function swipe(node, order, current, onPick) {
    let x0 = 0, y0 = 0, t0 = 0;
    node.addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
    node.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; if (Math.abs(dx) < 70 || Math.abs(dy) > 40 || Date.now() - t0 > 600) return;
      if (e.target.closest && e.target.closest(".table-wrap")) return;           // the table scrolls sideways itself
      const i = order.indexOf(current()), step = (dx < 0 ? 1 : -1) * (E.i18n.dir === "rtl" ? -1 : 1), n = order[i + step]; if (n) onPick(n);
    }, { passive: true });
  }
  const personLink = (p) => (p && p.id ? el("a", { href: "#/player/" + p.id, text: E.u.nameOf(p) }) : el("span", { text: "?" }));

  /* ---------------- standings table ---------------- */
  function standingsTable(rows, o) {
    o = o || {}; const cols = o.compact ? ["played", "gd", "points"] : ["played", "won", "drawn", "lost", "gf", "ga", "gd", "points"];
    const head = { played: "st.p", won: "st.w", drawn: "st.d", lost: "st.l", gf: "st.gf", ga: "st.ga", gd: "st.gd", points: "st.pts" };
    const full = { played: "st.p.full", won: "st.w.full", drawn: "st.d.full", lost: "st.l.full", gf: "st.gf.full", ga: "st.ga.full", gd: "st.gd.full", points: "st.pts.full" };
    const t = el("table", { class: "standings", style: o.compact ? { minWidth: "0" } : null }, el("caption", { class: "sr-only", text: T("home.table.title") }),
      el("thead", {}, el("tr", {}, el("th", { class: "c-pos", scope: "col", text: "#" }), el("th", { class: "c-team", scope: "col", style: { textAlign: "start" }, text: T("st.team") }),
        cols.map((c) => el("th", { scope: "col", title: T(full[c]), "aria-label": T(full[c]), text: T(head[c]) })), o.compact ? null : el("th", { scope: "col", text: T("st.form") }))),
      el("tbody", {}, rows.map((r) => {
        const pts = el("td", { class: "c-pts num", text: "0" }); if (o.animate !== false) E.ui.countTo(pts, r.points, 700); else pts.textContent = N(r.points);
        return el("tr", { class: r.pos === 1 && r.played ? "top" : "" }, el("td", { class: "c-pos num", text: String(r.pos) }),
          el("td", { class: "c-team" }, el("a", { href: "#/team/" + r.team_id }, L.logo({ logo_url: r.logo_url, name: r.name }), el("span", { text: o.compact ? (r.short_name || r.name) : r.name }))),
          cols.map((c) => c === "points" ? pts : el("td", { class: "num", text: c === "gd" && r.gd > 0 ? "+" + N(r.gd) : N(r[c]) })),
          o.compact ? null : el("td", {}, r.form ? el("span", { class: "form", role: "img", "aria-label": r.form.split("").join(" ") }, r.form.split("").map((c) => el("i", { class: c, text: c }))) : el("span", { class: "faint", text: "–" })));
      })));
    return el("div", { class: "table-wrap" }, t);
  }
  E.league.standingsTable = standingsTable;

  /* ---------------- leaders ---------------- */
  function leaderList(rows, unitKey) {
    if (!rows.length) return E.ui.empty("trophy", T("lead.empty.title"), T("lead.empty.text"));
    return el("div", { class: "card list", style: { padding: "4px 12px" } }, rows.map((r, i) => el("a", { class: "list-row", href: "#/player/" + r.player_id },
      el("span", { class: "rank" + (i === 0 ? " r1" : ""), text: String(i + 1) }), E.ui.avatar(r, "md"),
      el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" }, text: E.u.nameOf(r) }), el("div", { class: "small muted ellipsis", text: (r.team_name || T("profile.no_team")) + (r.matches != null && unitKey ? " · " + T("lead.in_matches", { n: r.matches }) : "") })),
      el("span", { class: "big-num", "aria-label": T(unitKey) + " " + r.value, text: N(r.value) }))));
  }
  function bestList(rows, by) {
    if (!rows.length) return E.ui.empty("star", T("lead.empty.title"), T("lead.empty.text"));
    return el("div", { class: "card list", style: { padding: "4px 12px" } }, rows.map((r, i) => el("a", { class: "list-row", href: "#/player/" + r.player_id },
      el("span", { class: "rank" + (i === 0 ? " r1" : ""), text: String(i + 1) }), E.ui.avatar(r, "md"),
      el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" }, text: E.u.nameOf(r) }),
        el("div", { class: "small muted ellipsis", text: (r.team_name || T("profile.no_team")) + " · " + (by === "ovr" ? T("stat.matches") + " " + r.matches : T("stat.goals") + " " + r.goals + " · " + T("stat.assists") + " " + r.assists + " · " + T("stat.matches") + " " + r.matches) })),
      el("span", { class: "big-num", text: N(by === "ovr" ? r.ovr : r.perf_score) }))));
  }

  /* ---------------- /standings ---------------- */
  const TABS = ["table", "goals", "assists", "yellow", "red", "best"];
  E.router.add("/standings", async (ctx) => {
    let cur = TABS.includes(ctx.query.tab) ? ctx.query.tab : "table", best = "ovr";
    const content = el("div", { class: "stack" }), bar = el("div"), top = el("div", { class: "page-head" }, el("h1", { text: T("nav.standings") }));
    const label = { table: T("home.table.title"), goals: T("lead.goals"), assists: T("lead.assists"), yellow: T("lead.yellow"), red: T("lead.red"), best: T("lead.best") };
    function draw() { bar.replaceChildren(tabs(TABS.map((x) => [x, label[x]]), cur, (id) => { cur = id; history.replaceState(null, "", "#/standings?tab=" + id); draw(); }, T("nav.standings"))); load(); const a = bar.querySelector('[aria-selected="true"]'); if (a && a.scrollIntoView) a.scrollIntoView({ inline: "center", block: "nearest" }); }
    let token = 0;
    async function load() {
      const my = ++token; content.replaceChildren(E.ui.skeletonRows(5, 56));
      try {
        let node;
        if (cur === "table") {
          const rows = await E.api.rpc("league_standings"); if (my !== token) return;
          node = rows.length ? el("div", { class: "stack" }, standingsTable(rows), el("p", { class: "tiny faint", text: T("st.tiebreak") })) : E.ui.empty("list-ordered", T("home.table.empty.title"), T("home.table.empty.text"));
        } else if (cur === "best") {
          const rows = await E.api.rpc("league_best_players", { p_by: best, p_limit: 20 }); if (my !== token) return;
          node = el("div", { class: "stack" }, el("div", { class: "sub-chips" }, ["ovr", "performance"].map((b) => el("button", { type: "button", class: "chip", "aria-pressed": String(best === b), on: { click: () => { best = b; load(); } } }, T("lead.by_" + b)))), bestList(rows, best), el("p", { class: "tiny faint", text: best === "ovr" ? T("lead.ovr.note") : T("lead.perf.note") }));
        } else {
          const rows = await E.api.rpc("league_top_players", { p_stat: cur, p_limit: 20 }); if (my !== token) return;
          node = leaderList(rows, { goals: "stat.goals", assists: "stat.assists", yellow: "stat.yellow", red: "stat.red" }[cur]);
        }
        content.replaceChildren(node);
      } catch (e) { if (my === token) content.replaceChildren(E.ui.errorState(e, load)); }
    }
    ctx.page.append(top, bar, content); draw(); swipe(content, TABS, () => cur, (id) => { cur = id; history.replaceState(null, "", "#/standings?tab=" + id); draw(); });
  }, { titleKey: "nav.standings" });

  /* ---------------- /matches ---------------- */
  E.router.add("/matches", async (ctx) => {
    ctx.page.append(el("div", { class: "page-head" }, el("h1", { text: T("nav.matches") })), E.ui.skeletonRows(4, 90));
    let ms, tm; try { [ms, tm] = await Promise.all([L.matches(), L.teams(), L.settings()]); } catch (e) { if (ctx.isCurrent()) ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return;
    const head = el("div", { class: "page-head" }, el("h1", { text: T("nav.matches") }), S.isSuper ? el("a", { class: "btn btn-sm", href: "#/admin/league" }, icon("settings", { size: 20 }), T("league.manage")) : null);
    if (!ms.length) { ctx.page.replaceChildren(head, E.ui.empty("calendar", T("home.next.empty.title"), T("home.next.empty.text"), S.isSuper ? el("a", { class: "btn btn-primary", href: "#/admin/league" }, T("league.setup")) : null)); return; }
    const days = [...new Set(ms.map((m) => m.matchday).filter((x) => x != null))].sort((a, b) => a - b);
    let md = Number(ctx.query.md); if (!days.includes(md)) { const open = ms.find((m) => m.status !== "finished" && m.status !== "cancelled"); md = open ? open.matchday : days[days.length - 1]; }
    const list = el("div"), bar = el("div");
    function draw() {
      bar.replaceChildren(el("div", { class: "md-tabs" }, tabs(days.map((d) => [d, T("match.md_short", { n: d })]), md, (d) => { md = d; history.replaceState(null, "", "#/matches?md=" + d); draw(); }, T("nav.matches"))));
      const a = bar.querySelector('[aria-selected="true"]'); if (a && a.scrollIntoView) a.scrollIntoView({ inline: "center", block: "nearest" });
      list.replaceChildren(el("h2", { text: T("match.matchday", { n: md }) }));
      let last = ""; const grid = el("div", { class: "stack", style: { gap: "8px" } });
      ms.filter((m) => m.matchday === md).forEach((m) => { const k = L.F.dateKey(m.kickoff_at); if (k !== last) { last = k; grid.appendChild(el("div", { class: "day-head", text: L.F.day(m.kickoff_at) })); } grid.appendChild(L.matchCard(m, tm)); });
      list.appendChild(grid);
    }
    ctx.page.replaceChildren(head, bar, list); draw(); swipe(list, days, () => md, (d) => { md = d; history.replaceState(null, "", "#/matches?md=" + d); draw(); });
  }, { titleKey: "nav.matches" });

  /* ---------------- /match/:id ---------------- */
  const evMinute = (e) => (e.minute != null ? e.minute + "'" + (e.extra_minute ? "+" + e.extra_minute : "") : "");
  function eventRow(e, homeId) {
    const home = e.team_id === homeId, kind = e.type;
    let ic, main, sub = [];
    if (kind === "goal") { ic = icon("target", { size: 20 }); ic.style.color = "var(--accent)"; main = personLink(e.player); if (e.detail === "own_goal") sub.push(T("ev.own_goal")); else if (e.detail === "penalty") sub.push(T("ev.penalty")); if (e.related) sub.push(T("ev.assist", { name: E.u.nameOf(e.related) })); }
    else if (kind === "sub") { ic = icon("arrow-left-right", { size: 20 }); main = personLink(e.related); sub.push(T("ev.sub_out", { name: E.u.nameOf(e.player) })); }
    else { ic = el("span", { class: "card-ic " + kind, role: "img", "aria-label": T("ev." + kind) }); main = personLink(e.player); sub.push(T("ev." + kind)); }
    const who = el("div", { class: "who " + (home ? "home" : "away") }, ic, el("div", { class: "txt" }, main, sub.length ? el("small", { text: sub.join(" · ") }) : null));
    const blank = el("div", { class: "who empty" });
    return el("div", { class: "ev" }, home ? who : blank, el("div", { class: "min", text: evMinute(e) }), home ? blank : who);
  }
  /* Stage 7 replaces this with the pitch view */
  E.league.lineupView = function (detail, side) {
    const team = detail[side], lu = detail.lineups.find((l) => l.team_id === team.id), tf = detail.team_formations.find((f) => f && f.team_id === team.id);
    const row = (p, jersey, pos) => el("a", { class: "list-row", href: "#/player/" + p.id }, el("span", { class: "jersey", text: jersey ? String(jersey) : "" }), E.ui.avatar(p, "sm"), el("div", { class: "grow ellipsis", style: { fontWeight: "650" }, text: E.u.nameOf(p) }), pos ? el("span", { class: "badge badge-muted", text: T("pos.short." + pos) }) : null);
    if (lu) { const st = lu.players.filter((x) => x.is_starter), bn = lu.players.filter((x) => !x.is_starter);
      return el("div", { class: "stack" }, el("div", { class: "row" }, el("span", { class: "badge", text: lu.formation })), el("div", { class: "card list lineup-list", style: { padding: "4px 12px" } }, st.map((x) => row(x.player, x.jersey_number, x.position))),
        bn.length ? el("div", { class: "card list lineup-list", style: { padding: "4px 12px" } }, bn.map((x) => row(x.player, x.jersey_number, x.position))) : null); }
    if (tf && tf.starters.length) return el("div", { class: "stack" }, el("div", { class: "row" }, el("span", { class: "badge", text: tf.formation }), el("span", { class: "small muted", text: T("lineup.team_default") })), el("div", { class: "card list lineup-list", style: { padding: "4px 12px" } }, tf.starters.map((x) => row(x.player, null, x.player.main_position))),
      tf.bench.length ? el("div", { class: "card list lineup-list", style: { padding: "4px 12px" } }, tf.bench.map((p) => row(p, null, p.main_position))) : null);
    return E.ui.empty("shirt", T("lineup.none.title"), T("lineup.none.text"));
  };

  E.router.add("/match/:id", async (ctx) => {
    ctx.page.appendChild(E.ui.skeletonRows(3, 140));
    let d, st; try { [d, st] = await Promise.all([E.api.rpc("match_detail", { p_match: ctx.params.id }), L.settings()]); } catch (e) { if (ctx.isCurrent()) ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return; ctx.page.replaceChildren();
    if (!d) { ctx.page.appendChild(E.ui.empty("calendar", T("match.not_found"), null, el("a", { class: "btn", href: "#/matches" }, T("nav.matches")))); return; }
    const m = d.match, done = m.status === "finished", tmx = (t) => el("a", { class: "tm", href: "#/team/" + t.id }, L.logo(t, "lg"), el("span", { class: "n", text: t.name }));
    const middle = done ? el("div", { class: "score" }, N(m.home_score), " – ", N(m.away_score)) : el("div", { class: "kick", style: { fontSize: "1.6rem" }, text: L.F.time(m.kickoff_at) });
    const actions = el("div", { class: "row-actions" }, el("button", { type: "button", class: "btn btn-sm", on: { click: () => E.share.share(d.home.name + " – " + d.away.name, "/match/" + m.id) } }, icon("share-2", { size: 20 }), T("profile.share")),
      el("button", { type: "button", class: "btn btn-sm", on: { click: () => E.chat.shareSheet({ type: "match", id: m.id }) } }, icon("send", { size: 20 }), T("chat.share.btn")));
    if (m.status === "scheduled") for (const t of [d.home, d.away]) if (S.isCaptainOf(t.id) || S.isSuper) actions.appendChild(el("a", { class: "btn btn-sm", href: "#/team/" + t.id + "/formation?match=" + m.id }, icon("shirt", { size: 20 }), T("formation.set_match") + " · " + t.short_name));
    if (S.isSuper) actions.append(el("a", { class: "btn btn-sm btn-primary", href: "#/admin/match/" + m.id + "/result" }, icon("pencil", { size: 20 }), done ? T("result.edit") : T("result.enter")), el("button", { type: "button", class: "btn btn-sm", on: { click: () => scheduleSheet(m, () => E.router.render()) } }, icon("clock", { size: 20 }), T("match.edit_schedule")));
    const header = el("section", { class: "mh" }, el("div", { class: "row wrap", style: { justifyContent: "center" } }, m.matchday ? el("span", { class: "badge", text: T("match.matchday", { n: m.matchday }) }) : null, L.statusChip(m) || el("span", { class: "st", text: T("match.status.scheduled") }), m.leg === 2 ? el("span", { class: "badge badge-muted", text: T("match.leg2") }) : null),
      el("div", { class: "teams" }, tmx(d.home), middle, tmx(d.away)), el("div", { class: "muted small" }, L.F.full(m.kickoff_at) + " · " + L.F.time(m.kickoff_at)), m.venue ? el("div", { class: "muted small" }, icon("map-pin", { size: 20, class: "inl" }), m.venue) : null, actions);
    const evs = d.events || [];
    const timeline = el("section", { class: "stack" }, el("h2", { text: T("match.events") }), evs.length ? el("div", { class: "card timeline" }, evs.map((e) => eventRow(e, d.home.id))) : E.ui.empty("target", done ? T("match.events.none") : T("match.events.later")));
    let side = "home"; const lbox = el("div"), lbar = el("div");
    const drawL = () => { lbar.replaceChildren(el("div", { class: "sub-chips" }, ["home", "away"].map((s) => el("button", { type: "button", class: "chip", "aria-pressed": String(side === s), on: { click: () => { side = s; drawL(); } } }, d[s].name)))); lbox.replaceChildren(E.league.lineupView(d, side)); };
    drawL();
    document.title = d.home.name + " – " + d.away.name + " · " + T("app.name");
    ctx.page.appendChild(el("div", { class: "stack", style: { gap: "16px" } }, header, timeline, el("section", { class: "stack" }, el("h2", { text: T("lineup.title") }), lbar, lbox)));
  }, { titleKey: "nav.matches" });

  /* admin: date / time / venue of one match (everything else stays) */
  function scheduleSheet(m, done) {
    const p = L.parts(m.kickoff_at), date = el("input", { class: "input", type: "date", value: p.date }), time = el("input", { class: "input", type: "time", value: p.time }), venue = el("input", { class: "input", maxlength: "80", value: m.venue || "" }), err = el("div", { class: "field-error", role: "alert" });
    const save = el("button", { type: "button", class: "btn btn-primary", on: { click: async () => {
      if (!date.value || !time.value) { err.textContent = T("league.err.datetime"); return; }
      try { await E.ui.busy(save, () => E.api.from("matches").update({ kickoff_at: L.toUtcISO(date.value, time.value), venue: venue.value.trim() || null }).eq("id", m.id)); mo.close(); E.ui.toast(T("match.schedule_saved"), "ok"); done(); } catch (e) { E.ui.toastError(e); }
    } } }, T("common.save"));
    const mo = E.ui.modal([el("h2", { text: T("match.edit_schedule") }), el("div", { class: "stack" }, el("div", { class: "field" }, el("label", { text: T("league.date") }), date), el("div", { class: "field" }, el("label", { text: T("league.time") }), time), el("div", { class: "field" }, el("label", { text: T("league.venue") }), venue), err, el("p", { class: "tiny faint", text: T("league.tz", { tz: L.tzOf() }) })),
      el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => mo.close() } }, T("common.cancel")), save)], { label: T("match.edit_schedule") });
  }

  /* ---------------- home ---------------- */
  E.router.add("/", async (ctx) => {
    const sec = (title, link, body) => el("section", { class: "stack" }, el("div", { class: "section-title", style: { margin: "6px 0 0" } }, el("h2", { text: title }), link ? el("a", { class: "tap-link", style: { color: "var(--accent)" }, href: link }, T("home.see_all"), icon("chevron-right", { size: 20, class: "icon-flip" })) : null), body);
    const hero = el("section", { class: "hero stack" }, el("h1", { text: T("home.hero.title") }), el("p", { class: "muted", text: T("home.hero.text") }),
      el("div", { class: "row wrap" }, el("a", { class: "btn btn-primary", href: "#/standings" }, icon("list-ordered", { size: 20 }), T("home.cta.table")), el("a", { class: "btn", href: "#/matches" }, icon("calendar", { size: 20 }), T("home.cta.matches")), S.loggedIn ? null : el("a", { class: "btn btn-ghost", href: "#/login" }, icon("log-in", { size: 20 }), T("home.cta.login"))));
    const body = el("div", { class: "stack", style: { gap: "16px" } }); ctx.page.append(hero, body); body.appendChild(E.ui.skeletonRows(3, 90));
    const [ms, tm, tbl, sc] = await Promise.allSettled([L.matches(), L.teams(), E.api.rpc("league_standings"), E.api.rpc("league_top_players", { p_stat: "goals", p_limit: 3 })]);
    if (!ctx.isCurrent()) return; body.replaceChildren();
    const ok = (r) => r.status === "fulfilled", fail = ms.status === "rejected" && tbl.status === "rejected" ? ms.reason : null;
    if (fail) { body.appendChild(E.ui.errorState(fail, () => E.router.render())); return; }
    const all = ok(ms) ? ms.value : [], tmap = ok(tm) ? tm.value : new Map();
    const upcoming = all.filter((m) => m.status === "scheduled" || m.status === "live").sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at)).slice(0, 3), recent = all.filter((m) => m.status === "finished").sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at)).slice(0, 3);
    body.appendChild(sec(T("home.next.title"), all.length ? "#/matches" : null, upcoming.length ? el("div", { class: "stack", style: { gap: "8px" } }, upcoming.map((m) => L.matchCard(m, tmap))) : E.ui.empty("calendar", T("home.next.empty.title"), T("home.next.empty.text"))));
    if (recent.length) body.appendChild(sec(T("home.recent.title"), null, el("div", { class: "stack", style: { gap: "8px" } }, recent.map((m) => L.matchCard(m, tmap)))));
    if (ok(tbl)) body.appendChild(sec(T("home.table.title"), "#/standings", tbl.value.length ? standingsTable(tbl.value.slice(0, 5), { compact: true, animate: true }) : E.ui.empty("list-ordered", T("home.table.empty.title"), T("home.table.empty.text"))));
    if (ok(sc) && sc.value.length) body.appendChild(sec(T("lead.goals"), "#/standings?tab=goals", leaderList(sc.value, "stat.goals")));
  }, { titleKey: "nav.home" });
})(window);
