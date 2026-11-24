/* Chat pages: #/chat (inbox) and #/chat/:id (conversation: text, voice, photos, shared cards, live delivery, block, delete).
   Text is always inserted with textContent (XSS-safe, "\n" kept by CSS). Private media (voice, photos) is fetched with the Authorization header. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon, iconBtn } = E.u, T = (k, v) => E.t(k, v), CH = E.chat;
  const MAX_TEXT = 2000, MAX_VOICE_MS = 120000, MIN_VOICE_MS = 700;
  const reduced = () => g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const me = () => (E.api.auth.user() ? E.api.auth.user().id : null);
  const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  /* ================= inbox ================= */
  function preview(c) {
    const lm = c.last_message;
    if (!lm) return { text: T("chat.no_messages"), soft: true };
    if (lm.deleted) return { text: T("chat.msg_deleted"), soft: true };
    const mine = lm.sender_id === me(), pre = mine ? T("chat.you") + ": " : "";
    if (lm.kind === "text") return { text: pre + (lm.body || "") };
    return { text: pre + T(lm.kind === "voice" ? "chat.preview.voice" : lm.kind === "image" ? "chat.preview.image" : "chat.preview.card"), ic: lm.kind === "voice" ? "mic" : lm.kind === "image" ? "image" : "share-2" };
  }
  function inboxRow(c) {
    const p = preview(c), name = CH.nameOf(c);
    return el("a", { class: "chat-row" + (c.unread ? " unread" : ""), href: "#/chat/" + c.id, "aria-label": name + (c.unread ? ", " + T("chat.unread_n", { n: c.unread }) : "") },
      CH.avatarOf(c, "md"),
      el("div", { class: "chat-row-main" },
        el("div", { class: "chat-row-top" }, el("span", { class: "chat-row-name ellipsis", dir: "auto", text: name }), c.kind === "team" ? el("span", { class: "badge badge-muted", text: T("chat.team_chat") }) : null,
          c.blocked_by_me ? el("span", { class: "badge badge-danger", text: T("chat.blocked_badge") }) : null, el("span", { class: "chat-row-time tiny muted num", text: CH.inboxTime(c.ts) })),
        el("div", { class: "chat-row-bottom" }, el("span", { class: "chat-row-preview ellipsis" + (p.soft ? " soft" : ""), dir: "auto" }, p.ic ? icon(p.ic, { size: 20, class: "inl" }) : null, p.text),
          c.unread ? el("span", { class: "count-badge", "aria-hidden": "true", text: c.unread > 99 ? "99+" : String(c.unread) }) : null)));
  }
  E.router.add("/chat", async (ctx) => {
    const list = el("div", { class: "chat-list-box" }, E.ui.skeletonRows(4, 68));
    const newBtn = el("button", { type: "button", class: "btn btn-primary btn-sm", on: { click: async () => {
      const p = await E.pickers.player({ title: T("chat.new"), filter: (r) => r.player_id !== me() }); if (!p) return;
      try { E.router.go("/chat/" + (await E.ui.busy(newBtn, () => CH.openDirect(p.player_id)))); } catch (e) { E.ui.toast(CH.errorText(e), "err"); }
    } } }, icon("plus", { size: 20 }), T("chat.new"));
    ctx.page.append(el("div", { class: "page-head" }, el("h1", { text: T("nav.chat") }), newBtn), list);
    let alive = true, first = true;
    async function load() {
      try {
        const rows = await CH.conversations(); if (!alive || !ctx.isCurrent()) return;
        list.replaceChildren(rows.length ? el("div", { class: "card chat-list", role: "list" }, rows.map((c) => el("div", { role: "listitem" }, inboxRow(c)))) :
          E.ui.empty("message-circle", T("chat.empty.title"), T("chat.empty.text"), el("a", { class: "btn btn-primary", href: "#/search" }, icon("search", { size: 20 }), T("chat.empty.cta"))));
      } catch (e) { if (alive && ctx.isCurrent() && first) list.replaceChildren(E.ui.errorState(e, () => { list.replaceChildren(E.ui.skeletonRows(4, 68)); load(); })); }
      first = false;
    }
    await load();
    const again = E.u.debounce(load, 400), offs = ["chat:message", "chat:deleted", "chat:read", "chat:resync"].map((ev) => E.bus.on(ev, again));
    return () => { alive = false; again.cancel(); offs.forEach((f) => f()); };
  }, { auth: true, titleKey: "nav.chat" });

  /* ================= conversation ================= */
  E.router.add("/chat/:id", async (ctx) => {
    const id = ctx.params.id, uid = me();
    document.body.classList.add("in-chat"); CH.active = id;
    const st = { conv: null, msgs: [], ids: new Set(), more: false, peerRead: null, loaded: false, pinned: true, unseen: 0, sending: false, rec: null, paths: new Set(), audios: new Set(), readPending: false, loadingOlder: false };
    const offs = [], timers = []; let io = null, alive = true;

    const scroller = el("div", { class: "chat-scroll", role: "log", "aria-live": "polite", "aria-relevant": "additions", tabindex: "-1" });
    const listEl = el("div", { class: "chat-msgs" }), olderBtn = el("button", { type: "button", class: "btn btn-sm chat-older", hidden: true, on: { click: () => loadOlder() } }, T("chat.load_older"));
    scroller.append(olderBtn, listEl);
    const page = el("div", { class: "chat-page" });
    ctx.page.appendChild(page);

    function cleanup() {
      alive = false; document.body.classList.remove("in-chat"); if (CH.active === id) CH.active = null;
      offs.forEach((f) => f()); timers.forEach(clearTimeout); if (io) io.disconnect();
      if (st.rec) cancelRecording(true);
      st.audios.forEach((a) => { try { a.pause(); a.removeAttribute("src"); a.load(); } catch (_) {} }); st.audios.clear();
      st.paths.forEach((p) => E.api.releaseBlob(p)); st.paths.clear();                       // private voice / photos are freed when the person leaves
    }

    /* ---------- loading ---------- */
    page.appendChild(E.ui.spinner());
    const get = (q) => E.api.get("/api/chat/conversations/" + id + "/messages", q);
    let first;
    try { const [conv, data] = await Promise.all([CH.findConv(id).catch(() => null), get({ limit: 30 })]); first = { conv, data }; }
    catch (e) {
      if (!ctx.isCurrent()) return cleanup;
      page.replaceChildren(e && e.status === 404 ? E.ui.empty("lock", T("chat.not_found.title"), T("chat.not_found.text"), el("a", { class: "btn", href: "#/chat" }, T("nav.chat"))) : E.ui.errorState(e, () => E.router.render()));
      document.body.classList.remove("in-chat"); return cleanup;
    }
    if (!ctx.isCurrent()) return cleanup;
    st.conv = first.conv || { id, kind: first.data.kind, peer_id: null, blocked_by_me: false, team_name: "", ts: null };
    st.msgs = first.data.messages; st.msgs.forEach((m) => st.ids.add(m.id)); st.more = !!first.data.has_more; st.peerRead = first.data.peer_last_read_at || null;
    const conv = st.conv, team = conv.kind === "team", title = CH.nameOf(conv) || T("nav.chat");
    document.title = title + " · " + T("app.name");

    /* ---------- header ---------- */
    const titleLink = el("a", { class: "chat-title", href: team ? "#/team/" + conv.team_id : conv.peer_id ? "#/player/" + conv.peer_id : "#/chat" }, CH.avatarOf(conv, "sm"),
      el("span", { class: "chat-title-txt" }, el("b", { class: "ellipsis", dir: "auto", text: title }), el("small", { class: "muted ellipsis", text: team ? T("chat.team_chat") : "" })));
    const head = el("header", { class: "chat-head" }, iconBtn("arrow-left", T("common.back"), () => E.router.back("/chat"), { class: "icon-flip" }), titleLink, !team && conv.peer_id ? iconBtn("ellipsis", T("chat.menu"), () => menu()) : null);

    /* ---------- rendering ---------- */
    const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const toBottom = (smooth) => { scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reduced() ? "smooth" : "auto" }); st.pinned = true; };
    function lazy(node, fn) {
      if (!g.IntersectionObserver) { fn(); return; }
      if (!io) io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); const f = en.target.__load; en.target.__load = null; if (f) f(); } }), { root: scroller, rootMargin: "300px" });
      node.__load = fn; io.observe(node);
    }
    const tick = (m) => {
      let read, label;
      if (conv.kind === "direct") { read = !!st.peerRead && m.ts <= st.peerRead; label = T(read ? "chat.read" : "chat.sent"); }
      else { read = m.recipients > 0 && m.read_by >= m.recipients; label = read ? T("chat.read") : m.read_by > 0 ? T("chat.read_by", { n: m.read_by, total: m.recipients }) : T("chat.sent"); }
      return el("span", { class: "tick" + (read ? " read" : ""), role: "img", "aria-label": label, title: label }, icon(read ? "check-check" : "check", { size: 20 }));
    };

    function voicePlayer(m) {
      const total = Math.max(0, (m.duration_ms || 0) / 1000);
      let audio = null;
      const time = el("span", { class: "voice-time tiny num", text: mmss(total) });
      const seek = el("input", { type: "range", class: "voice-seek", min: "0", max: "1000", value: "0", "aria-label": T("chat.voice.seek"), disabled: true, on: { input: () => { if (audio && isFinite(total) && total > 0) audio.currentTime = (seek.value / 1000) * total; } } });
      const btn = iconBtn("play", T("chat.voice.play"), () => toggle(), { class: "voice-btn" });
      const setIc = (n, label) => { btn.replaceChildren(icon(n)); btn.setAttribute("aria-label", label); btn.title = label; };
      async function toggle() {
        try {
          if (!audio) {
            btn.setAttribute("aria-busy", "true"); const url = await E.api.blobUrl(m.media_url); st.paths.add(m.media_url); if (!alive) return;
            audio = new Audio(url); audio.preload = "auto"; st.audios.add(audio);
            audio.addEventListener("play", () => { setIc("pause", T("chat.voice.pause")); seek.disabled = false; });
            audio.addEventListener("pause", () => setIc("play", T("chat.voice.play")));
            audio.addEventListener("ended", () => { setIc("play", T("chat.voice.play")); seek.value = "0"; time.textContent = mmss(total); });
            audio.addEventListener("timeupdate", () => { const d = total || (isFinite(audio.duration) ? audio.duration : 0); if (d) seek.value = String(Math.min(1000, Math.round((audio.currentTime / d) * 1000))); time.textContent = mmss(audio.currentTime); });
            audio.addEventListener("error", () => E.ui.toast(T("chat.voice.play_failed"), "err"));
          }
          if (audio.paused) { st.audios.forEach((a) => { if (a !== audio) a.pause(); }); await audio.play(); } else audio.pause();
        } catch (e) { E.ui.toast(T("chat.voice.play_failed"), "err"); }
        finally { btn.removeAttribute("aria-busy"); }
      }
      return el("div", { class: "voice" }, btn, seek, time);
    }
    function imageBubble(m) {
      const box = el("button", { type: "button", class: "msg-img skeleton", "aria-label": T("chat.image.open") });
      lazy(box, async () => {
        try {
          const url = await E.api.blobUrl(m.media_url); st.paths.add(m.media_url); if (!alive) return;
          const im = el("img", { src: url, alt: T("chat.image.alt"), decoding: "async", on: { load: () => { box.classList.remove("skeleton"); if (st.pinned) toBottom(); } } });
          box.replaceChildren(im); box.onclick = () => { const mo = E.ui.modal([el("img", { class: "lightbox-img", src: url, alt: T("chat.image.alt") }), el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => mo.close() } }, T("common.close")))], { label: T("chat.image.alt") }); };
        } catch (e) { box.classList.remove("skeleton"); box.classList.add("failed"); box.replaceChildren(icon("image", { size: 24 }), el("span", { class: "small", text: T("chat.image.failed") })); }
      });
      return box;
    }
    function cardBubble(m) {
      const c = m.card || {}, a = el("a", { class: "msg-card", href: CH.cardHref(c) }, el("div", { class: "skeleton", style: { height: "56px", borderRadius: "12px" } }));
      const generic = () => a.replaceChildren(el("span", { class: "msg-card-ic" }, icon(c.type === "match" ? "calendar" : c.type === "team" ? "users" : "user", { size: 24 })), el("div", { class: "grow" }, el("b", { text: T("chat.card." + c.type) }), el("div", { class: "small muted", text: T("chat.card.open") })));
      CH.cardInfo(c).then((d) => {
        if (!alive) return;
        if (c.type === "match") { const mt = d.match, done = mt.status === "finished", F = E.league.F; a.classList.add("col");
          a.replaceChildren(el("div", { class: "msg-card-kicker small muted" }, icon("calendar", { size: 20 }), T("chat.card.match"), mt.round_name || mt.matchday ? " · " + (mt.matchday ? T("match.matchday", { n: mt.matchday }) : mt.round_name) : ""),
            el("div", { class: "msg-card-match" }, el("span", { class: "side" }, E.league.logo(d.home, "sm"), el("span", { class: "ellipsis", text: E.league.teamName(d.home) })),
              el("span", { class: "mid num", text: done ? E.i18n.number(mt.home_score) + " – " + E.i18n.number(mt.away_score) : F.time(mt.kickoff_at) }),
              el("span", { class: "side away" }, E.league.logo(d.away, "sm"), el("span", { class: "ellipsis", text: E.league.teamName(d.away) }))),
            el("div", { class: "small muted", text: F.short(mt.kickoff_at) + (done ? " · " + T("match.status.finished") : "") })); }
        else if (c.type === "player") a.replaceChildren(E.ui.avatar(d, "md"), el("div", { class: "grow" }, el("div", { class: "small muted" }, T("chat.card.player")), el("b", { class: "ellipsis", dir: "auto", text: E.u.nameOf(d) }),
          el("div", { class: "small muted ellipsis", text: (d.main_position ? T("pos.short." + d.main_position) + " · " : "") + (d.team ? d.team.name : T("profile.no_team")) })), el("span", { class: "badge", text: String(d.ovr) }));
        else a.replaceChildren(E.ui.avatar({ logo_url: d.logo_url, full_name: d.name }, "md", { square: true }), el("div", { class: "grow" }, el("div", { class: "small muted" }, T("chat.card.team")), el("b", { class: "ellipsis", dir: "auto", text: d.name }), el("div", { class: "small muted", text: T("team.players", { n: E.i18n.number(d.players) }) })));
        if (st.pinned) toBottom();
      }).catch(() => { if (alive) generic(); });
      return a;
    }
    function buildRow(m, prev) {
      const mine = m.sender_id === uid, newDay = !prev || CH.dayKey(prev.ts) !== CH.dayKey(m.ts);
      const showName = team && !mine && !m.deleted && (newDay || !prev || prev.sender_id !== m.sender_id || prev.deleted);
      let content;
      if (m.deleted) content = el("div", { class: "msg-deleted" }, icon("ban", { size: 20 }), T("chat.msg_deleted"));
      else if (m.kind === "voice") content = voicePlayer(m);
      else if (m.kind === "image") content = imageBubble(m);
      else if (m.kind === "card") content = cardBubble(m);
      else content = el("p", { class: "msg-text", dir: "auto", text: m.body || "" });
      const bubble = el("div", { class: "bubble" + (m.kind === "card" ? " is-card" : m.kind === "image" ? " is-image" : "") + (m.deleted ? " deleted" : "") },
        showName ? el("div", { class: "msg-name", dir: "auto", text: CH.senderName(m) }) : null, content,
        el("div", { class: "msg-meta" }, el("time", { class: "tiny num", datetime: m.ts, text: CH.clock(m.ts) }), mine && !m.deleted ? tick(m) : null));
      const del = mine && !m.deleted ? iconBtn("trash-2", T("chat.delete"), () => removeMsg(m), { class: "msg-del" }) : null;
      return el("div", { class: "msg-row " + (mine ? "mine" : "theirs") + (showName ? " has-name" : ""), data: { id: m.id } }, del, bubble);
    }
    function sep(ts) { return el("div", { class: "day-sep", role: "separator" }, el("span", { text: CH.dayLabel(ts) })); }
    function renderAll() {
      listEl.replaceChildren(); let prev = null;
      if (!st.msgs.length) listEl.appendChild(el("div", { class: "chat-empty-note" }, E.ui.empty("message-circle", T("chat.thread_empty.title"), T("chat.thread_empty.text"))));
      for (const m of st.msgs) { if (!prev || CH.dayKey(prev.ts) !== CH.dayKey(m.ts)) listEl.appendChild(sep(m.ts)); listEl.appendChild(buildRow(m, prev)); prev = m; }
      olderBtn.hidden = !st.more;
    }
    function refreshTicks() {
      for (const m of st.msgs) { if (m.sender_id !== uid || m.deleted) continue; const row = listEl.querySelector('[data-id="' + m.id + '"] .tick'); if (row) row.replaceWith(tick(m)); }
    }
    function replaceRow(m) {
      const old = listEl.querySelector('[data-id="' + m.id + '"]'); if (!old) return;
      const i = st.msgs.findIndex((x) => x.id === m.id); old.replaceWith(buildRow(m, i > 0 ? st.msgs[i - 1] : null));
    }

    /* ---------- composer ---------- */
    const ta = el("textarea", { class: "chat-input", rows: "1", dir: "auto", placeholder: T("chat.placeholder"), "aria-label": T("chat.placeholder"), autocomplete: "off", enterkeyhint: "send" });
    const counter = el("div", { class: "chat-count tiny", "aria-live": "polite", hidden: true });
    const sendBtn = iconBtn("send", T("chat.send"), () => sendText(), { class: "chat-send", size: 24 });
    const micBtn = iconBtn("mic", T("chat.voice.record"), () => startRecording(), { class: "chat-mic" });
    const imgBtn = iconBtn("image", T("chat.image.attach"), () => pickImage());
    const recTime = el("span", { class: "rec-time num", text: "0:00" });
    const recBar = el("div", { class: "chat-rec", hidden: true }, el("span", { class: "rec-dot", "aria-hidden": "true" }), recTime, el("span", { class: "small muted grow", text: T("chat.voice.recording") }),
      iconBtn("trash-2", T("chat.voice.cancel"), () => cancelRecording(false), { class: "rec-cancel" }), iconBtn("send", T("chat.voice.send"), () => finishRecording(), { class: "chat-send rec-send", size: 24 }));
    const bar = el("div", { class: "chat-bar" }, imgBtn, ta, sendBtn, micBtn);
    const blockedBar = el("div", { class: "chat-blocked", hidden: true }, el("span", { class: "grow small", text: T("chat.blocked_by_me") }), el("button", { type: "button", class: "btn btn-sm", on: { click: () => setBlock(false) } }, icon("user-check", { size: 20 }), T("chat.unblock")));
    const composer = el("div", { class: "chat-composer" }, counter, bar, recBar, blockedBar);
    const jump = el("button", { type: "button", class: "chat-jump", hidden: true, on: { click: () => { toBottom(true); seen(); } } }, icon("chevron-down", { size: 20 }), el("span", { class: "jump-txt", text: T("chat.new_messages") }));

    function syncComposer() {
      const text = ta.value.trim(), over = ta.value.trim().length > MAX_TEXT, blocked = !!conv.blocked_by_me, recording = !!st.rec;
      sendBtn.hidden = !text; micBtn.hidden = !!text; sendBtn.disabled = over || st.sending; micBtn.disabled = st.sending;
      bar.hidden = blocked || recording; recBar.hidden = !recording; blockedBar.hidden = !blocked;
      const len = ta.value.trim().length; counter.hidden = len < 1800 || blocked || recording; counter.className = "chat-count tiny" + (over ? " over" : "");
      counter.textContent = over ? T("chat.too_long", { n: E.i18n.number(len - MAX_TEXT) }) : E.i18n.number(len) + " / " + E.i18n.number(MAX_TEXT);
    }
    const autosize = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; };
    ta.addEventListener("input", () => { autosize(); syncComposer(); });
    const coarse = g.matchMedia && g.matchMedia("(pointer: coarse)").matches;
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !coarse) { e.preventDefault(); sendText(); } });

    async function sendText() {
      const text = ta.value.replace(/\r\n?/g, "\n").trim();
      if (!text || st.sending) return;
      if (text.length > MAX_TEXT) { E.ui.toast(T("chat.err.long"), "err"); return; }
      st.sending = true; ta.readOnly = true; syncComposer();
      try { const r = await CH.send(id, { kind: "text", body: text }); ta.value = ""; autosize(); addMsg(r.message); }
      catch (e) { E.ui.toast(CH.errorText(e), "err"); }
      finally { st.sending = false; ta.readOnly = false; syncComposer(); if (!coarse) ta.focus({ preventScroll: true }); }
    }
    async function sendMedia(kind, blob, extra) {
      st.sending = true; syncComposer();
      try {
        const up = await E.api.upload(kind === "voice" ? "voice" : "chat_image", blob, extra);
        const r = await CH.send(id, kind === "voice" ? { kind: "voice", media_id: up.id, duration_ms: Number(extra && extra["X-Duration-Ms"]) || 0 } : { kind: "image", media_id: up.id });
        addMsg(r.message);
      } catch (e) { E.ui.toast(CH.errorText(e, kind), "err"); }
      finally { st.sending = false; syncComposer(); }
    }

    /* photos: pick -> shrink in the browser -> preview -> upload (a small JPEG, never the original) */
    async function pickImage() {
      if (st.sending || st.rec) return;
      const f = await E.media.pickFile("image/*"); if (!f || !alive) return;
      let blob; try { blob = await E.media.compress(f, { maxSide: 1280, maxBytes: 400e3 }); } catch (e) { E.ui.toast(e && e.i18n ? T(e.i18n) : T("crop.err.load"), "err"); return; }
      if (!blob) { E.ui.toast(T("crop.err.load"), "err"); return; }
      const url = URL.createObjectURL(blob);
      const ok = await E.ui.confirm({ title: T("chat.image.send_title"), body: el("img", { class: "chat-preview", src: url, alt: T("chat.image.alt") }), confirmLabel: T("chat.image.send") });
      URL.revokeObjectURL(url); if (ok && alive) sendMedia("image", blob);
    }

    /* voice notes: MediaRecorder, max 2 minutes, friendly messages for every way it can fail */
    const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    const micError = (e) => { const n = e && e.name; return T(n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError" ? "chat.voice.denied" : n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError" ? "chat.voice.nomic" : n === "NotReadableError" || n === "TrackStartError" || n === "AbortError" ? "chat.voice.busy" : "chat.voice.failed"); };
    async function startRecording() {
      if (st.rec || st.sending) return;
      if (!g.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { E.ui.toast(T(g.isSecureContext === false ? "chat.voice.insecure" : "chat.voice.unsupported"), "err"); return; }
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { E.ui.toast(micError(e), "err"); return; }
      const free = () => stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      if (!alive) { free(); return; }
      let rec, mime = ""; try { mime = typeof g.MediaRecorder.isTypeSupported === "function" ? MIMES.find((x) => g.MediaRecorder.isTypeSupported(x)) || "" : ""; rec = mime ? new g.MediaRecorder(stream, { mimeType: mime }) : new g.MediaRecorder(stream); }
      catch (e) { free(); E.ui.toast(T("chat.voice.unsupported"), "err"); return; }
      const chunks = []; rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      const r = st.rec = { rec, chunks, t0: performance.now(), cancelled: false, iv: null, free };
      rec.onstop = async () => {
        clearInterval(r.iv); free(); if (st.rec === r) st.rec = null; syncComposer();
        if (r.cancelled || !alive) return;
        const ms = Math.min(MAX_VOICE_MS, Math.round(performance.now() - r.t0));
        if (ms < MIN_VOICE_MS) { E.ui.toast(T("chat.voice.short"), "err"); return; }
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        if (!blob.size) { E.ui.toast(T("chat.voice.failed"), "err"); return; }
        if (blob.size > 3.4e6) { E.ui.toast(T("chat.err.large"), "err"); return; }
        sendMedia("voice", blob, { "X-Duration-Ms": String(ms) });
      };
      rec.onerror = () => { clearInterval(r.iv); free(); if (st.rec === r) st.rec = null; syncComposer(); E.ui.toast(T("chat.voice.failed"), "err"); };
      try { rec.start(); } catch (e) { clearInterval(r.iv); free(); st.rec = null; E.ui.toast(T("chat.voice.failed"), "err"); return; }
      recTime.textContent = "0:00"; syncComposer();
      r.iv = setInterval(() => { const elapsed = performance.now() - r.t0; recTime.textContent = mmss(elapsed / 1000); if (elapsed >= MAX_VOICE_MS) { E.ui.toast(T("chat.voice.max"), "ok"); finishRecording(); } }, 250);
    }
    function finishRecording() { const r = st.rec; if (!r) return; clearInterval(r.iv); try { if (r.rec.state !== "inactive") r.rec.stop(); else r.rec.onstop(); } catch (_) { r.rec.onstop(); } }
    function cancelRecording(silent) {
      const r = st.rec; if (!r) return; r.cancelled = true; clearInterval(r.iv);
      try { if (r.rec.state !== "inactive") r.rec.stop(); } catch (_) {} r.free(); st.rec = null; if (!silent) syncComposer();
    }

    /* ---------- messages: add / merge / older / delete ---------- */
    function seen() { st.unseen = 0; jump.hidden = true; readSoon(); }
    function showJump() { jump.hidden = false; jump.querySelector(".jump-txt").textContent = st.unseen > 1 ? T("chat.new_messages_n", { n: st.unseen }) : T("chat.new_messages"); }
    const doRead = E.u.debounce(async () => {
      if (!alive) return;
      if (document.hidden || !st.pinned) { st.readPending = true; return; }
      st.readPending = false;
      try { await CH.markRead(id); const c = CH.state.convs && CH.state.convs.find((x) => x.id === id); if (c) c.unread = 0; CH.refreshUnread(); } catch (_) { /* the next message or visit tries again */ }
    }, 120);
    function readSoon() { doRead(); }
    function addMsg(m) {
      if (st.ids.has(m.id)) { const i = st.msgs.findIndex((x) => x.id === m.id); st.msgs[i] = m; replaceRow(m); return; }
      const wasPinned = st.pinned, mine = m.sender_id === uid, last = st.msgs[st.msgs.length - 1];
      st.ids.add(m.id); st.msgs.push(m);
      if (last && m.ts < last.ts) { st.msgs.sort((a, b) => (a.ts < b.ts ? -1 : 1)); renderAll(); }
      else {
        const empty = listEl.querySelector(".chat-empty-note"); if (empty) empty.remove();
        if (!last || CH.dayKey(last.ts) !== CH.dayKey(m.ts)) listEl.appendChild(sep(m.ts));
        listEl.appendChild(buildRow(m, last || null));
      }
      if (mine || wasPinned) { toBottom(true); if (!mine) readSoon(); } else { st.unseen++; showJump(); }
    }
    function markDeleted(mid) {
      const m = st.msgs.find((x) => x.id === mid); if (!m || m.deleted) return;
      if (m.media_url) E.api.releaseBlob(m.media_url);
      Object.assign(m, { deleted: true, body: null, media_url: null, card: null }); replaceRow(m);
    }
    async function loadOlder() {
      if (st.loadingOlder || !st.msgs.length) return; st.loadingOlder = true; olderBtn.setAttribute("aria-busy", "true");
      try {
        const r = await get({ limit: 30, before: st.msgs[0].ts }); if (!alive) return;
        const add = r.messages.filter((x) => !st.ids.has(x.id)); add.forEach((x) => st.ids.add(x.id)); st.msgs = add.concat(st.msgs); st.more = !!r.has_more;
        const h0 = scroller.scrollHeight, t0 = scroller.scrollTop; renderAll(); scroller.scrollTop = t0 + (scroller.scrollHeight - h0);     // the list does not jump
      } catch (e) { E.ui.toast(CH.errorText(e), "err"); } finally { st.loadingOlder = false; olderBtn.removeAttribute("aria-busy"); }
    }
    function removeMsg(m) {
      E.ui.confirm({ title: T("chat.delete.confirm"), text: T("chat.delete.text"), danger: true, confirmLabel: T("chat.delete") }).then(async (ok) => {
        if (!ok || !alive) return;
        try { await E.api.del("/api/chat/messages/" + m.id); markDeleted(m.id); } catch (e) { if (e && e.status === 404) markDeleted(m.id); else E.ui.toast(CH.errorText(e), "err"); }
      });
    }
    /* catch up after a reconnect / a polling tick / the screen coming back; merges new, deleted and read information */
    let syncing = false;
    async function sync(full) {
      if (!st.loaded || syncing || !alive) return; syncing = true;
      try {
        const last = st.msgs.length ? st.msgs[st.msgs.length - 1].ts : null, r = full || !last ? await get({ limit: 30 }) : await get({ after: last }); if (!alive) return;
        if (r.peer_last_read_at) st.peerRead = r.peer_last_read_at;
        for (const m of r.messages) { if (st.ids.has(m.id)) { const i = st.msgs.findIndex((x) => x.id === m.id); st.msgs[i] = m; replaceRow(m); } else if (!full || !st.msgs.length || m.ts > st.msgs[0].ts) addMsg(m); }
        refreshTicks();
      } catch (_) { /* offline: the next tick tries again */ } finally { syncing = false; }
    }

    /* ---------- block / unblock ---------- */
    async function setBlock(on) {
      try { await E.api.rpc(on ? "block_user" : "unblock_user", { p_user: conv.peer_id }); conv.blocked_by_me = on; syncComposer(); E.ui.toast(T(on ? "chat.blocked_ok" : "chat.unblocked_ok"), "ok"); }
      catch (e) { E.ui.toast(CH.errorText(e), "err"); }
    }
    function menu() {
      const m = E.ui.modal([el("h2", { dir: "auto", text: title }), el("div", { class: "stack", style: { marginTop: "10px" } },
        el("a", { class: "btn btn-block", href: "#/player/" + conv.peer_id, on: { click: () => m.close() } }, icon("user", { size: 20 }), T("chat.view_profile")),
        conv.blocked_by_me ? el("button", { type: "button", class: "btn btn-block", on: { click: () => { m.close(); setBlock(false); } } }, icon("user-check", { size: 20 }), T("chat.unblock"))
          : el("button", { type: "button", class: "btn btn-block btn-danger", on: { click: async () => { m.close(); if (await E.ui.confirm({ title: T("chat.block.confirm", { name: title }), text: T("chat.block.text"), danger: true, confirmLabel: T("chat.block") })) setBlock(true); } } }, icon("ban", { size: 20 }), T("chat.block"))),
        el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close() } }, T("common.close")))], { label: title });
    }

    /* ---------- assemble ---------- */
    page.replaceChildren(head, el("div", { class: "chat-body" }, scroller, jump), composer);
    renderAll(); syncComposer(); toBottom(false); st.loaded = true;
    scroller.addEventListener("scroll", () => { st.pinned = atBottom(); if (st.pinned && (st.unseen || st.readPending)) seen(); }, { passive: true });
    if (g.visualViewport) {                                                                      // phones: the keyboard shrinks the visible area, the composer must stay above it
      const vv = g.visualViewport, fit = () => { document.documentElement.style.setProperty("--vvh", vv.height + "px"); if (g.scrollY) g.scrollTo(0, 0); };
      vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit();
      offs.push(() => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); document.documentElement.style.removeProperty("--vvh"); });
    }
    offs.push(E.bus.on("chat:message", (m) => { if (m.conversation_id === id && st.loaded) addMsg(m); }));
    offs.push(E.bus.on("chat:deleted", (d) => { if (d.conversation_id === id) markDeleted(d.id); }));
    offs.push(E.bus.on("chat:read", (d) => {
      if (d.conversation_id !== id) return;
      if (conv.kind === "direct") { if (!st.peerRead || d.at > st.peerRead) st.peerRead = d.at; refreshTicks(); } else sync(true);
    }));
    offs.push(E.bus.on("chat:resync", (d) => sync(!d.poll || d.n % 3 === 0)));
    const onVis = () => { if (!document.hidden && st.readPending) readSoon(); };
    document.addEventListener("visibilitychange", onVis); offs.push(() => document.removeEventListener("visibilitychange", onVis));
    readSoon();                                                                                  // opening the conversation = reading it
    return cleanup;
  }, { auth: true, titleKey: "nav.chat" });
})(window);
