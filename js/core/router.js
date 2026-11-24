/* ESST core: hash router (#/path/:param?query). Hash routing is what makes double-click (file://) work.
   Features: params, guards (login / super admin), cleanup, scroll restore on back, page transition, error boundary. */
(function (g) {
  "use strict";
  const E = g.ESST, { el } = E.u;
  const routes = [];
  let cleanup = null, rid = 0, forward = true, current = { path: "/", query: {} };
  const scrollMem = new Map();

  function compile(pattern) {
    if (pattern === "*") return { re: /(?!)/, keys: [] };                // fallback route: matched explicitly, never by the pattern
    const keys = [], re = new RegExp("^" + pattern.replace(/\/+$/, "").replace(/:(\w+)/g, (m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    return { re, keys };
  }
  /* add(pattern, handler(ctx) -> cleanup?, { titleKey, auth, super }) ; adding the same pattern again replaces it */
  function add(pattern, handler, opts) {
    const c = compile(pattern), i = routes.findIndex((r) => r.pattern === pattern), r = Object.assign({ pattern, handler }, c, opts || {});
    if (i >= 0) routes[i] = r; else routes.push(r);
  }
  function parse() {
    const raw = location.hash.replace(/^#/, "") || "/", q = raw.indexOf("?"), path = (q < 0 ? raw : raw.slice(0, q)) || "/";
    const query = {}; if (q >= 0) new URLSearchParams(raw.slice(q + 1)).forEach((v, k) => { query[k] = v; });
    return { raw, path: path.startsWith("/") ? path : "/" + path, query };
  }
  function go(path, o) {
    forward = true; const h = "#" + path;
    if (o && o.replace) { history.replaceState(null, "", h); render(); } else if (location.hash === h) render(); else location.hash = h;
  }
  const back = (fallback) => { if (history.length > 1) history.back(); else go(fallback || "/"); };

  async function render() {
    const my = ++rid, p = parse(), isFwd = forward; forward = false;
    scrollMem.set(current.raw || "/", g.scrollY);
    if (typeof cleanup === "function") { try { cleanup(); } catch (e) { console.error(e); } } cleanup = null;
    let route = null, params = {};
    for (const r of routes) { const m = r.re.exec(p.path); if (m) { route = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
    if (!route) route = routes.find((r) => r.pattern === "*");
    current = { path: p.path, query: p.query, raw: p.raw };
    E.bus.emit("route", current);
    const page = el("div", { class: "view-enter" }), viewEl = document.getElementById("view");
    viewEl.replaceChildren(page);
    if (route && route.auth && !E.api.auth.hasSession()) { go("/login?next=" + encodeURIComponent(p.raw), { replace: true }); return; }
    if (route && route.auth && !E.session.loaded) { page.appendChild(E.ui.spinner()); await new Promise((ok) => { const off = E.bus.on("profile", () => { off(); ok(); }); if (E.session.loaded) { off(); ok(); } }); if (my !== rid) return; page.replaceChildren(); }
    if (route && route.super && !E.session.isSuper) { page.appendChild(E.ui.empty("lock", E.t("forbidden.title"), E.t("forbidden.text"))); document.title = E.t("app.name"); return; }
    document.title = (route && route.titleKey ? E.t(route.titleKey) + " · " : "") + E.t("app.name");
    const ctx = { params, query: p.query, path: p.path, page, isCurrent: () => my === rid };
    try { const r = route.handler(ctx); cleanup = (r && typeof r.then === "function") ? await r : r; if (my !== rid) { if (typeof cleanup === "function") cleanup(); cleanup = null; return; } }
    catch (e) { console.error("[route]", p.path, e); if (my === rid) page.replaceChildren(E.ui.errorState(e, render)); }
    if (my !== rid) return;
    const y = !isFwd && scrollMem.has(p.raw) ? scrollMem.get(p.raw) : 0;
    requestAnimationFrame(() => g.scrollTo(0, y));
  }
  function start() {
    g.addEventListener("hashchange", render);
    document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (a && !e.defaultPrevented && !e.metaKey && !e.ctrlKey) forward = true; }, true);
    render();
  }
  E.router = { add, go, back, start, render, get current() { return current; } };
})(window);
