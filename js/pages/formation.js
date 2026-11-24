/* Formation: public view (team page + match page) and the captain's editor (tap or drag; works with mouse and touch). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, FM = E.formations, P = E.pitch, T = (k, v) => E.t(k, v), S = E.session;
  const person = (r) => ({ id: r.player_id || r.id, full_name: r.full_name, nickname: r.nickname, display_name: r.display_name, photo_url: r.photo_url, ovr: r.ovr, main_position: r.main_position, secondary_position: r.secondary_position, jersey_number: r.jersey_number });

  /* ---------- read-only views ---------- */
  function benchStrip(people, jerseys) {
    return el("div", { class: "bench-strip", role: "list", "aria-label": T("formation.bench") }, people.map((p) => el("div", { role: "listitem", style: { display: "contents" } }, P.card(p, { link: true, role: p.main_position }))));
  }
  function readonly(o) {      // { formation, slots, people:Map, captainId, bench:[person], note }
    return el("div", { class: "stack" }, el("div", { class: "row wrap" }, el("span", { class: "badge", text: o.formation }), o.note ? el("span", { class: "small muted", text: o.note }) : null),
      P.view({ formation: o.formation, slots: o.slots, people: o.people, captainId: o.captainId, editable: false }),
      o.bench.length ? el("div", { class: "stack", style: { gap: "2px" } }, el("h3", { text: T("formation.bench") }), benchStrip(o.bench)) : null);
  }
  function fromTeamFormation(tf, note) {
    const people = new Map(), slots = new Array(11).fill(null);
    for (const s of tf.starters) { people.set(s.player.id, s.player); slots[s.slot] = s.player.id; }
    return { formation: tf.formation, slots, people, captainId: tf.captain_id, bench: tf.bench.filter(Boolean), note };
  }
  /* match page: the lineup of one side (replaces the plain list of Stage 6) */
  E.league.lineupView = function (detail, side) {
    const team = detail[side], lu = detail.lineups.find((l) => l.team_id === team.id), tf = detail.team_formations.find((f) => f && f.team_id === team.id);
    if (lu) {
      const st = lu.players.filter((x) => x.is_starter), bn = lu.players.filter((x) => !x.is_starter), people = new Map(), slots = new Array(11).fill(null);
      for (const x of lu.players) people.set(x.player.id, Object.assign({}, x.player, { jersey_number: x.jersey_number }));
      if (st.length && st.every((x) => x.slot != null)) st.forEach((x) => { slots[x.slot] = x.player.id; });
      else FM.assignByRole(lu.formation, st.map((x) => ({ id: x.player.id, pos: x.position || x.player.main_position }))).forEach((id, i) => { slots[i] = id; });
      return readonly({ formation: lu.formation, slots, people, captainId: lu.captain_id || (lu.players.find((x) => x.is_captain) || { player: {} }).player.id, bench: bn.map((x) => people.get(x.player.id)) });
    }
    if (tf && tf.starters.length) return readonly(Object.assign(fromTeamFormation(tf), { note: T("lineup.team_default") }));
    return E.ui.empty("shirt", T("lineup.none.title"), T("lineup.none.text"));
  };

  /* team page: formation section (everyone sees it) */
  E.bus.on("team-page", async ({ page, team, ctx }) => {
    const slot = page.querySelector("#formation-slot"); if (!slot) return;
    const canEdit = S.isCaptainOf(team.team_id) || S.isSuper;
    slot.appendChild(E.ui.skeletonRows(1, 220));
    let tf; try { tf = await E.api.rpc("team_formation_public", { p_team: team.team_id }); } catch (e) { if (ctx.isCurrent()) slot.replaceChildren(E.ui.errorState(e)); return; }
    if (!ctx.isCurrent()) return;
    const head = el("div", { class: "section-title", style: { margin: "6px 0 10px" } }, el("h2", { text: T("formation.title") }), canEdit ? el("a", { class: "btn btn-sm btn-primary", href: "#/team/" + team.team_id + "/formation" }, icon("pencil", { size: 20 }), T("formation.edit")) : null);
    slot.replaceChildren(head, tf && tf.starters.length ? readonly(fromTeamFormation(tf)) : E.ui.empty("shirt", T("formation.none.title"), canEdit ? T("formation.none.captain") : T("formation.none.text")));
  });

  /* ---------- editor ---------- */
  E.router.add("/team/:id/formation", async (ctx) => {
    const id = ctx.params.id, matchId = ctx.query.match || null, matchMode = !!matchId;
    ctx.page.appendChild(E.ui.skeletonRows(3, 160));
    let ov, ros, tf, md = null;
    try { [ov, ros, tf, md] = await Promise.all([E.api.rpc("teams_overview"), E.api.rpc("team_roster", { p_team: id }), E.api.rpc("team_formation_public", { p_team: id }), matchMode ? E.api.rpc("match_detail", { p_match: matchId }) : null]); }
    catch (e) { if (ctx.isCurrent()) ctx.page.replaceChildren(E.ui.errorState(e, () => E.router.render())); return; }
    if (!ctx.isCurrent()) return; ctx.page.replaceChildren();
    const team = ov.find((t) => t.team_id === id);
    if (!team) { ctx.page.appendChild(E.ui.empty("users", T("err.team_not_found"))); return; }
    if (!(S.isSuper || S.isCaptainOf(id))) { ctx.page.appendChild(E.ui.empty("lock", T("forbidden.title"), T("formation.forbidden"))); return; }
    if (matchMode && (!md || (md.match.home_team_id !== id && md.match.away_team_id !== id))) { ctx.page.appendChild(E.ui.empty("calendar", T("match.not_found"))); return; }
    if (matchMode && md.match.status !== "scheduled") { ctx.page.appendChild(E.ui.empty("lock", T("formation.locked"))); return; }

    const roster = ros.map(person), people = new Map(roster.map((p) => [p.id, p])), limit = matchMode ? 7 : 12;
    let formation = "4-3-3", slots = new Array(11).fill(null), bench = [], captainId = null, sel = null, query = "", dirty = false;
    const lu = matchMode ? md.lineups.find((l) => l.team_id === id) : null;
    if (lu) {
      formation = lu.formation; const st = lu.players.filter((x) => x.is_starter && people.has(x.player.id));
      if (st.every((x) => x.slot != null)) st.forEach((x) => { slots[x.slot] = x.player.id; }); else FM.assignByRole(formation, st.map((x) => ({ id: x.player.id, pos: x.position }))).forEach((v, i) => { slots[i] = v; });
      bench = lu.players.filter((x) => !x.is_starter && people.has(x.player.id)).map((x) => x.player.id); captainId = (lu.players.find((x) => x.is_captain) || { player: {} }).player.id || null;
    } else if (tf && tf.starters.length) {
      formation = tf.formation; tf.starters.forEach((s) => { if (people.has(s.player.id) && s.slot >= 0 && s.slot < 11) slots[s.slot] = s.player.id; }); bench = (tf.bench || []).filter((p) => p && people.has(p.id)).map((p) => p.id); captainId = tf.captain_id;
    }
    if (captainId && !people.has(captainId)) captainId = null;
    bench = bench.filter((x) => !slots.includes(x)).slice(0, limit);

    const pitchHost = el("div"), benchHost = el("div"), squadHost = el("div", { class: "card list", style: { padding: "4px 8px" } }), barHost = el("div"), formsHost = el("div", { class: "fm-forms", role: "radiogroup", "aria-label": T("formation.title") }), counter = el("span", { class: "badge" }), dirtyBadge = el("span", { class: "badge badge-muted", hidden: true, text: T("formation.unsaved") });
    const onPitch = () => slots.filter(Boolean), inSquad = (pid) => slots.includes(pid) || bench.includes(pid);
    const mark = () => { dirty = true; dirtyBadge.hidden = false; };
    const setSlots = (ns) => { const prev = slots.filter(Boolean); slots = ns; const now = slots.filter(Boolean);
      bench = bench.filter((x) => !now.includes(x)); for (const pid of prev) if (!now.includes(pid) && bench.length < limit && !bench.includes(pid)) bench.push(pid); mark(); };
    const toggleBench = (pid) => { if (slots.includes(pid)) return; if (bench.includes(pid)) bench = bench.filter((x) => x !== pid); else if (bench.length < limit) bench.push(pid); else return E.ui.toast(T("formation.bench_full", { n: limit }), "err"); if (captainId === pid && !inSquad(pid)) captainId = null; mark(); draw(); };
    function tapSlot(i) {
      if (sel && sel.kind === "player") { setSlots(FM.place(slots, sel.id, i)); sel = null; }
      else if (sel && sel.kind === "slot") { if (sel.i === i) sel = null; else { setSlots(FM.swapSlots(slots, sel.i, i)); sel = null; } }
      else sel = { kind: "slot", i };
      draw();
    }
    function tapPlayer(pid) {
      if (sel && sel.kind === "slot") { setSlots(FM.place(slots, pid, sel.i)); sel = null; } else sel = sel && sel.kind === "player" && sel.id === pid ? null : { kind: "player", id: pid };
      draw();
    }
    function dropped(src, tgt) {
      if (tgt.bench) { if (src.from != null) { setSlots(FM.removeFromPitch(slots, src.playerId)); } else if (!bench.includes(src.playerId)) toggleBench(src.playerId); sel = null; draw(); return; }
      setSlots(FM.place(slots, src.playerId, tgt.slot)); sel = null; draw();
    }
    const nameOf = (pid) => E.u.nameOf(people.get(pid));

    function drawForms() { formsHost.replaceChildren(...FM.ORDER.map((f) => el("button", { type: "button", class: "chip", role: "radio", "aria-checked": String(f === formation), "aria-pressed": String(f === formation), style: { flex: "none" }, on: { click: () => { if (f === formation) return; slots = FM.reassign(f, formation, slots); formation = f; mark(); sel = null; draw(); } } }, f))); }
    function drawBar() {
      barHost.replaceChildren(); if (!sel) return;
      const pid = sel.kind === "player" ? sel.id : slots[sel.i], p = pid && people.get(pid);
      const cancel = el("button", { type: "button", class: "btn btn-sm", on: { click: () => { sel = null; draw(); } } }, T("formation.cancel"));
      if (!p) { barHost.appendChild(el("div", { class: "fm-bar", role: "status" }, el("span", { class: "grow", style: { flex: 1 }, text: T("formation.select_hint") }), cancel)); return; }
      barHost.appendChild(el("div", { class: "fm-bar", role: "status" }, el("strong", { class: "grow", style: { flex: 1, minWidth: "120px" }, text: E.u.nameOf(p) }),
        el("button", { type: "button", class: "btn btn-sm" + (captainId === pid ? " btn-primary" : ""), "aria-pressed": String(captainId === pid), on: { click: () => { captainId = captainId === pid ? null : pid; mark(); draw(); } } }, icon("crown", { size: 20 }), T("formation.make_captain")),
        slots.includes(pid) ? el("button", { type: "button", class: "btn btn-sm btn-danger", on: { click: () => { setSlots(FM.removeFromPitch(slots, pid)); sel = null; draw(); } } }, icon("x", { size: 20 }), T("formation.remove_pitch")) : null, cancel));
    }
    function drawSquad() {
      const q = E.u.norm(query), rows = roster.filter((p) => !q || E.u.norm(E.u.nameOf(p) + " " + (p.nickname || "")).includes(q));
      squadHost.replaceChildren(...(rows.length ? rows.map((p) => {
        const on = slots.includes(p.id), bn = bench.includes(p.id), selected = sel && sel.kind === "player" && sel.id === p.id;
        return el("div", { class: "squad-row", role: "option", "aria-selected": String(!!selected), "data-drag": p.id, "data-longpress": "1", tabindex: "0", on: { click: () => tapPlayer(p.id), keydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapPlayer(p.id); } } } },
          E.ui.avatar(p, "md"), el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" } }, E.u.highlight(E.u.nameOf(p), query), captainId === p.id ? icon("crown", { size: 20, class: "inl" }) : null),
            el("div", { class: "small muted" }, p.main_position ? T("pos." + p.main_position) : "", p.nickname ? " · “" + p.nickname + "”" : "")),
          on ? el("span", { class: "badge", text: T("formation.on_pitch") }) : bn ? el("span", { class: "badge badge-muted", text: T("formation.sub") }) : null, el("span", { class: "badge badge-muted", text: String(p.ovr) }),
          !on ? E.u.iconBtn(bn ? "check" : "plus", bn ? T("formation.remove_sub") : T("formation.add_sub"), (e) => { e.stopPropagation(); toggleBench(p.id); }) : null);
      }) : [E.ui.empty("search", T("formation.no_players"))]));
    }
    function drawBench() {
      benchHost.replaceChildren(el("div", { class: "row" }, el("h3", { style: { flex: 1 }, text: T("formation.bench") }), el("span", { class: "tiny faint", text: bench.length + "/" + limit })),
        el("div", { class: "bench-strip", "data-drop": "bench", role: "list" }, bench.length ? bench.map((pid) => el("div", { role: "listitem", style: { display: "contents" } }, P.card(people.get(pid), { drag: true, longpress: true, role: people.get(pid).main_position, captain: captainId === pid, selected: sel && sel.kind === "player" && sel.id === pid }))) : [el("p", { class: "small muted", style: { padding: "10px 4px" }, text: T("formation.bench.empty") })]));
      benchHost.querySelectorAll(".pcard").forEach((c) => c.addEventListener("click", () => tapPlayer(c.dataset.drag)));
    }
    function draw() {
      pitchHost.replaceChildren(P.view({ formation, slots, people, captainId, selected: sel && sel.kind === "slot" ? sel.i : null, editable: true, onSlot: tapSlot }));
      const n = onPitch().length; counter.textContent = T("formation.starters_count", { n }); counter.className = "badge " + (n === 11 ? "" : "badge-muted");
      drawForms(); drawBench(); drawSquad(); drawBar();
    }

    const toast = (k, v) => E.ui.toast(T(k, v), "err");
    async function save() {
      const n = onPitch().length;
      if (matchMode && n !== 11) return toast("formation.err.starters");
      if (n === 0) return toast("formation.err.empty");
      if (captainId && !inSquad(captainId)) captainId = null;
      const L = FM.layout(formation);
      try {
        if (matchMode) {
          const players = slots.map((pid, i) => pid && { player_id: pid, jersey_number: null, match_position: L[i].role, is_starter: true, is_captain: captainId === pid, is_vice_captain: false, slot: i }).filter(Boolean)
            .concat(bench.map((pid) => ({ player_id: pid, jersey_number: null, match_position: people.get(pid).main_position || "midfielder", is_starter: false, is_captain: captainId === pid, is_vice_captain: false, slot: null })));
          await E.ui.busy(saveBtn, () => E.api.rpc("save_lineup", { p_match_id: matchId, p_team_id: id, p_formation: formation, p_captain_id: captainId, p_vice_captain_id: null, p_tactics: null, p_players: players }));
        } else await E.ui.busy(saveBtn, () => E.api.rpc("save_team_formation", { p_team: id, p_formation: formation, p_starters: slots.map((pid, i) => pid && { slot: i, player_id: pid }).filter(Boolean), p_bench: bench.slice(0, 12), p_captain: captainId }));
        dirty = false; E.ui.toast(matchMode ? T("formation.saved_match") : T("formation.saved"), "ok"); E.router.go(matchMode ? "/match/" + matchId : "/team/" + id, { replace: true });
      } catch (e) { E.ui.toast(e.code === "INVALID_LINEUP" ? T("formation.err.server") : E.api.errorText(e), "err"); }
    }
    const saveBtn = el("button", { type: "button", class: "btn btn-primary", on: { click: save } }, icon("check", { size: 20 }), T("common.save"));
    const search = el("input", { class: "input", type: "search", autocomplete: "off", spellcheck: "false", placeholder: T("formation.search"), "aria-label": T("formation.search"), on: { input: E.u.debounce((e) => { query = e.target.value; drawSquad(); }, 120) } });
    const title = matchMode ? T("formation.match_title", { h: md.home.short_name, a: md.away.short_name }) : T("formation.team_title", { team: team.name });
    const tools = el("div", { class: "fm-tools" },
      el("button", { type: "button", class: "btn btn-sm", on: { click: () => { slots = FM.autoFill(formation, roster); bench = roster.filter((p) => !slots.includes(p.id)).sort((a, b) => b.ovr - a.ovr).slice(0, limit).map((p) => p.id); sel = null; mark(); draw(); } } }, icon("zap", { size: 20 }), T("formation.autofill")),
      el("button", { type: "button", class: "btn btn-sm", on: { click: () => { setSlots(new Array(11).fill(null)); sel = null; draw(); } } }, icon("trash-2", { size: 20 }), T("formation.clear")), counter, dirtyBadge, el("span", { class: "spacer" }), saveBtn);
    const stop = P.enableDrag(ctx.page, dropped);
    ctx.page.appendChild(el("div", { class: "stack", style: { gap: "14px" } },
      el("div", { class: "page-head" }, E.u.iconBtn("arrow-left", T("common.back"), () => E.router.back(matchMode ? "/match/" + matchId : "/team/" + id), { class: "icon-flip" }), el("h1", { text: title })),
      matchMode ? el("p", { class: "muted small", text: T("formation.match_note") }) : null,
      el("div", { class: "fm-grid" }, el("div", { class: "pitch-col stack" }, formsHost, tools, pitchHost, benchHost, el("p", { class: "tiny faint", text: T("formation.hint") })),
        el("div", { class: "stack" }, el("h2", { text: T("formation.squad") }), search, squadHost)), barHost));
    draw();
    return () => stop();
  }, { auth: true, titleKey: "formation.title" });
})(window);
