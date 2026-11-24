"use strict";
/* Photos, logos, voice notes and chat pictures are stored IN PostgreSQL (Railway's disk is not permanent).
   POST /api/media?kind=avatar|logo|voice|chat_image   body = the raw file     -> { id, url }
   GET  /api/media/:id                                 -> the file */
const db = require("./db"), auth = require("./auth"), U = require("./util");
const LIMITS = { avatar: 2e6, logo: 2e6, chat_image: 2e6, voice: 3.5e6 };

/* The type is decided from the file's first bytes, never from what the browser claims. */
function sniff(b) {
  if (!b || b.length < 12) return null;
  const s4 = b.toString("latin1", 0, 4);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s4.slice(1) === "PNG") return "image/png";
  if (s4 === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (s4 === "OggS") return "audio/ogg";
  if (b.toString("latin1", 4, 8) === "ftyp") return "audio/mp4";
  if (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}
const isImage = (m) => /^image\//.test(m || "");

async function upload(req, res, url) {
  const c = U.user(req), kind = url.searchParams.get("kind");
  if (!LIMITS[kind]) throw U.err(400, "INVALID_KIND");
  if (kind === "logo") await U.requireSuper(req);
  if (!auth.hit("up|" + kind + "|" + c.sub, kind === "avatar" ? 10 : kind === "logo" ? 60 : 30, kind === "avatar" ? 3600e3 : 60e3)) throw U.err(429, "RATE_LIMITED", "Too many uploads, slow down");
  if (Number(req.headers["content-length"] || 0) > LIMITS[kind]) throw U.err(413, "TOO_LARGE", "File too large");
  const buf = await U.readRaw(req, LIMITS[kind]), mime = sniff(buf);
  if (!mime || (kind === "voice") === isImage(mime)) throw U.err(415, "UNSUPPORTED_TYPE", "Unsupported file type");
  let dur = null;
  if (kind === "voice") {
    dur = parseInt(req.headers["x-duration-ms"], 10);
    if (!Number.isFinite(dur) || dur < 0) dur = null;
    if (dur != null && dur > 125000) throw U.err(413, "TOO_LONG", "Voice notes are limited to 2 minutes");
  }
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const r = await client.query("insert into public.media (owner_id, kind, mime, size_bytes, duration_ms, data) values ($1,$2,$3,$4,$5,$6) returning id", [c.sub, kind, mime, buf.length, dur, buf]);
    const id = r.rows[0].id, path = "/api/media/" + id;
    if (kind === "avatar") {
      await client.query("update public.profiles set photo_url = $2 where id = $1", [c.sub, path]);
      await client.query("delete from public.media where owner_id = $1 and kind = 'avatar' and id <> $2", [c.sub, id]);
    }
    await client.query("commit");
    return U.json(req, res, 201, { id, url: path, mime, size: buf.length, duration_ms: dur });
  } catch (e) { try { await client.query("rollback"); } catch (_) {} throw e; }
  finally { client.release(); }
}

async function download(req, res, id) {
  if (!U.UUID.test(id)) throw U.err(404, "NOT_FOUND");
  const r = await db.pool.query("select kind, mime, data, owner_id from public.media where id = $1", [id]), m = r.rows[0];
  if (!m) throw U.err(404, "NOT_FOUND");
  const pub = m.kind === "avatar" || m.kind === "logo";
  if (!pub) {                       // chat media: only the uploader (before sending) or a member of the conversation it was sent in
    const c = U.user(req);
    const ok = m.owner_id === c.sub || (await db.pool.query(
      "select 1 from public.messages g join public.conversation_members cm on cm.conversation_id = g.conversation_id and cm.user_id = $2 where g.media_id = $1 and g.deleted_at is null limit 1", [id, c.sub])).rowCount > 0;
    if (!ok) throw U.err(404, "NOT_FOUND");
  }
  res.writeHead(200, { "Content-Type": m.mime, "Content-Length": m.data.length, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": pub ? "public, max-age=31536000, immutable" : "private, max-age=3600", ETag: '"' + id + '"' });
  res.end(req.method === "HEAD" ? undefined : m.data);
}

async function handle(req, res, p, url) {
  if (p === "/api/media" && req.method === "POST") return upload(req, res, url);
  const m = /^\/api\/media\/([^/]+)$/.exec(p);
  if (m && (req.method === "GET" || req.method === "HEAD")) return download(req, res, m[1]);
  throw U.err(404, "NOT_FOUND");
}

/* hourly: remove uploads that were never attached to anything (abandoned previews, replaced logos) */
function startCleanup() {
  setInterval(() => {
    if (!db.state.ready) return;
    db.pool.query(`delete from public.media m where m.created_at < now() - interval '1 day' and (
        (m.kind in ('voice','chat_image') and not exists (select 1 from public.messages g where g.media_id = m.id)) or
        (m.kind = 'logo'   and not exists (select 1 from public.teams t where t.logo_url = '/api/media/' || m.id)) or
        (m.kind = 'avatar' and not exists (select 1 from public.profiles p where p.photo_url = '/api/media/' || m.id)))`).catch((e) => console.error("[media] cleanup:", e.message));
  }, 3600e3).unref();
}
module.exports = { handle, sniff, startCleanup };
