/* ESST core: small helpers. Classic script (no modules) so it works from file://. */
(function (g) {
  "use strict";
  const E = (g.ESST = g.ESST || {});
  E.dict = E.dict || { en: {}, fr: {}, ar: {} };

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

  /* el("div", {class:"x", on:{click:fn}, aria:{label:"..."}, data:{id:1}}, child, "text", [children]) - text is ALWAYS inserted as text (no XSS).
     The only HTML escape hatch is the `html` attribute, reserved for trusted inline SVG icons. */
  function el(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k === "on") for (const ev of Object.keys(v)) n.addEventListener(ev, v[ev]);
      else if (k === "data") for (const d of Object.keys(v)) n.dataset[d] = v[d];
      else if (k === "aria") for (const a of Object.keys(v)) n.setAttribute("aria-" + a, v[a]);
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (v === true) n.setAttribute(k, "");
      else n.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function append(n, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(n, x));
    else n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* Lucide icon as a DOM node (inline SVG from assets/icons.js, inherits the text colour) */
  function icon(name, o) {
    const t = document.createElement("template"); t.innerHTML = g.Icons.svg(name, o);
    return t.content.firstChild;
  }
  /* icon-only button: always has an aria-label and a 44px touch target */
  function iconBtn(name, label, onClick, o) {
    o = o || {};
    return el("button", { type: "button", class: "icon-btn" + (o.class ? " " + o.class : ""), "aria-label": label, title: label, on: onClick ? { click: onClick } : null }, icon(name, o));
  }

  /* accent / case / Arabic-variant insensitive text (same rules as the server's norm_text) */
  const FROM = "àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸŒÆأإآٱىةؤئ", TO = "aaaaaaceeeeiiiinooooouuuuyyoaaaaaaaceeeeiiiinooooouuuuyyoaاااايهوي";
  function norm(s) {
    let o = "";
    for (const ch of String(s == null ? "" : s).toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "")) { const i = FROM.indexOf(ch); o += i < 0 ? ch : TO[i]; }
    return o;
  }
  /* highlight matched letters (accent-insensitive) - returns a DocumentFragment with <mark> nodes */
  function highlight(text, query) {
    const frag = document.createDocumentFragment(), s = String(text == null ? "" : text), toks = norm(query).split(/\s+/).filter(Boolean);
    if (!toks.length) { frag.appendChild(document.createTextNode(s)); return frag; }
    const chars = Array.from(s), flags = new Array(chars.length).fill(false), n = chars.map((c) => norm(c)), joined = n.join("");
    const pos = []; { let p = 0; n.forEach((x, i) => { for (let k = 0; k < x.length; k++) pos[p++] = i; }); }
    for (const t of toks) { let at = joined.indexOf(t); while (at >= 0) { for (let k = 0; k < t.length; k++) flags[pos[at + k]] = true; at = joined.indexOf(t, at + t.length); } }
    chars.forEach((c, i) => { if (n[i] === "" && i > 0 && flags[i - 1]) flags[i] = true; });          // a vowel mark belongs to the letter before it
    let buf = "", cur = false;
    const flush = () => { if (!buf) return; frag.appendChild(cur ? el("mark", { class: "hl" }, buf) : document.createTextNode(buf)); buf = ""; };
    chars.forEach((c, i) => { if (flags[i] !== cur) { flush(); cur = flags[i]; } buf += c; }); flush();
    return frag;
  }
  const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] || "").join("") || "?";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* a person's best display name: nickname/full name/display name */
  const nameOf = (p) => (p && (p.full_name || p.display_name || p.nickname)) || "";
  const uuid = () => (g.crypto && g.crypto.randomUUID ? g.crypto.randomUUID() : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2));

  E.u = { esc, el, $, $$, icon, iconBtn, norm, highlight, debounce, clamp, initials, sleep, nameOf, uuid };

  /* tiny event bus */
  const subs = {};
  E.bus = { on(ev, fn) { (subs[ev] = subs[ev] || new Set()).add(fn); return () => subs[ev].delete(fn); }, emit(ev, d) { (subs[ev] || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); } };
})(window);
