/* ESST core: chat data layer shared by every page.
   - inbox cache + unread counter (bottom-navigation badge)
   - live delivery: Server-Sent Events read with fetch() (EventSource cannot send the Authorization header),
     reconnect with back-off, and a polling fallback (GET /api/chat/unread + ?after=) when streaming does not work
   - card helpers (match / player / team) and the "Share to chat" sheet used by the player, match and team pages
   Events on E.bus: chat:message, chat:deleted, chat:read, chat:resync, chat:unread. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k, v) => E.t(k, v);
  const C = { pollMs: 5000 };                                       // tests may lower pollMs
  const S = { convs: null, unread: 0, mode: "off", run: 0, running: false, ctrl: null, pollTimer: null, pollGen: 0, pollN: 0, fails: 0, wake: null, active: null };

  /* ---------- small helpers ---------- */
  const me = () => (E.api.auth.user() ? E.api.auth.user().id : null);
  /* the server sends microsecond timestamps; the browser only guarantees milliseconds */
  const toDate = (ts) => new Date(String(ts || "").replace(/(\.\d{3})\d+Z$/, "$1Z"));
  const dayKey = (ts) => { const d = toDate(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
  function dayLabel(ts) {
    const d = toDate(ts), now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayKey(ts) === dayKey(now.toISOString())) return T("chat.today");
    if (dayKey(ts) === dayKey(y.toISOString())) return T("chat.yesterday");
    return d.getFullYear() === now.getFullYear() ? E.i18n.date(d) : E.i18n.dateOnly(d);
  }
  const clock = (ts) => E.i18n.time(toDate(ts));
  /* inbox time: today -> hour, otherwise a short date */
  const inboxTime = (ts) => (dayKey(ts) === dayKey(new Date().toISOString()) ? clock(ts) : E.i18n.dateOnly(toDate(ts)));

  /* friendly, translated text for chat errors (technical detail stays in the console) */
  function errorText(e, kind) {
    const s = e && e.status, c = e && e.code;
    if (s === 0 || c === "NETWORK") return T("err.network");
    if (s === 429 || c === "RATE_LIMITED") return T("chat.err.rate");
    if (c === "TOO_LONG") return T(kind === "voice" ? "chat.err.voice_long" : "chat.err.long");
    if (c === "TOO_LARGE" || s === 413) return T("chat.err.large");
    if (c === "BLOCKED") return T("chat.err.blocked");
    if (c === "UNSUPPORTED_TYPE" || s === 415) return T("chat.err.type");
    if (c === "CARD_TARGET_NOT_FOUND") return T("chat.err.card_gone");
    if (c === "EMPTY_MESSAGE") return T("chat.err.empty");
    return E.api.errorText(e);
  }

  /* ---------- inbox cache + unread ---------- */
  function setUnread(n) {
    n = Math.max(0, n | 0); if (n === S.unread) return;
    S.unread = n; if (E.app && E.app.setBadge) E.app.setBadge("/chat", n); E.bus.emit("chat:unread", n);
  }
  async function refreshUnread() { try { const r = await E.api.get("/api/chat/unread"); setUnread(Number(r && r.unread) || 0); } catch (_) { /* the badge simply keeps its last value */ } }
  async function conversations() {
    const r = await E.api.get("/api/chat/conversations"); S.convs = (r && r.conversations) || [];
    setUnread(S.convs.reduce((a, c) => a + (c.unread || 0), 0)); return S.convs;
  }
  async function findConv(id) {                                         // header info for the conversation page (peer / team)
    let c = S.convs && S.convs.find((x) => x.id === id); if (c) return c;
    await conversations(); return S.convs.find((x) => x.id === id) || null;
  }
  const nameOf = (c) => (c.kind === "team" ? c.team_name || "" : E.u.nameOf({ full_name: c.peer_full_name, display_name: c.peer_display_name, nickname: c.peer_nickname }));
  const avatarOf = (c, size) => (c.kind === "team" ? E.ui.avatar({ logo_url: c.team_logo, full_name: c.team_name }, size, { square: true }) : E.ui.avatar({ photo_url: c.peer_photo, full_name: nameOf(c) }, size));
  const senderName = (m) => m.sender_display_name || m.sender_full_name || m.sender_nickname || "";

  /* ---------- API calls ---------- */
  const send = (convId, payload) => E.api.post("/api/chat/conversations/" + convId + "/messages", payload);
  const markRead = (convId) => E.api.post("/api/chat/conversations/" + convId + "/read");
  async function openDirect(userId) { const r = await E.api.post("/api/chat/direct", { user_id: userId }); return r.id; }

  /* ---------- live delivery ---------- */
  const nap = (ms) => new Promise((ok) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); S.wake = null; ok(); } S.wake = done; });
  function handleBlock(block) {
    let ev = "message", data = "";
    for (const line of block.split(/\r?\n/)) {
      if (!line || line[0] === ":") continue;                           // comment / ping
      if (line.startsWith("event:")) ev = line.slice(6).trim(); else if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "");
    }
    let d = null; try { d = data ? JSON.parse(data) : null; } catch (_) { return; }
    if (ev === "ready") { S.mode = "stream"; S.fails = 0; stopPoll(); E.bus.emit("chat:resync", { ready: true }); refreshUnread(); }
    else if (ev === "message" && d) { E.bus.emit("chat:message", d); scheduleUnread(); }
    else if (ev === "message_deleted" && d) { E.bus.emit("chat:deleted", d); scheduleUnread(); }
    else if (ev === "read" && d) E.bus.emit("chat:read", d);
  }
  let unreadTimer = null;
  function scheduleUnread() { clearTimeout(unreadTimer); unreadTimer = setTimeout(refreshUnread, 350); }

  async function streamOnce() {
    const tok = await E.api.token(); if (!tok) throw new Error("no session");
    const ctrl = new AbortController(); S.ctrl = ctrl;
    const res = await fetch(E.api.base + "/api/chat/stream", { headers: { Authorization: "Bearer " + tok, Accept: "text/event-stream" }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.body || !res.body.getReader) throw Object.assign(new Error("stream unavailable"), { status: res.status });
    const reader = res.body.getReader(), dec = new TextDecoder("utf-8"); let buf = "", ready = false;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let m; while ((m = /\r?\n\r?\n/.exec(buf))) { const block = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length); if (/^event:\s*ready/m.test(block)) ready = true; handleBlock(block); }
    }
    return ready;
  }
  async function loop(run) {
    let wait = 1000;
    while (run === S.run) {
      let connected = false;
      try { connected = await streamOnce(); } catch (e) { if (run !== S.run) return; }
      if (run !== S.run) return;
      if (connected) { wait = 800; S.fails = 0; }                      // the server closes the stream when the token expires: reconnect with a fresh one
      else { S.fails++; wait = Math.min(30000, Math.round(wait * 1.8)); if (S.fails >= 2) startPoll(); }
      if (S.mode === "stream") S.mode = "off";
      await nap(wait + Math.random() * 300);
    }
  }
  function startPoll() {
    if (S.pollTimer) return; S.mode = "poll"; const gen = ++S.pollGen;
    const tick = async () => {
      if (gen !== S.pollGen) return;                                    // polling was stopped (or restarted) while this tick was waiting
      if (!document.hidden) { await refreshUnread(); if (gen !== S.pollGen) return; E.bus.emit("chat:resync", { poll: true, n: ++S.pollN }); }
      S.pollTimer = setTimeout(tick, C.pollMs);
    };
    S.pollTimer = setTimeout(tick, 400);
  }
  function stopPoll() { S.pollGen++; if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; } }

  function start() {
    if (S.running || !E.api.auth.hasSession() || E.api.needsConfig || E.api.baseInvalid) return;
    S.running = true; const run = ++S.run; refreshUnread(); loop(run);
  }
  function stop() {
    S.running = false; S.run++; if (S.ctrl) { try { S.ctrl.abort(); } catch (_) {} S.ctrl = null; } stopPoll(); if (S.wake) S.wake();
    S.convs = null; S.mode = "off"; setUnread(0); clearCards();
  }
  E.bus.on("session", (s) => { if (s) { stop(); start(); } else stop(); });
  g.addEventListener("online", () => { if (S.running && S.wake) S.wake(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !S.running) return;
    if (S.wake) S.wake(); refreshUnread(); E.bus.emit("chat:resync", { visible: true });      // a phone may have dropped the stream while the screen was off
  });

  /* ---------- cards (match / player / team): data for the rich message card ---------- */
  const cardCache = new Map();
  function clearCards() { cardCache.clear(); }
  function cardInfo(card) {
    const key = card.type + ":" + card.id; if (cardCache.has(key)) return cardCache.get(key);
    const p = (async () => {
      if (card.type === "match") { const d = await E.api.rpc("match_detail", { p_match: card.id }); if (!d) throw new Error("gone"); return d; }
      if (card.type === "player") { const d = await E.api.rpc("player_public", { p_id: card.id }); if (!d) throw new Error("gone"); return d; }
      const t = (await E.league.teams()).get(card.id); if (!t) throw new Error("gone"); return t;
    })();
    cardCache.set(key, p); p.catch(() => cardCache.delete(key)); return p;
  }
  const cardHref = (card) => "#/" + card.type + "/" + card.id;

  /* ---------- "Share to chat" sheet (player, match and team pages) ---------- */
  async function sendCard(convId, card) {
    try { await send(convId, { kind: "card", card: { type: card.type, id: card.id } }); E.ui.toast(T("chat.share.done"), "ok"); return true; }
    catch (e) { E.ui.toast(errorText(e), "err"); return false; }
  }
  async function shareSheet(card) {
    if (!E.api.auth.hasSession()) { E.ui.toast(T("chat.login_to_share")); return E.router.go("/login?next=" + encodeURIComponent(E.router.current.raw)); }
    const list = el("div", { class: "list", role: "list" }, E.ui.skeletonRows(3, 60));
    let m;
    const person = el("button", { type: "button", class: "btn btn-block", on: { click: async () => {
      m.close(); const p = await E.pickers.player({ title: T("chat.share.person"), filter: (r) => r.player_id !== me() }); if (!p) return;
      try { const id = await openDirect(p.player_id); await sendCard(id, card); } catch (e) { E.ui.toast(errorText(e), "err"); }
    } } }, icon("search", { size: 20 }), T("chat.share.person"));
    m = E.ui.modal([el("h2", { text: T("chat.share.title") }), el("div", { class: "stack", style: { marginTop: "10px" } }, person, list),
      el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close() } }, T("common.cancel")))], { label: T("chat.share.title") });
    try {
      const rows = (await conversations()).filter((c) => !c.blocked_by_me);
      list.replaceChildren(...(rows.length ? rows.map((c) => el("button", { type: "button", class: "list-row", role: "listitem", style: { width: "100%", textAlign: "start", background: "none", border: 0, color: "inherit" }, on: { click: async () => { m.close(); await sendCard(c.id, card); } } },
        avatarOf(c, "md"), el("div", { class: "grow" }, el("div", { class: "ellipsis", style: { fontWeight: "700" }, text: nameOf(c) }), el("div", { class: "small muted", text: c.kind === "team" ? T("chat.team_chat") : "" })))) : [el("p", { class: "muted small", text: T("chat.share.none") })]));
    } catch (e) { list.replaceChildren(E.ui.errorState(e, () => { m.close(); shareSheet(card); })); }
  }

  E.chat = { config: C, state: S, toDate, dayKey, dayLabel, clock, inboxTime, errorText, conversations, findConv, nameOf, avatarOf, senderName, send, markRead, openDirect, refreshUnread, setUnread,
    cardInfo, cardHref, shareSheet, start, stop, get unread() { return S.unread; }, get mode() { return S.mode; }, get active() { return S.active; }, set active(v) { S.active = v; } };
  if (E.api.auth.hasSession()) start();
})(window);
