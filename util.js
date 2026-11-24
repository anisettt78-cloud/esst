"use strict";
/* Small helpers shared by media.js, leagueapi.js and chat.js. */
const db = require("./db"), auth = require("./auth"), { HttpErr } = require("./rest");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(req, res, status, body) {
  const s = body == null ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(s) });
  res.end(req.method === "HEAD" ? undefined : s);
}
const err = (status, code, message) => new HttpErr(status, { error: code, message: message || code });
function user(req) { const c = auth.claimsOf(req); if (!c || !c.sub) throw err(401, "NOT_AUTHENTICATED", "Log in first"); return c; }
/* The super-admin check ALWAYS reads the database: a hidden button or a claim in the token is never enough. */
async function requireSuper(req) {
  const c = user(req), r = await db.pool.query("select role from public.profiles where id = $1", [c.sub]);
  if (!r.rowCount || r.rows[0].role !== "super_admin") throw err(403, "FORBIDDEN", "Super admin only");
  return c;
}
async function readRaw(req, max) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw err(413, "TOO_LARGE", "File too large"); chunks.push(c); }
  return Buffer.concat(chunks);
}
module.exports = { json, err, user, requireSuper, readRaw, UUID, HttpErr };
