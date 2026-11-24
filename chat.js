"use strict";
/* Private chat + team group chat. The generic REST layer cannot touch these tables: every read and write goes through here,
   and every route first checks that the caller is a MEMBER of the conversation (team chats: roster + super admin, kept in sync by the database).
   Live delivery: Server-Sent Events (GET /api/chat/stream, read with fetch so the Authorization header can be sent); clients fall back to polling. */
const crypto = require("node:crypto");
const db = require("./db"), auth = require("./auth"), U = require("./util");

/* ---------- text safety ---------- */
function cleanText(s) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "")   // control + bidi-override characters
    .replace(/\r\n?/g, "\n").trim();
}

/* ---------- live hub ---------- */
const clients = new Map();                                    // userId -> Set(res)
function addClient(uid, res) {
  let s = clients.get(uid); if (!s) clients.set(uid, (s = new Set()));
  if (s.size >= 5) { const old = s.values().next().value; try { old.end(); } catch (_) {} s.delete(old); }
  s.add(res);
}
function dropClient(uid, res) { const s = clients.get(uid); if (s) { s.delete(res); if (!s.size) clients.delete(uid); } }
function push(userIds, type, data) {
  const payload = "event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n";
  for (const u of userIds) { const s = clients.get(u); if (s) for (const r of s) { try { r.write(payload); } catch (_) {} } }
}
setInterval(() => { for (const s of clients.values()) for (const r of s) { try { r.write(": ping\n\n"); } catch (_) {} } }, 25e3).unref();

/* ---------- queries ---------- */
const MSG_SELECT = `select m.id, m.conversation_id, m.sender_id, m.kind, m.body,
    case when m.media_id is not null then '/api/media/' || m.media_id end as media_url,
    m.duration_ms, m.card, (m.deleted_at is not null) as deleted,
    to_char(m.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts,
    sp.full_name as sender_full_name, sp.nickname as sender_nickname, sp.display_name as sender_display_name, sp.photo_url as sender_photo,
    (select count(*)::int from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id and cm.last_read_at >= m.created_at) as read_by,
    (select count(*)::int from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id) as recipients
  from public.messages m join public.profiles sp on sp.id = m.sender_id`;

async function membership(uid, convId) {
  if (!U.UUID.test(convId)) throw U.err(404, "NOT_FOUND");
  const r = await db.pool.query(`select c.id, c.kind, c.team_id, c.user_a, c.user_b from public.conversations c
                                  join public.conversation_members cm on cm.conversation_id = c.id and cm.user_id = $2 where c.id = $1`, [convId, uid]);
  if (!r.rowCount) throw U.err(404, "NOT_FOUND");                // not a member = it does not exist for you
  return r.rows[0];
}
const peerOf = (conv, uid) => (conv.kind === "direct" ? (conv.user_a === uid ? conv.user_b : conv.user_a) : null);
async function isBlocked(a, b) {
  return (await db.pool.query("select 1 from public.blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1", [a, b])).rowCount > 0;
}
async function memberIds(convId) { return (await db.pool.query("select user_id from public.conversation_members where conversation_id = $1", [convId])).rows.map((r) => r.user_id); }

/* ---------- handlers ---------- */
async function inbox(req, res) {
  const c = U.user(req);
  const r = await db.pool.query(`select c.id, c.kind, c.team_id, t.name as team_name, t.short_name as team_short, t.logo_url as team_logo, t.color_primary as team_color,
      peer.id as peer_id, peer.full_name as peer_full_name, peer.nickname as peer_nickname, peer.display_name as peer_display_name, peer.photo_url as peer_photo,
      (peer.id is not null and exists (select 1 from public.blocks b where b.blocker_id = $1 and b.blocked_id = peer.id)) as blocked_by_me,
      to_char(coalesce(c.last_message_at, c.created_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts,
      (select count(*)::int from public.messages m where m.conversation_id = c.id and m.sender_id <> $1 and m.deleted_at is null and m.created_at > cm.last_read_at) as unread,
      (select to_jsonb(x) from (select m.id, m.kind, m.sender_id, (m.deleted_at is not null) as deleted,
            case when m.deleted_at is null then left(m.body, 120) end as body
            from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1) x) as last_message
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    left join public.teams t on t.id = c.team_id
    left join public.profiles peer on peer.id = case when c.kind = 'direct' then (case when c.user_a = $1 then c.user_b else c.user_a end) end
    where cm.user_id = $1
    order by coalesce(c.last_message_at, c.created_at) desc limit 100`, [c.sub]);
  return U.json(req, res, 200, { conversations: r.rows });
}

