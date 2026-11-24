/* ESST core: player picker (live search, accent-insensitive on the server, keyboard + touch). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k, v) => E.t(k, v);
  function player(o) {
    o = o || {};
    return new Promise((resolve) => {
      let seq = 0, rows = [], active = -1, m;
      const list = el("div", { class: "list", role: "listbox", id: "picker-list", "aria-label": T("picker.title") }), live = el("div", { class: "sr-only", "aria-live": "polite" });
      const input = el("input", { class: "input", type: "search", role: "combobox", "aria-controls": "picker-list", "aria-expanded": "true", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: T("picker.search"), "aria-label": T("picker.search"), autofocus: true });
      const choose = (r) => { m.close(r); };
      const setActive = (i) => { active = i; Array.from(list.children).forEach((c, k) => { c.setAttribute("aria-selected", String(k === i)); c.classList.toggle("on", k === i); if (k === i) { input.setAttribute("aria-activedescendant", c.id); c.scrollIntoView({ block: "nearest" }); } }); };
      function paint(q) {
        list.replaceChildren(); active = -1; input.removeAttribute("aria-activedescendant");
        if (!rows.length) { list.appendChild(E.ui.empty("search", T("picker.empty"))); live.textContent = T("picker.empty"); return; }
        rows.forEach((r, i) => list.appendChild(el("button", { type: "button", class: "list-row", role: "option", id: "po-" + i, "aria-selected": "false", style: { width: "100%", textAlign: "start", background: "none", border: 0, color: "inherit", minHeight: "60px" }, on: { click: () => choose(r) } },
          E.ui.avatar(r, "md"), el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" } }, E.u.highlight(E.u.nameOf(r), q)),
            el("div", { class: "small muted ellipsis" }, r.nickname ? el("span", {}, "“", E.u.highlight(r.nickname, q), "” · ") : null, r.main_position ? T("pos." + r.main_position) : "", r.team_name ? " · " + r.team_name : "")),
          el("span", { class: "badge", text: String(r.ovr) }))));
        live.textContent = String(rows.length);
      }
      async function run() {
        const my = ++seq, q = input.value; list.replaceChildren(E.ui.skeletonRows(3, 60));
        try { const r = await E.api.rpc("search_players", { p_q: q, p_limit: 20 }); if (my !== seq) return; rows = o.filter ? r.filter(o.filter) : r; paint(q); }
        catch (e) { if (my === seq) list.replaceChildren(E.ui.errorState(e, run)); }
      }
      const deb = E.u.debounce(run, 250);
      input.addEventListener("input", deb);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); if (rows.length) setActive((active + 1) % rows.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); if (rows.length) setActive((active - 1 + rows.length) % rows.length); }
        else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) choose(rows[active]); else if (rows.length === 1) choose(rows[0]); }
      });
      m = E.ui.modal([el("h2", { text: o.title || T("picker.title") }), el("div", { class: "stack", style: { marginTop: "10px" } }, input, live, list),
        el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close(null) } }, T("common.cancel")))], { label: o.title || T("picker.title"), onClose: (r) => resolve(r || null) });
      run();
    });
  }
  E.pickers = { player };
})(window);
