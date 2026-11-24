/* Player search: live suggestions while typing (debounced), accent / case / Arabic-variant insensitive (done by the database),
   filters by position and team, keyboard (arrows, Enter, Esc, "/") and touch. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, L = E.league, T = (k, v) => E.t(k, v), N = (n) => E.i18n.number(n);
  const POS = ["goalkeeper", "defender", "midfielder", "forward"], RKEY = "esst.recent", LIMIT = 30;
  const recent = {
    get() { try { return JSON.parse(E.api.store.get(RKEY) || "[]"); } catch (_) { return []; } },
    add(r) { const x = { player_id: r.player_id, full_name: r.full_name, nickname: r.nickname, display_name: r.display_name, photo_url: r.photo_url, main_position: r.main_position, ovr: r.ovr, team_name: r.team_name }; E.api.store.set(RKEY, JSON.stringify([x].concat(recent.get().filter((y) => y.player_id !== x.player_id)).slice(0, 6))); },
    clear() { E.api.store.remove(RKEY); },
  };

  /* one result row (also used for "recent"). q = text to highlight */
  function row(r, i, q) {
    const name = E.u.nameOf(r);
    return el("a", { class: "search-row", role: "option", id: "sr-" + i, "aria-selected": "false", href: "#/player/" + r.player_id, on: { click: () => recent.add(r) } },
      E.ui.avatar(r, "md"),
      el("div", { class: "grow" }, el("div", { class: "search-name", dir: "auto" }, E.u.highlight(name, q)), r.nickname ? el("div", { class: "search-nick", dir: "auto" }, "“", E.u.highlight(r.nickname, q), "”") : null,
        el("div", { class: "search-meta" }, r.main_position ? el("span", { class: "badge" }, T("pos.short." + r.main_position) + " · " + T("pos." + r.main_position)) : null,
          r.team_name ? el("span", { class: "tm" }, r.team_logo !== undefined ? L.logo({ logo_url: r.team_logo, name: r.team_name }, "sm") : null, r.team_name) : el("span", { class: "badge badge-muted", text: T("profile.no_team") }))),
      el("span", { class: "rate", "aria-label": T("profile.card.ovr") + " " + r.ovr, text: String(r.ovr) }));
  }

  E.router.add("/search", async (ctx) => {
    let q = ctx.query.q || "", pos = POS.includes(ctx.query.pos) ? ctx.query.pos : "", team = ctx.query.team || "", results = [], active = -1, seq = 0, first = true;
    let teams = new Map(); try { teams = await L.teams(); } catch (_) {}
    if (!ctx.isCurrent()) return;
    const input = el("input", { class: "input search-input", type: "search", dir: "auto", role: "combobox", "aria-expanded": "true", "aria-controls": "search-list", "aria-autocomplete": "list", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "search", placeholder: T("search.placeholder"), "aria-label": T("search.placeholder"), value: q });
    const clearBtn = E.u.iconBtn("x", T("search.clear"), () => { input.value = ""; q = ""; active = -1; input.focus(); sync(); run(); }); clearBtn.hidden = !q;
    const posBox = el("div", { class: "row", role: "radiogroup", "aria-label": T("search.position"), style: { gap: "8px", flexWrap: "nowrap" } });
    const teamSel = el("select", { class: "select", "aria-label": T("search.team") }, el("option", { value: "", text: T("search.team_all") }), ...[...teams.values()].filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name)).map((t) => el("option", { value: t.team_id, text: t.name })));
    teamSel.value = [...teams.keys()].includes(team) ? team : (team = "");
    const count = el("span", { "aria-live": "polite" }), list = el("div", { class: "search-list", role: "listbox", id: "search-list", "aria-label": T("search.title") }), recentBox = el("div"), hint = el("p", { class: "search-hint", hidden: true });
    const drawPos = () => posBox.replaceChildren(...[["", T("search.all")]].concat(POS.map((p) => [p, T("pos." + p)])).map(([v, label]) => el("button", { type: "button", class: "chip", role: "radio", "aria-checked": String(pos === v), "aria-pressed": String(pos === v), on: { click: () => { pos = v; drawPos(); sync(); run(); } } }, label)));
    const filtered = () => !!(q.trim() || pos || team);
    function sync() { clearBtn.hidden = !input.value; const p = new URLSearchParams(); if (q.trim()) p.set("q", q.trim()); if (pos) p.set("pos", pos); if (team) p.set("team", team); history.replaceState(null, "", "#/search" + (p.toString() ? "?" + p : "")); }
    function setActive(i) { active = i; Array.from(list.children).forEach((c, k) => { const on = k === i; c.setAttribute("aria-selected", String(on)); c.classList.toggle("on", on); if (on) { input.setAttribute("aria-activedescendant", c.id); c.scrollIntoView({ block: "nearest" }); } }); if (i < 0) input.removeAttribute("aria-activedescendant"); }
    function drawRecent() {
      recentBox.replaceChildren(); const rc = recent.get(); if (filtered() || !rc.length) return;
      recentBox.append(el("div", { class: "recent-head" }, el("h2", { text: T("search.recent") }), el("button", { type: "button", class: "btn btn-ghost btn-sm", on: { click: () => { recent.clear(); drawRecent(); } } }, T("search.recent.clear"))), el("div", { class: "search-list", role: "list" }, rc.map((r, i) => row(r, "r" + i, ""))));
    }
    function paint(rows) {
      results = rows; list.classList.remove("loading"); list.replaceChildren(); active = -1; input.removeAttribute("aria-activedescendant"); hint.hidden = true;
      if (!rows.length) {
        const clear = el("button", { type: "button", class: "btn", on: { click: () => { input.value = ""; q = ""; pos = ""; team = ""; teamSel.value = ""; drawPos(); sync(); run(); input.focus(); } } }, icon("x", { size: 20 }), T("search.clear_filters"));
        list.appendChild(E.ui.empty("search", q.trim() ? T("search.empty.q", { q: q.trim() }) : T("search.empty.title"), T("search.empty.text"), filtered() ? clear : null)); count.textContent = T("search.empty.title"); return;
      }
      rows.forEach((r, i) => list.appendChild(row(r, i, q)));
      count.textContent = filtered() ? (rows.length === 1 ? T("search.count_one") : T("search.count", { n: N(rows.length) })) : T("search.top");
      if (rows.length >= LIMIT) { hint.textContent = T("search.limit", { n: LIMIT }); hint.hidden = false; }
    }
    async function run() {
      const my = ++seq; if (first) { list.replaceChildren(E.ui.skeletonRows(5, 68)); first = false; } else list.classList.add("loading");
      drawRecent();
      try { const rows = await E.api.rpc("search_players", { p_q: q.trim(), p_team: team || null, p_position: pos || null, p_limit: LIMIT }); if (my !== seq || !ctx.isCurrent()) return; paint(rows); }
      catch (e) { if (my !== seq || !ctx.isCurrent()) return; list.classList.remove("loading"); list.replaceChildren(E.ui.errorState(e, run)); count.textContent = ""; }
    }
    const debounced = E.u.debounce(run, 220);
    input.addEventListener("input", () => { q = input.value; sync(); debounced(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (results.length) setActive(active < results.length - 1 ? active + 1 : 0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (results.length) setActive(active > 0 ? active - 1 : results.length - 1); }
      else if (e.key === "Home" && active >= 0) { e.preventDefault(); setActive(0); } else if (e.key === "End" && active >= 0) { e.preventDefault(); setActive(results.length - 1); }
      else if (e.key === "Enter") { e.preventDefault(); const i = active >= 0 ? active : results.length === 1 ? 0 : -1; if (i >= 0) { recent.add(results[i]); E.router.go("/player/" + results[i].player_id); } }
      else if (e.key === "Escape") { if (input.value) { e.preventDefault(); input.value = ""; q = ""; sync(); clearBtn.hidden = true; debounced.cancel(); run(); } else input.blur(); }
    });
    teamSel.addEventListener("change", () => { team = teamSel.value; sync(); run(); });
    const slash = (e) => { if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.querySelector(".overlay")) { e.preventDefault(); input.focus(); input.select(); } };
    document.addEventListener("keydown", slash);
    ctx.page.append(el("div", { class: "search-top" }, el("div", { class: "search-box" }, el("span", { class: "lead" }, icon("search")), input, clearBtn), el("div", { class: "filters" }, posBox, teamSel)),
      recentBox, el("div", { class: "search-count" }, el("span", {}), count), list, hint);
    drawPos(); run(); if (!("ontouchstart" in g) || !q) input.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", slash);
  }, { titleKey: "search.title" });
})(window);
