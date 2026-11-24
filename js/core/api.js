/* ESST core: API client. Token in the Authorization header (no cookies), so it works from file:// through CORS.
   Same backend API as before: /auth/v1 (accounts), /rest/v1 (tables + functions), /api (media, chat, league). */
(function (g) {
  "use strict";
  const E = g.ESST, cfg = g.ESST_CONFIG || {}, isFile = location.protocol === "file:";
  let base = String(cfg.API_BASE || "").trim().replace(/\/+$/, "");
  const baseInvalid = !!base && !/^https?:\/\/[^\s/]+/i.test(base);
  if (baseInvalid) base = "";

  /* storage that survives browsers where localStorage is blocked */
  const mem = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return mem[k] == null ? null : mem[k]; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { mem[k] = v; } },
    remove(k) { try { localStorage.removeItem(k); } catch (_) { delete mem[k]; } },
  };
  const SKEY = "esst.session";
  let sess = null; try { sess = JSON.parse(store.get(SKEY) || "null"); } catch (_) {}
  const saveSess = (s) => { sess = s; if (s) store.set(SKEY, JSON.stringify(s)); else store.remove(SKEY); };

  class ApiError extends Error {
    constructor(status, code, message, body) { super(message || code || "Error"); this.status = status; this.code = code || ""; this.body = body || null; }
  }
  const qs = (o) => { const p = new URLSearchParams(); for (const k of Object.keys(o || {})) if (o[k] != null) p.append(k, o[k]); const s = p.toString(); return s ? "?" + s : ""; };

  function toSession(r) { return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600), user: r.user }; }

  let refreshing = null;
  function refresh() {                       // single-flight: parallel requests share one refresh
    if (!sess || !sess.refresh_token) return Promise.resolve(false);
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const r = await fetch(base + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: sess.refresh_token }) });
        if (r.ok) { saveSess(toSession(await r.json())); return true; }
        if (r.status === 400 || r.status === 401 || r.status === 403) { signedOut(); return false; }      // refresh token is dead
        return false;                                                                                      // server hiccup: keep the session
      } catch (_) { return false; }                                                                         // offline: keep the session
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  function signedOut() { saveSess(null); revokeBlobs(); E.bus.emit("session", null); }
  async function freshToken() {
    if (!sess) return null;
    if (sess.expires_at - Math.floor(Date.now() / 1000) < 60) await refresh();
    return sess ? sess.access_token : null;
  }

  async function parse(res) {
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json().catch(() => null) : res.text().catch(() => "");
  }
  function toError(res, body) {
    const b = body && typeof body === "object" ? body : {};
    const message = b.message || b.msg || b.error_description || (typeof body === "string" && body) || res.statusText || "Error";
    let code = b.error || b.error_code || (typeof b.code === "string" ? b.code : "") || "";
    const m = /^([A-Z][A-Z0-9_]{2,})(?::|$)/.exec(String(message));
    if (m && (!code || code === "P0001")) code = m[1];              // errors raised by our SQL functions carry their code in the message
    return new ApiError(res.status, code, message, body);
  }

  async function request(path, o) {
    o = o || {};
    const h = Object.assign({ Accept: "application/json" }, o.headers || {});
    let body = o.body;
    if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { body = JSON.stringify(body); h["Content-Type"] = "application/json"; }
    if (o.auth !== false) { const tok = await freshToken(); if (tok) h.Authorization = "Bearer " + tok; }
    let res;
    try { res = await fetch(base + path + qs(o.query), { method: o.method || "GET", headers: h, body: body == null ? undefined : body, signal: o.signal }); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw new ApiError(0, "NETWORK", "Network error"); }
    if (res.status === 401 && o.auth !== false && sess && !o._retried && (await refresh())) return request(path, Object.assign({}, o, { _retried: true }));
    const data = await parse(res);
    if (!res.ok) throw toError(res, data);
    return o.raw ? { data, res } : data;
  }

  /* ---- accounts ---- */
  const auth = {
    async signUp(email, password, data) { const r = await request("/auth/v1/signup", { method: "POST", body: { email, password, data }, auth: false }); saveSess(toSession(r)); E.bus.emit("session", sess); return sess; },
    async signIn(email, password) { const r = await request("/auth/v1/token", { method: "POST", query: { grant_type: "password" }, body: { email, password }, auth: false }); saveSess(toSession(r)); E.bus.emit("session", sess); return sess; },
    async signOut() { try { if (sess) await request("/auth/v1/logout", { method: "POST" }); } catch (_) {} signedOut(); },
    user() { return sess ? sess.user : null; }, hasSession() { return !!sess; },
  };

  /* ---- tables: from("teams").select("id,name").eq("id", x).order("name").limit(10) ; awaits like a promise ---- */
  class Query {
    constructor(table) { this.t = table; this.p = []; this.m = "GET"; this.body = null; this.mode = "many"; }
    select(cols) { this.p.push(["select", cols || "*"]); return this; }
    f(c, op, v) { this.p.push([c, op + "." + v]); return this; }
    eq(c, v) { return this.f(c, "eq", v); } neq(c, v) { return this.f(c, "neq", v); } gt(c, v) { return this.f(c, "gt", v); } gte(c, v) { return this.f(c, "gte", v); }
    lt(c, v) { return this.f(c, "lt", v); } lte(c, v) { return this.f(c, "lte", v); } is(c, v) { return this.f(c, "is", v); } ilike(c, v) { return this.f(c, "ilike", v); }
    in(c, arr) { return this.f(c, "in", "(" + arr.map((x) => '"' + String(x).replace(/(["\\])/g, "\\$1") + '"').join(",") + ")"); }
    order(c, o) { this.p.push(["order", c + "." + (o && o.ascending === false ? "desc" : "asc")]); return this; }
    limit(n) { this.p.push(["limit", n]); return this; } offset(n) { this.p.push(["offset", n]); return this; }
    insert(rows) { this.m = "POST"; this.body = rows; return this; } update(v) { this.m = "PATCH"; this.body = v; return this; } delete() { this.m = "DELETE"; return this; }
    single() { this.mode = "single"; return this; } maybeSingle() { this.mode = "maybe"; return this; }
    async run() {
      const q = new URLSearchParams(); this.p.forEach(([k, v]) => q.append(k, v));
      if (this.mode !== "many" && this.m === "GET") q.set("limit", "1");
      const rows = await request("/rest/v1/" + this.t + (q.toString() ? "?" + q : ""), { method: this.m, body: this.body, headers: this.m === "GET" ? {} : { Prefer: "return=representation" } });
      if (this.mode === "many") return rows;
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (r == null && this.mode === "single") throw new ApiError(404, "NOT_FOUND", "Not found");
      return r == null ? null : r;
    }
    then(a, b) { return this.run().then(a, b); }
  }
  const from = (t) => new Query(t);
  const rpc = (name, args) => request("/rest/v1/rpc/" + name, { method: "POST", body: args || {} });

  /* ---- media (stored in PostgreSQL) ---- */
  const blobCache = new Map();
  function revokeBlobs() { blobCache.forEach((u) => URL.revokeObjectURL(u)); blobCache.clear(); }
  const mediaUrl = (p) => (!p ? "" : /^\/api\/media\//.test(p) ? base + p : p);                       // public pictures (avatars, logos): plain <img src>
  async function blobUrl(p) {                                                                          // private chat media: needs the Authorization header
    if (blobCache.has(p)) return blobCache.get(p);
    const tok = await freshToken(), r = await fetch(base + p, { headers: tok ? { Authorization: "Bearer " + tok } : {} });
    if (!r.ok) throw new ApiError(r.status, "MEDIA", "Media unavailable");
    const u = URL.createObjectURL(await r.blob()); blobCache.set(p, u); return u;
  }
  function releaseBlob(p) { const u = blobCache.get(p); if (u) { URL.revokeObjectURL(u); blobCache.delete(p); } }    // a page that showed private media frees it when the person leaves
  const upload = (kind, blob, extra) => request("/api/media", { method: "POST", query: { kind }, body: blob, headers: Object.assign({ "Content-Type": blob.type || "application/octet-stream" }, extra || {}) });

  /* message text for an error, translated */
  function errorText(e) {
    const T = E.t, code = e && e.code, s = e && e.status;
    if (s === 0 || code === "NETWORK") return T("err.network");
    for (const k of [code && "err." + String(code).toLowerCase(), s === 401 && "err.unauthorized", s === 403 && "err.forbidden", s === 404 && "err.not_found", s === 429 && "err.rate_limited", s === 503 && "err.db_not_ready", s >= 500 && "err.server"])
      if (k && E.dict[E.i18n.lang][k] != null) return T(k);
    return (e && e.message && e.status < 500 && !/^[A-Z_]+$/.test(e.message)) ? e.message : T("err.generic");
  }

  E.api = {
    base, isFile, baseInvalid, needsConfig: isFile && !base, ApiError, request, auth, from, rpc, mediaUrl, blobUrl, releaseBlob, upload, errorText, token: freshToken,
    get: (p, q) => request(p, { query: q }), post: (p, b) => request(p, { method: "POST", body: b || {} }), del: (p) => request(p, { method: "DELETE" }),
    session: () => sess, store, health: () => request("/health", { auth: false }),
  };
})(window);
