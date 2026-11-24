/* ESST core: the pitch (drawn with SVG lines), FIFA-style player cards and drag & drop (mouse + touch).
   Tapping always works too: tap a slot then a player (or two slots to swap). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, FM = E.formations, T = (k, v) => E.t(k, v), SVGNS = "http://www.w3.org/2000/svg";

  function lines() {
    const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("viewBox", "0 0 100 136"); s.setAttribute("class", "pitch-lines"); s.setAttribute("preserveAspectRatio", "none"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<rect x="4" y="4" width="92" height="128" rx="1"/><line x1="4" y1="68" x2="96" y2="68"/><circle cx="50" cy="68" r="12"/><circle class="dot" cx="50" cy="68" r="1"/>' +
      '<rect x="24" y="4" width="52" height="20"/><rect x="38" y="4" width="24" height="8"/><circle class="dot" cx="50" cy="18" r="0.9"/><path d="M40 24 A12 12 0 0 0 60 24"/>' +
      '<rect x="24" y="112" width="52" height="20"/><rect x="38" y="124" width="24" height="8"/><circle class="dot" cx="50" cy="118" r="0.9"/><path d="M40 112 A12 12 0 0 1 60 112"/>' +
      '<path d="M4 7 A3 3 0 0 0 7 4"/><path d="M93 4 A3 3 0 0 0 96 7"/><path d="M4 129 A3 3 0 0 1 7 132"/><path d="M93 132 A3 3 0 0 1 96 129"/>';
    return s;
  }
  const posCode = (p) => (p ? T("pos.short." + p) : "");

  /* one player on the pitch. o.link: read-only (opens the profile), otherwise a button */
  function card(p, o) {
    o = o || {}; const nm = E.u.nameOf(p), tag = o.link ? "a" : "button";
    const a = el("span", { class: "pa" }, p.photo_url ? el("img", { src: E.api.mediaUrl(p.photo_url), alt: "", loading: "lazy", decoding: "async", draggable: "false", on: { error: (e) => { e.target.remove(); a.firstChild ? 0 : (a.textContent = E.u.initials(nm)); } } }) : E.u.initials(nm),
      p.ovr != null ? el("span", { class: "ovr", text: String(p.ovr) }) : null, o.captain ? el("span", { class: "cap", title: T("formation.captain"), "aria-hidden": "true" }, icon("crown", { size: 20 })) : null);
    const attrs = { class: "pcard" + (o.cls ? " " + o.cls : ""), "aria-label": nm + ", " + (o.role ? posCode(o.role) + ", " : "") + (p.ovr != null ? T("profile.card.ovr") + " " + p.ovr : "") + (o.captain ? ", " + T("formation.captain") : "") };
    if (o.link) { attrs.href = "#/player/" + p.id; } else { attrs.type = "button"; attrs["aria-pressed"] = o.selected ? "true" : "false"; }
    if (o.drag) { attrs["data-drag"] = p.id; if (o.from != null) attrs["data-from"] = o.from; if (o.longpress) attrs["data-longpress"] = "1"; }
    return el(tag, attrs, a, el("span", { class: "nm", text: FM.shortName(p) }), o.role ? el("span", { class: "ps", text: posCode(o.role) }) : null);
  }

  /* o: { formation, slots:[id|null x11], people: Map id->person, captainId, selected: slotIndex|null, editable, onSlot(i) } */
  function view(o) {
    const L = FM.layout(o.formation), root = el("div", { class: "pitch", role: "group", "aria-label": T("formation.title") + " " + o.formation }, lines());
    for (const s of L) {
      const id = o.slots[s.slot], p = id && o.people.get(id), cell = el("div", { class: "pslot" + (o.selected === s.slot ? " sel" : ""), "data-slot": String(s.slot), style: { left: s.x + "%", top: s.y + "%" } });
      if (p) cell.appendChild(card(p, { role: s.role, captain: o.captainId === p.id, selected: o.selected === s.slot, link: !o.editable, drag: o.editable, from: s.slot, cls: "", }));
      else cell.appendChild(el("button", { type: "button", class: "pempty", "aria-label": T("formation.empty_slot") + " " + posCode(s.role), on: o.editable ? { click: () => o.onSlot && o.onSlot(s.slot) } : null, disabled: !o.editable }, el("span", { class: "pa" }, icon("plus", { size: 20 })), el("span", { class: "ps", text: posCode(s.role) })));
      if (p && o.editable) cell.firstChild.addEventListener("click", () => o.onSlot && o.onSlot(s.slot));
      root.appendChild(cell);
    }
    return root;
  }

  /* ---- drag & drop. Draggables: [data-drag=playerId] (+ data-from=slot). Targets: [data-slot] and [data-drop="bench"].
     Mouse: starts after 6px. Touch: pitch cards drag at once (touch-action: none); list rows need a 260 ms long press so scrolling still works. ---- */
  function enableDrag(root, onDrop) {
    let st = null;
    const ghostFor = (t) => { const img = t.querySelector("img"), g2 = el("div", { class: "drag-ghost" }, el("span", { class: "pa" }, img ? el("img", { src: img.src, alt: "" }) : (t.querySelector(".pa") ? t.querySelector(".pa").textContent.replace(/\d+/g, "").trim() || "?" : "?")), el("span", { class: "nm", style: { background: "rgba(5,6,5,.72)", padding: "1px 6px", borderRadius: "6px", fontSize: ".72rem", fontWeight: "800" }, text: (t.querySelector(".nm") || t).textContent.slice(0, 14) })); return g2; };
    function targetAt(x, y) { const n = document.elementFromPoint(x, y); if (!n) return null; const sl = n.closest("[data-slot]"); if (sl && root.contains(sl)) return { slot: +sl.dataset.slot, el: sl }; const bn = n.closest('[data-drop="bench"]'); return bn && root.contains(bn) ? { bench: true, el: bn } : null; }
    function mark(t) { root.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); if (t) t.el.classList.add("over"); }
    let raf = 0;
    const autoscroll = () => { raf = 0; if (!st || !st.active) return; const h = g.innerHeight, top = 130, bottom = h - 90; let dy = 0;
      if (st.y < top) dy = -Math.ceil((top - st.y) / 5); else if (st.y > bottom) dy = Math.ceil((st.y - bottom) / 5);
      if (dy) { g.scrollBy(0, dy); mark(targetAt(st.x, st.y)); } raf = requestAnimationFrame(autoscroll); };
    const stopTouchScroll = (e) => { if (st && st.active && e.cancelable) e.preventDefault(); };
    document.addEventListener("touchmove", stopTouchScroll, { passive: false });
    function start() { st.active = true; raf = requestAnimationFrame(autoscroll); st.ghost = ghostFor(st.el); document.body.appendChild(st.ghost); st.el.classList.add("dragging"); document.body.style.userSelect = "none"; document.body.style.webkitUserSelect = "none"; place(st.x, st.y); if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {} }
    const place = (x, y) => { if (st.ghost) st.ghost.style.transform = "translate(" + (x - 32) + "px," + (y - 44) + "px)"; };
    function move(e) {
      if (!st || e.pointerId !== st.pid) return; const dx = e.clientX - st.sx, dy = e.clientY - st.sy, d = Math.hypot(dx, dy); st.x = e.clientX; st.y = e.clientY;
      if (!st.active) { if (st.timer) { if (d > 8) cancel(); return; } if (d > 6) start(); else return; }
      e.preventDefault(); place(e.clientX, e.clientY); mark(targetAt(e.clientX, e.clientY));
    }
    function up(e) { if (!st || e.pointerId !== st.pid) return; const was = st.active, t = was ? targetAt(e.clientX, e.clientY) : null, s = st; cleanup(); if (was) { suppressClick(); if (t) onDrop({ playerId: s.id, from: s.from }, t.bench ? { bench: true } : { slot: t.slot }); } }
    function cancel() { cleanup(); }
    function cleanup() { if (!st) return; cancelAnimationFrame(raf); raf = 0; clearTimeout(st.timer); if (st.ghost) st.ghost.remove(); st.el.classList.remove("dragging"); mark(null); document.body.style.userSelect = ""; document.body.style.webkitUserSelect = ""; document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true); st = null; }
    function suppressClick() { const stop = (e) => { e.stopPropagation(); e.preventDefault(); }; document.addEventListener("click", stop, { capture: true, once: true }); setTimeout(() => document.removeEventListener("click", stop, true), 80); }
    root.addEventListener("pointerdown", (e) => {
      const t = e.target.closest("[data-drag]"); if (!t || (e.pointerType === "mouse" && e.button !== 0) || st) return;
      st = { el: t, id: t.dataset.drag, from: t.dataset.from != null ? +t.dataset.from : null, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, pid: e.pointerId, active: false, timer: null };
      if (e.pointerType === "touch" && t.dataset.longpress) st.timer = setTimeout(() => { if (st && !st.active) { clearTimeout(st.timer); st.timer = null; start(); } }, 260);
      document.addEventListener("pointermove", move, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", cancel, true);
    });
    root.addEventListener("dragstart", (e) => e.preventDefault());
    return () => { cleanup(); document.removeEventListener("touchmove", stopTouchScroll, { passive: false }); };
  }
  E.pitch = { view, card, enableDrag, lines };
})(window);
