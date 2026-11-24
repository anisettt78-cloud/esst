/* Super admin: launch / rebuild the league, enter and correct match results.
   The SERVER re-checks the role on every one of these calls; hiding a button is never the protection. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, F = E.forms, L = E.league, O = E.ovr, T = (k, v) => E.t(k, v), N = (n) => E.i18n.number(n), A = { auth: true, super: true };
  const wrap = (...k) => el("div", { class: "stack", style: { gap: "16px" } }, k);
  const back = (title, to) => el("div", { class: "page-head" }, E.u.iconBtn("arrow-left", T("common.back"), () => E.router.back(to || "/admin"), { class: "icon-flip" }), el("h1", { text: title }));

  /* =============== launch / rebuild =============== */
  E.router.add("/admin/league", async (ctx) => {
    ctx.page.appendChild(E.ui.skeletonRows(3, 110));
    let c; try { c = await E.api.get("/api/league/checks"); } catch (e) { ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return; ctx.page.replaceChildren();
    const s = c.settings, launched = c.state === "launched", n = c.teams;
    let legs = s.legs || 1, days = (s.match_days && s.match_days.length) ? s.match_days.slice() : [6], times = (s.kickoff_times && s.kickoff_times.length) ? s.kickoff_times.slice() : ["16:00"], venues = (s.venues || []).slice();
    const today = new Date(), todayISO = today.getFullYear() + "-" + E.validate.pad(today.getMonth() + 1) + "-" + E.validate.pad(today.getDate());
    const start = el("input", { class: "input", type: "date", value: s.start_date || "", min: launched ? null : todayISO, "aria-label": T("league.start") }), err = el("div", { class: "field-error", role: "alert" });
    const preview = el("p", { class: "muted", "aria-live": "polite" });
    const upd = () => { const rounds = (n % 2 ? n : n - 1) * legs, matches = n * (n - 1) / 2 * legs; preview.textContent = n >= 2 ? T("league.preview", { m: N(matches), r: N(rounds) }) : T("league.err.teams"); };
    const legBox = el("div", { class: "row wrap", role: "radiogroup", "aria-label": T("league.legs") }), dayBox = el("div", { class: "days", role: "group", "aria-label": T("league.days") }), timeBox = el("div", { class: "stack", style: { gap: "8px" } }), venBox = el("div", { class: "stack", style: { gap: "8px" } });
    const drawLegs = () => { legBox.replaceChildren(...[1, 2].map((v) => el("button", { type: "button", class: "pick", role: "radio", "aria-checked": String(legs === v), "aria-pressed": String(legs === v), on: { click: () => { legs = v; drawLegs(); upd(); } } }, T("league.legs." + v)))); };
    const dayName = (d) => new Intl.DateTimeFormat(E.i18n.locale, { weekday: "short" }).format(new Date(2024, 0, 7 + d));
    const drawDays = () => { dayBox.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => el("button", { type: "button", class: "pick", "aria-pressed": String(days.includes(d)), on: { click: () => { days = days.includes(d) ? days.filter((x) => x !== d) : days.concat(d); drawDays(); } } }, dayName(d)))); };
    const drawTimes = () => { timeBox.replaceChildren(...times.map((t, i) => el("div", { class: "time-row" }, el("input", { class: "input", type: "time", value: t, "aria-label": T("league.time") + " " + (i + 1), on: { change: (e) => { times[i] = e.target.value; } } }), times.length > 1 ? E.u.iconBtn("trash-2", T("league.remove"), () => { times.splice(i, 1); drawTimes(); }) : null)),
      times.length < 8 ? el("button", { type: "button", class: "btn btn-sm", on: { click: () => { times.push("18:00"); drawTimes(); } } }, icon("plus", { size: 20 }), T("league.add_time")) : null); };
    const drawVen = () => { venBox.replaceChildren(...venues.map((v, i) => el("div", { class: "time-row" }, el("input", { class: "input", maxlength: "80", value: v, "aria-label": T("league.venue") + " " + (i + 1), on: { input: (e) => { venues[i] = e.target.value; } } }), E.u.iconBtn("trash-2", T("league.remove"), () => { venues.splice(i, 1); drawVen(); }))),
      venues.length < 10 ? el("button", { type: "button", class: "btn btn-sm", on: { click: () => { venues.push(""); drawVen(); } } }, icon("plus", { size: 20 }), T("league.add_venue")) : null); };
    drawLegs(); drawDays(); drawTimes(); drawVen(); upd();
    const plan = () => {
      err.textContent = ""; const tm = [...new Set(times.filter(Boolean))], vn = venues.map((v) => v.trim()).filter(Boolean);
      if (!start.value) { err.textContent = T("league.err.start"); start.focus(); return null; } if (!days.length) { err.textContent = T("league.err.days"); return null; } if (!tm.length) { err.textContent = T("league.err.times"); return null; }
      return { legs, start_date: start.value, match_days: days.slice().sort(), kickoff_times: tm, venues: vn };
    };
    const summary = (p) => el("ul", { class: "muted", style: { paddingInlineStart: "20px", margin: "8px 0" } }, el("li", { text: T("league.preview", { m: N(n * (n - 1) / 2 * p.legs), r: N((n % 2 ? n : n - 1) * p.legs) }) }), el("li", { text: T("league.start") + ": " + p.start_date }), el("li", { text: p.kickoff_times.join(", ") }));
    const fail = (e) => E.ui.toast(E.api.errorText(e), "err");
    const launch = el("button", { type: "button", class: "btn btn-primary btn-block", on: { click: async () => {
      const p = plan(); if (!p) return;
      if (!(await E.ui.confirm({ title: T("league.launch.confirm"), text: T("league.launch.text"), body: summary(p), confirmLabel: T("league.launch") }))) return;
      try { const r = await E.ui.busy(launch, () => E.api.post("/api/league/launch", p)); E.ui.toast(T("league.launched", { m: N(r.matches) }), "ok"); await E.league.settings(true); E.router.go("/matches"); } catch (e) { fail(e); }
    } } }, icon("play", { size: 20 }), T("league.launch"));
    const rebuild = el("button", { type: "button", class: "btn btn-danger btn-block", on: { click: async () => {
      const p = plan(); if (!p) return; let imp; try { imp = await E.api.get("/api/league/impact"); } catch (e) { return fail(e); }
      const li = (k, v) => el("li", { text: T(k, { n: N(v) }) });
      const body = el("div", {}, el("p", { class: "warn", text: T("league.rebuild.warn") }), el("ul", { style: { paddingInlineStart: "20px", margin: "8px 0" } }, li("league.imp.matches", imp.matches), li("league.imp.finished", imp.finished), li("league.imp.events", imp.events), li("league.imp.reports", imp.reports), li("league.imp.lineups", imp.lineups), li("league.imp.ovr", imp.ovr_entries)), summary(p));
      if (!(await E.ui.confirm({ title: T("league.rebuild.confirm"), body, danger: true, typeToConfirm: "REBUILD", typeLabel: T("league.rebuild.type"), confirmLabel: T("league.rebuild") }))) return;
      try { const r = await E.ui.busy(rebuild, () => E.api.post("/api/league/rebuild", Object.assign({ confirm: "REBUILD" }, p))); E.ui.toast(T("league.rebuilt", { m: N(r.matches) }), "ok"); await E.league.settings(true); E.router.go("/matches"); } catch (e) { fail(e); }
    } } }, icon("refresh-cw", { size: 20 }), T("league.rebuild"));
    launch.disabled = !c.can_launch;
    const warn = c.warnings.length ? el("section", { class: "card stack" }, el("h2", { text: T("league.warnings") }), el("ul", { style: { paddingInlineStart: "20px", margin: 0 } }, c.warnings.map((w) => el("li", {}, el("a", { class: "tap-link", href: "#/admin/team/" + w.team_id, text: w.name }), " – " + (w.code === "NO_CAPTAIN" ? T("league.w.no_captain") : T("league.w.few_players", { n: w.players, k: w.needed }))))), el("p", { class: "tiny faint", text: T("league.w.note") })) : null;
    ctx.page.appendChild(wrap(back(T("league.title")), el("section", { class: "card stack" }, el("div", { class: "row wrap" }, el("span", { class: "badge " + (launched ? "" : "badge-muted"), text: launched ? T("league.state.launched") : T("league.state.setup") }), el("span", { class: "badge badge-muted", text: T("league.teams_n", { n: N(n) }) })),
      n < 2 ? el("p", { class: "warn", text: T("league.err.teams") }) : null), warn,
      el("section", { class: "card stack" }, el("h2", { text: launched ? T("league.plan.rebuild") : T("league.plan") }), el("div", { class: "field" }, el("label", { text: T("league.legs") }), legBox), el("div", { class: "field" }, el("label", { text: T("league.start") }), start),
        el("div", { class: "field" }, el("label", { text: T("league.days") }), dayBox), el("div", { class: "field" }, el("label", { text: T("league.times") }), timeBox), el("div", { class: "field" }, el("label", { text: T("league.venues") }), venBox), el("p", { class: "tiny faint", text: T("league.tz", { tz: s.timezone || "Africa/Algiers" }) }), err, preview, launched ? rebuild : launch)));
  }, Object.assign({ titleKey: "league.title" }, A));

  /* =============== result editor =============== */
  E.router.add("/admin/match/:id/result", async (ctx) => {
    ctx.page.appendChild(E.ui.skeletonRows(3, 120)); const id = ctx.params.id;
    let d; try { d = await E.api.rpc("match_detail", { p_match: id }); if (d) { await L.settings(); } } catch (e) { ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return; if (!d) { ctx.page.replaceChildren(E.ui.empty("calendar", T("match.not_found"))); return; }
    let ros, apps = []; try { ros = await Promise.all([E.api.rpc("team_roster", { p_team: d.home.id }), E.api.rpc("team_roster", { p_team: d.away.id })]); try { apps = await E.api.from("player_match_appearances").select("player_id,team_id,is_starter,match_position").eq("match_id", id); } catch (_) { apps = []; } } catch (e) { ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return; ctx.page.replaceChildren();
    const m = d.match, teams = { [d.home.id]: d.home, [d.away.id]: d.away }, roster = { [d.home.id]: ros[0], [d.away.id]: ros[1] }, byId = new Map([...ros[0], ...ros[1]].map((p) => [p.player_id, p]));
    const pos = (pid) => (byId.get(pid) && byId.get(pid).main_position) || "midfielder", nm = (pid) => (byId.has(pid) ? E.u.nameOf(byId.get(pid)) : "?");
    const starters = new Set(); const lu = (tid) => d.lineups.find((l) => l.team_id === tid), tf = (tid) => d.team_formations.find((f) => f && f.team_id === tid);
    for (const tid of Object.keys(teams)) {
      const fromApps = apps.filter((a) => a.team_id === tid && a.is_starter), l = lu(tid), f = tf(tid);
      (fromApps.length ? fromApps.map((a) => a.player_id) : l ? l.players.filter((x) => x.is_starter).map((x) => x.player.id) : f ? f.starters.map((x) => x.player.id) : []).forEach((x) => { if (byId.has(x)) starters.add(x); });
    }
    let events = (d.events || []).map((e) => ({ type: e.type, detail: e.detail || null, minute: e.minute, extra: e.extra_minute, team_id: e.team_id, player_id: e.player && e.player.id, related_id: e.related && e.related.id }));
    const scoreNode = el("div", { class: "editor-score", "aria-live": "polite" }), startBox = el("div", { class: "stack" }), evBox = el("div", { class: "stack", style: { gap: "8px" } }), errBox = el("div", { class: "form-error", role: "alert", hidden: true });
    const toPayload = (e) => ({ event_type: e.type, detail: e.type === "goal" ? (e.detail || "normal") : null, minute: e.minute, extra_minute: e.extra == null ? null : e.extra, team_id: e.team_id, player_id: e.player_id, related_player_id: e.related_id || null });
    const lineups = () => Object.keys(teams).map((tid) => ({ team_id: tid, players: roster[tid].map((p) => ({ player_id: p.player_id, match_position: pos(p.player_id), is_starter: starters.has(p.player_id) })) }));
    const scoreNow = () => O.score(events.map(toPayload), d.home.id, d.away.id);
    function drawScore() { const s = scoreNow(); scoreNode.textContent = N(s.home) + " – " + N(s.away); }
    function drawStarters() {
      startBox.replaceChildren(...Object.keys(teams).map((tid) => { const cnt = roster[tid].filter((p) => starters.has(p.player_id)).length;
        return el("section", { class: "card stack" }, el("div", { class: "row" }, el("h2", { style: { flex: 1 }, text: T("result.starters", { team: teams[tid].name }) }), el("span", { class: "badge " + (cnt === 11 ? "" : "badge-muted"), text: cnt + "/11" })),
          cnt && cnt !== 11 ? el("p", { class: "warn", text: T("result.starters.warn", { n: cnt }) }) : null, roster[tid].length ? el("div", { class: "pick-grid" }, roster[tid].map((p) => el("button", { type: "button", class: "pick", "aria-pressed": String(starters.has(p.player_id)), on: { click: () => { if (starters.has(p.player_id)) starters.delete(p.player_id); else starters.add(p.player_id); drawStarters(); } } }, E.u.nameOf(p), el("span", { class: "tiny faint", text: " " + T("pos.short." + pos(p.player_id)) })))) : E.ui.empty("users", T("team.roster.empty.title"))); }));
    }
    function evText(e) {
      const t = teams[e.team_id], base = e.type === "goal" ? (e.detail === "own_goal" ? T("ev.own_goal") : e.detail === "penalty" ? T("ev.penalty") : T("ev.goal")) : T("ev." + e.type);
      return base + ": " + nm(e.player_id) + (e.type === "sub" ? " → " + nm(e.related_id) : e.related_id ? " (" + T("ev.assist", { name: nm(e.related_id) }) + ")" : "") + " · " + (t ? t.short_name : "");
    }
    function drawEvents() {
      const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => O.key(a.e.minute, a.e.extra) - O.key(b.e.minute, b.e.extra));
      evBox.replaceChildren(...(sorted.length ? sorted.map(({ e, i }) => el("div", { class: "ev-row" }, el("strong", { class: "num", style: { minWidth: "42px" }, text: e.minute + "'" + (e.extra ? "+" + e.extra : "") }), e.type === "yellow" || e.type === "red" ? el("span", { class: "card-ic " + e.type }) : icon(e.type === "sub" ? "arrow-left-right" : "target", { size: 20 }),
        el("span", { class: "grow", style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" }, text: evText(e) }), E.u.iconBtn("trash-2", T("result.event.remove"), () => { events.splice(i, 1); drawEvents(); drawScore(); }))) : [el("p", { class: "muted", text: T("result.events.none") })]));
    }
    function eventSheet() {
      let kind = "goal", side = d.home.id; const min = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0", max: "130", placeholder: "0", "aria-label": T("result.minute") }), extra = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0", max: "15", placeholder: "0", "aria-label": T("result.stoppage") });
      const who = el("select", { class: "select", "aria-label": T("result.player") }), rel = el("select", { class: "select", "aria-label": T("result.assist") }), err = el("div", { class: "field-error", role: "alert" }), kindBox = el("div", { class: "pick-grid" }), sideBox = el("div", { class: "pick-grid" }), relField = el("div", { class: "field" }), whoLabel = el("label"), relLabel = el("label");
      const opts = (sel, tid, list, blank) => { sel.replaceChildren(); if (blank) sel.appendChild(el("option", { value: "", text: blank })); else sel.appendChild(el("option", { value: "", text: "…", disabled: true, selected: true })); for (const p of list) sel.appendChild(el("option", { value: p.player_id, text: E.u.nameOf(p) + (starters.has(p.player_id) ? "" : " (" + T("result.sub") + ")") })); };
      const KINDS = [["goal", T("ev.goal")], ["penalty", T("ev.penalty")], ["own_goal", T("ev.own_goal")], ["yellow", T("ev.yellow")], ["red", T("ev.red")], ["sub", T("ev.sub")]];
      function draw() {
        kindBox.replaceChildren(...KINDS.map(([k, l]) => el("button", { type: "button", class: "pick", "aria-pressed": String(kind === k), on: { click: () => { kind = k; draw(); } } }, l)));
        sideBox.replaceChildren(...[d.home.id, d.away.id].map((tid) => el("button", { type: "button", class: "pick", "aria-pressed": String(side === tid), on: { click: () => { side = tid; draw(); } } }, teams[tid].name)));
        const own = kind === "own_goal", other = side === d.home.id ? d.away.id : d.home.id, list = own ? roster[other] : roster[side];
        whoLabel.textContent = kind === "sub" ? T("result.sub_out") : own ? T("result.own_player") : T("result.player"); opts(who, side, list);
        const showRel = kind === "goal" || kind === "penalty" || kind === "sub"; relField.hidden = !showRel; relLabel.textContent = kind === "sub" ? T("result.sub_in") : T("result.assist");
        opts(rel, side, roster[side].filter((p) => kind === "sub" ? !starters.has(p.player_id) : true), kind === "sub" ? null : T("result.no_assist"));
      }
      relField.append(relLabel, rel); const mo = E.ui.modal([el("h2", { text: T("result.add_event") }), el("div", { class: "stack" }, el("div", { class: "field" }, el("label", { text: T("result.type") }), kindBox), el("div", { class: "field" }, el("label", { text: T("result.team") }), sideBox),
        el("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" } }, el("div", { class: "field" }, el("label", { text: T("result.minute") }), min), el("div", { class: "field" }, el("label", { text: T("result.stoppage") + " " + T("profile.optional") }), extra)), el("div", { class: "field" }, whoLabel, who), relField, err),
        el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => mo.close() } }, T("common.cancel")), el("button", { type: "button", class: "btn btn-primary", on: { click: () => {
          const mv = min.value === "" ? NaN : Number(min.value), ev = { type: kind === "penalty" || kind === "own_goal" ? "goal" : kind, detail: kind === "penalty" ? "penalty" : kind === "own_goal" ? "own_goal" : kind === "goal" ? "normal" : null, minute: mv, extra: extra.value === "" ? null : Number(extra.value), team_id: side, player_id: who.value, related_id: rel.value || null };
          if (!Number.isInteger(mv) || mv < 0 || mv > 130) { err.textContent = T("result.err.minute"); return; } if (ev.extra != null && (!Number.isInteger(ev.extra) || ev.extra < 0 || ev.extra > 15)) { err.textContent = T("result.err.stoppage"); return; }
          if (!ev.player_id) { err.textContent = T("result.err.player"); return; } if (ev.type === "sub" && !ev.related_id) { err.textContent = T("result.err.sub_in"); return; }
          events.push(ev); mo.close(); drawEvents(); drawScore();
        } } }, T("result.add")))], { label: T("result.add_event") });
      draw();
    }
    const summary = el("textarea", { class: "textarea", rows: "3", maxlength: "500", "aria-label": T("result.summary") }); const saveBtn = el("button", { type: "button", class: "btn btn-primary btn-block", on: { click: save } }, icon("check", { size: 20 }), T("result.save"));
    async function save() {
      errBox.hidden = true; const payload = events.map(toPayload), errs = O.validateEvents(payload, { homeTeamId: d.home.id, awayTeamId: d.away.id });
      const show = (msg) => { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ block: "center" }); };
      if (errs.length) return show(T("result.err.row", { n: errs[0].index }) + " " + T(errs[0].key));
      const rep = O.buildReport({ home_team_id: d.home.id, away_team_id: d.away.id }, payload, lineups()), on = new Set(rep.appearances.map((a) => a.player_id));
      for (const [i, e] of payload.entries()) { if (!on.has(e.player_id)) return show(T("result.err.row", { n: i + 1 }) + " " + T("result.err.not_playing", { name: nm(e.player_id) })); if (e.event_type === "sub" && !on.has(e.related_player_id)) return show(T("result.err.row", { n: i + 1 }) + " " + T("result.err.sub_bench", { name: nm(e.related_player_id) })); if (e.event_type === "goal" && e.related_player_id && !on.has(e.related_player_id)) return show(T("result.err.row", { n: i + 1 }) + " " + T("result.err.not_playing", { name: nm(e.related_player_id) })); }
      if (!(await E.ui.confirm({ title: T("result.confirm", { h: d.home.short_name, a: d.away.short_name, hs: rep.score.home, as: rep.score.away }), text: m.status === "finished" ? T("result.confirm.edit") : T("result.confirm.text"), confirmLabel: T("result.save") }))) return;
      try { await E.ui.busy(saveBtn, () => E.api.rpc("submit_match_report", { p_match_id: id, p_events: payload, p_summary: summary.value.trim() || null, p_referee_home: null, p_referee_away: null, p_appearances: rep.appearances, p_ovr_rows: rep.ovr_rows })); E.ui.toast(T("result.saved"), "ok"); E.router.go("/match/" + id, { replace: true }); }
      catch (e) { show(/^INVALID_EVENTS/.test(e.message || "") ? T("result.err.server") : E.api.errorText(e)); }
    }
    ctx.page.appendChild(wrap(back(T("result.title"), "/match/" + id), el("section", { class: "mh" }, el("div", { class: "row", style: { justifyContent: "center" } }, el("span", { class: "badge", text: T("match.matchday", { n: m.matchday || 0 }) })),
      el("div", { class: "teams" }, el("div", { class: "tm" }, L.logo(d.home, "md"), el("span", { class: "n", text: d.home.name })), scoreNode, el("div", { class: "tm" }, L.logo(d.away, "md"), el("span", { class: "n", text: d.away.name }))), el("p", { class: "tiny faint", text: T("result.auto_score") })),
      startBox, el("section", { class: "card stack" }, el("div", { class: "row" }, el("h2", { style: { flex: 1 }, text: T("result.events") }), el("button", { type: "button", class: "btn btn-sm btn-primary", on: { click: eventSheet } }, icon("plus", { size: 20 }), T("result.add_event"))), evBox),
      el("section", { class: "card stack" }, el("div", { class: "field" }, el("label", { text: T("result.summary") + " " + T("profile.optional") }), summary)), errBox, saveBtn));
    drawScore(); drawStarters(); drawEvents();
  }, Object.assign({ titleKey: "result.title" }, A));
})(window);