async function openDirect(req, res) {
  const c = U.user(req), body = (await auth.readBody(req)) || {}, other = String(body.user_id || "");
  if (!U.UUID.test(other) || other === c.sub) throw U.err(400, "INVALID_USER");
  if (!auth.hit("newconv|" + c.sub, 20, 600e3)) throw U.err(429, "RATE_LIMITED", "Too many new conversations");
  if (!(await db.pool.query("select 1 from public.profiles where id = $1", [other])).rowCount) throw U.err(404, "PLAYER_NOT_FOUND");
  if (await isBlocked(c.sub, other)) throw U.err(403, "BLOCKED", "You cannot message this user");
  const [a, b] = [c.sub, other].sort();                         // lowercase uuids sort the same way as in PostgreSQL
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    await client.query("insert into public.conversations (kind, user_a, user_b) values ('direct', $1, $2) on conflict do nothing", [a, b]);
    const id = (await client.query("select id from public.conversations where kind = 'direct' and user_a = $1 and user_b = $2", [a, b])).rows[0].id;
    await client.query("insert into public.conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3) on conflict do nothing", [id, a, b]);
    await client.query("commit");
    return U.json(req, res, 200, { id });
  } catch (e) { try { await client.query("rollback"); } catch (_) {} throw e; } finally { client.release(); }
}

async function listMessages(req, res, convId, url) {
  const c = U.user(req), conv = await membership(c.sub, convId);
  const lim = Math.max(1, Math.min(parseInt(url.searchParams.get("limit"), 10) || 30, 50));
  const before = url.searchParams.get("before"), after = url.searchParams.get("after");
  const tsOk = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(s || "");
  let rows, more = false;
  if (after) {
    if (!tsOk(after)) throw U.err(400, "INVALID_CURSOR");
    rows = (await db.pool.query(MSG_SELECT + " where m.conversation_id = $1 and m.created_at > $2::timestamptz order by m.created_at asc limit 100", [convId, after])).rows;
  } else {
    if (before && !tsOk(before)) throw U.err(400, "INVALID_CURSOR");
    const q = await db.pool.query(MSG_SELECT + " where m.conversation_id = $1" + (before ? " and m.created_at < $3::timestamptz" : "") + " order by m.created_at desc limit $2",
      before ? [convId, lim + 1, before] : [convId, lim + 1]);
    more = q.rows.length > lim; rows = q.rows.slice(0, lim).reverse();
  }
  let peerRead = null;
  if (conv.kind === "direct") {
    const r = await db.pool.query("select to_char(last_read_at at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as t from public.conversation_members where conversation_id = $1 and user_id <> $2 limit 1", [convId, c.sub]);
    peerRead = r.rows[0] ? r.rows[0].t : null;
  }
  return U.json(req, res, 200, { messages: rows, has_more: more, peer_last_read_at: peerRead, kind: conv.kind });
}

async function checkCard(card) {
  if (!card || typeof card !== "object" || !["match", "player", "team"].includes(card.type) || !U.UUID.test(String(card.id || ""))) throw U.err(400, "INVALID_CARD");
  const tbl = { match: "matches", player: "profiles", team: "teams" }[card.type];
  if (!(await db.pool.query("select 1 from public." + tbl + " where id = $1", [card.id])).rowCount) throw U.err(404, "CARD_TARGET_NOT_FOUND");
  return { type: card.type, id: String(card.id).toLowerCase() };
}

async function sendMessage(req, res, convId) {
  const c = U.user(req), conv = await membership(c.sub, convId), body = (await auth.readBody(req)) || {};
  if (!auth.hit("msg|" + c.sub, 20, 60e3) || !auth.hit("msgh|" + c.sub, 400, 3600e3)) throw U.err(429, "RATE_LIMITED", "You are sending too fast");
  const peer = peerOf(conv, c.sub);
  if (peer && (await isBlocked(c.sub, peer))) throw U.err(403, "BLOCKED", "You cannot message this user");
  const kind = String(body.kind || "text");
  let text = null, mediaId = null, dur = null, card = null;
  if (kind === "text") {
    text = cleanText(body.body);
    if (!text) throw U.err(400, "EMPTY_MESSAGE");
    if (text.length > 2000) throw U.err(413, "TOO_LONG", "Messages are limited to 2000 characters");
    if (!auth.hit("dup|" + c.sub + "|" + crypto.createHash("sha1").update(text).digest("hex"), 3, 30e3)) throw U.err(429, "RATE_LIMITED", "Do not repeat the same message");
  } else if (kind === "voice" || kind === "image") {
    mediaId = String(body.media_id || "");
    if (!U.UUID.test(mediaId)) throw U.err(400, "INVALID_MEDIA");
    const m = (await db.pool.query("select kind, owner_id, duration_ms from public.media where id = $1", [mediaId])).rows[0];
    if (!m || m.owner_id !== c.sub || m.kind !== (kind === "voice" ? "voice" : "chat_image")) throw U.err(400, "INVALID_MEDIA");
    if ((await db.pool.query("select 1 from public.messages where media_id = $1 limit 1", [mediaId])).rowCount) throw U.err(400, "INVALID_MEDIA");
    if (kind === "voice") dur = m.duration_ms != null ? m.duration_ms : Math.max(0, Math.min(parseInt(body.duration_ms, 10) || 0, 125000));
  } else if (kind === "card") card = await checkCard(body.card);
  else throw U.err(400, "INVALID_KIND");

  const client = await db.pool.connect(); let id;
  try {
    await client.query("begin");
    id = (await client.query("insert into public.messages (conversation_id, sender_id, kind, body, media_id, duration_ms, card) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [convId, c.sub, kind, text, mediaId, dur, card ? JSON.stringify(card) : null])).rows[0].id;
    await client.query("update public.conversations set last_message_at = now() where id = $1", [convId]);
    await client.query("update public.conversation_members set last_read_at = now() where conversation_id = $1 and user_id = $2", [convId, c.sub]);
    await client.query("commit");
  } catch (e) { try { await client.query("rollback"); } catch (_) {} throw e; } finally { client.release(); }
  const msg = (await db.pool.query(MSG_SELECT + " where m.id = $1", [id])).rows[0];
  push(await memberIds(convId), "message", msg);
  return U.json(req, res, 201, { message: msg });
}

async function deleteMessage(req, res, id) {
  const c = U.user(req);
  if (!U.UUID.test(id)) throw U.err(404, "NOT_FOUND");
  const old = await db.pool.query("select conversation_id, media_id from public.messages where id = $1 and sender_id = $2 and deleted_at is null", [id, c.sub]);
  if (!old.rowCount) throw U.err(404, "NOT_FOUND");               // not yours / already deleted
  const convId = old.rows[0].conversation_id, mediaId = old.rows[0].media_id;
  await db.pool.query("update public.messages set body = null, media_id = null, card = null, deleted_at = now() where id = $1 and sender_id = $2", [id, c.sub]);
  if (mediaId) await db.pool.query("delete from public.media where id = $1", [mediaId]);
  push(await memberIds(convId), "message_deleted", { id, conversation_id: convId });
  return U.json(req, res, 200, { ok: true });
}

async function markRead(req, res, convId) {
  const c = U.user(req); await membership(c.sub, convId);
  const r = await db.pool.query("update public.conversation_members set last_read_at = now() where conversation_id = $1 and user_id = $2 returning to_char(last_read_at at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as t", [convId, c.sub]);
  push((await memberIds(convId)).filter((u) => u !== c.sub), "read", { conversation_id: convId, user_id: c.sub, at: r.rows[0].t });
  return U.json(req, res, 200, { ok: true });
}

async function unread(req, res) {
  const c = U.user(req);
  const r = await db.pool.query(`select count(*)::int as n from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = $1
                                  where m.sender_id <> $1 and m.deleted_at is null and m.created_at > cm.last_read_at`, [c.sub]);
  return U.json(req, res, 200, { unread: r.rows[0].n });
}

function stream(req, res) {
  const c = U.user(req);
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\nevent: ready\ndata: {}\n\n");
  addClient(c.sub, res);
  const stop = setTimeout(() => { try { res.end(); } catch (_) {} }, Math.max(1000, (c.exp || 0) * 1000 - Date.now()));   // close when the token expires; the client re-connects with a fresh one
  req.on("close", () => { clearTimeout(stop); dropClient(c.sub, res); });
}

async function teamConversation(req, res, teamId) {
  const c = U.user(req);
  if (!U.UUID.test(teamId)) throw U.err(404, "NOT_FOUND");
  const r = await db.pool.query(`select c.id from public.conversations c join public.conversation_members cm on cm.conversation_id = c.id and cm.user_id = $2
                                  where c.kind = 'team' and c.team_id = $1`, [teamId, c.sub]);
  if (!r.rowCount) throw U.err(404, "NOT_FOUND");                 // not on that team = no chat for you
  return U.json(req, res, 200, { id: r.rows[0].id });
}

async function handle(req, res, p, url) {
  const m = req.method;
  if (p === "/api/chat/stream" && m === "GET") return stream(req, res);
  if (p === "/api/chat/unread" && m === "GET") return unread(req, res);
  if (p === "/api/chat/conversations" && m === "GET") return inbox(req, res);
  if (p === "/api/chat/direct" && m === "POST") return openDirect(req, res);
  let x;
  if ((x = /^\/api\/chat\/team\/([^/]+)$/.exec(p)) && m === "GET") return teamConversation(req, res, x[1]);
  if ((x = /^\/api\/chat\/conversations\/([^/]+)\/messages$/.exec(p))) { if (m === "GET") return listMessages(req, res, x[1], url); if (m === "POST") return sendMessage(req, res, x[1]); }
  if ((x = /^\/api\/chat\/conversations\/([^/]+)\/read$/.exec(p)) && m === "POST") return markRead(req, res, x[1]);
  if ((x = /^\/api\/chat\/messages\/([^/]+)$/.exec(p)) && m === "DELETE") return deleteMessage(req, res, x[1]);
  throw U.err(404, "NOT_FOUND");
}
module.exports = { handle, cleanText, push, clients };
