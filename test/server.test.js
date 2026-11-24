"use strict";
/* Server tests with a FAKE database: they prove permissions, CORS, static-file safety and input checks.
   They do not prove SQL correctness (no PostgreSQL in the test environment). */
process.env.SUPER_ADMIN_PASSWORD = "test-password-123";
const test = require("node:test"), assert = require("node:assert/strict"), http = require("node:http");
const db = require("../db"), auth = require("../auth"), chat = require("../chat"), media = require("../media");
const { handler } = require("../server");

const UID = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ROLES = { [UID(1)]: "member", [UID(2)]: "member", [UID(9)]: "super_admin" };
let log = [], conv = null, blocked = false, superExists = null, mediaRow = null;
db.state.ready = true; db.state.jwt = "k".repeat(40);
const fakeQuery = async (sql, p) => {
  log.push(sql.replace(/\s+/g, " ").slice(0, 90));
  if (/select role from public.profiles/.test(sql)) return ROLES[p[0]] ? { rowCount: 1, rows: [{ role: ROLES[p[0]] }] } : { rowCount: 0, rows: [] };
  if (/from public.conversations c\s+join public.conversation_members/.test(sql)) return conv ? { rowCount: 1, rows: [conv] } : { rowCount: 0, rows: [] };
  if (/from public.blocks/.test(sql)) return { rowCount: blocked ? 1 : 0, rows: blocked ? [{}] : [] };
  if (/select id from public.profiles where role = 'super_admin'/.test(sql)) return superExists ? { rowCount: 1, rows: [{ id: superExists }] } : { rowCount: 0, rows: [] };
  if (/update public.profiles set role = 'super_admin'/.test(sql)) return { rowCount: 1, rows: [{ id: p[0] }] };
  if (/select kind, mime, data, owner_id from public.media/.test(sql)) return mediaRow ? { rowCount: 1, rows: [mediaRow] } : { rowCount: 0, rows: [] };
  if (/from public.messages g join public.conversation_members/.test(sql)) return { rowCount: 0, rows: [] };
  return { rowCount: 1, rows: [{ id: UID(77), n: 0 }] };
};
db.pool = { query: fakeQuery, connect: async () => ({ query: fakeQuery, release() {} }) };

let server, base;
test.before(async () => { server = http.createServer(handler); await new Promise((r) => server.listen(0, r)); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => { server.closeAllConnections && server.closeAllConnections(); server.close(); });
const tok = (id) => auth.sign({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
const call = (method, path, { as, body, headers } = {}) => fetch(base + path, {
  method, headers: Object.assign({ ...(as ? { Authorization: "Bearer " + tok(as) } : {}) }, body && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}, headers),
  body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

test("CORS preflight (incl. Authorization header) on API paths", async () => {
  for (const path of ["/rest/v1/profiles", "/api/chat/direct", "/api/media?kind=avatar", "/auth/v1/token"]) {
    const r = await call("OPTIONS", path, { headers: { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.match(r.headers.get("access-control-allow-headers").toLowerCase(), /authorization/);
    assert.match(r.headers.get("access-control-allow-methods"), /DELETE/);
  }
  const g = await call("GET", "/health"); assert.equal(g.headers.get("access-control-allow-origin"), "*");
});

test("static files: only the website is served, never server code or SQL", async () => {
  assert.equal((await call("GET", "/config.js")).status, 200);
  for (const p of ["/server.js", "/db.js", "/auth.js", "/schema.sql", "/migrations/001_roles_profiles.sql", "/package.json", "/.git/config", "/test/server.test.js", "/node_modules/pg/index.js"])
    assert.equal((await call("GET", p)).status, 404, p);
  for (const p of ["/..%2fserver.js", "/assets/..%2f..%2fserver.js", "/assets/%2e%2e/server.js", "/css/..%5cserver.js"]) assert.notEqual((await call("GET", p)).status, 200, p);
  const fb = await call("GET", "/migrations"); assert.equal(fb.status, 200); assert.match(await fb.text(), /id="root"/, "extension-less unknown paths give the app page, never a file");
  const gz = await fetch(base + "/config.js", { headers: { "Accept-Encoding": "gzip" } }); assert.equal(gz.status, 200); assert.match(await gz.text(), /API_BASE/);
  const e = await call("GET", "/config.js"), et = e.headers.get("etag"); assert.equal((await call("GET", "/config.js", { headers: { "If-None-Match": et } })).status, 304);
});

test("visitors (no token) are refused on every protected route", async () => {
  const routes = [["GET", "/api/chat/conversations"], ["GET", "/api/chat/unread"], ["POST", "/api/chat/direct"], ["GET", "/api/chat/stream"],
    ["GET", `/api/chat/conversations/${UID(5)}/messages`], ["POST", `/api/chat/conversations/${UID(5)}/messages`], ["DELETE", `/api/chat/messages/${UID(5)}`],
    ["POST", "/api/media?kind=avatar"], ["GET", "/api/league/checks"], ["GET", "/api/league/impact"], ["POST", "/api/league/launch"], ["POST", "/api/league/rebuild"]];
  for (const [m, p] of routes) assert.equal((await call(m, p, { body: m === "POST" ? {} : undefined })).status, 401, m + " " + p);
  mediaRow = { kind: "voice", mime: "audio/webm", data: Buffer.from("x"), owner_id: UID(1) };
  assert.equal((await call("GET", "/api/media/" + UID(5))).status, 401, "private chat media needs a login");
  mediaRow = { kind: "avatar", mime: "image/jpeg", data: Buffer.from(JPEG), owner_id: UID(1) };
  const pub = await call("GET", "/api/media/" + UID(5)); assert.equal(pub.status, 200); assert.equal(pub.headers.get("content-type"), "image/jpeg");
  assert.equal(pub.headers.get("x-content-type-options"), "nosniff");
});

test("a normal member / captain is refused every super-admin action", async () => {
  for (const [m, p] of [["GET", "/api/league/checks"], ["GET", "/api/league/impact"], ["POST", "/api/league/launch"], ["POST", "/api/league/rebuild"], ["POST", "/api/media?kind=logo"]]) {
    const r = await call(m, p, { as: UID(1), body: m === "POST" && !p.includes("media") ? { confirm: "REBUILD" } : undefined, headers: p.includes("media") ? { "Content-Type": "application/octet-stream" } : {} });
    assert.equal(r.status, 403, m + " " + p);
  }
  assert.equal((await call("GET", "/api/league/checks", { as: UID(404) })).status, 403, "a token for an unknown user is not an admin");
  assert.equal((await call("GET", "/api/league/checks", { headers: { Authorization: "Bearer a.b.c" } })).status, 401, "forged token");
});

test("rebuild needs the typed confirmation, even for the super admin", async () => {
  const r = await call("POST", "/api/league/rebuild", { as: UID(9), body: {} });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, "CONFIRMATION_REQUIRED");
  assert.equal((await call("POST", "/api/league/rebuild", { as: UID(9), body: { confirm: "yes" } })).status, 400);
});

test("media upload checks (kind, real file type, size, voice length)", async () => {
  assert.equal((await call("POST", "/api/media?kind=nope", { as: UID(1), body: JPEG })).status, 400);
  assert.equal((await call("POST", "/api/media?kind=avatar", { as: UID(1), body: new TextEncoder().encode("<script>alert(1)</script> not an image") })).status, 415);
  assert.equal((await call("POST", "/api/media?kind=voice", { as: UID(1), body: JPEG })).status, 415, "an image is not a voice note");
  assert.equal((await call("POST", "/api/media?kind=avatar", { as: UID(1), body: new Uint8Array(2.1e6).fill(0xff) })).status, 413);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal((await call("POST", "/api/media?kind=voice", { as: UID(1), body: webm, headers: { "X-Duration-Ms": "130000" } })).status, 413);
  log = []; const ok = await call("POST", "/api/media?kind=avatar", { as: UID(1), body: JPEG });
  assert.equal(ok.status, 201); const j = await ok.json(); assert.match(j.url, /^\/api\/media\//); assert.equal(j.mime, "image/jpeg");
  assert.ok(log.some((l) => /update public.profiles set photo_url/.test(l)), "avatar upload sets the profile photo");
  assert.equal((await call("POST", "/api/media?kind=logo", { as: UID(9), body: JPEG })).status, 201, "super admin may upload logos");
});

test("chat: only members can read or write; blocks, size and spam limits", async () => {
  conv = null;
  assert.equal((await call("GET", `/api/chat/conversations/${UID(5)}/messages`, { as: UID(1) })).status, 404, "non-member cannot read a team chat");
  assert.equal((await call("POST", `/api/chat/conversations/${UID(5)}/messages`, { as: UID(1), body: { kind: "text", body: "hi" } })).status, 404, "non-member cannot post");
  assert.equal((await call("POST", `/api/chat/conversations/not-a-uuid/read`, { as: UID(1) })).status, 404);
  conv = { id: UID(5), kind: "team", team_id: UID(6), user_a: null, user_b: null };
  const post = (u, b) => call("POST", `/api/chat/conversations/${UID(5)}/messages`, { as: u, body: b });
  assert.equal((await post(UID(1), { kind: "text", body: "   " })).status, 400);
  assert.equal((await post(UID(1), { kind: "text", body: "x".repeat(2001) })).status, 413);
  assert.equal((await post(UID(1), { kind: "gif" })).status, 400);
  assert.equal((await post(UID(1), { kind: "card", card: { type: "evil", id: UID(3) } })).status, 400);
  assert.equal((await post(UID(1), { kind: "card", card: { type: "match", id: "nope" } })).status, 400);
  assert.equal((await post(UID(1), { kind: "voice", media_id: "nope" })).status, 400);
  conv = { id: UID(5), kind: "direct", team_id: null, user_a: UID(1), user_b: UID(2) }; blocked = true;
  assert.equal((await post(UID(1), { kind: "text", body: "hello" })).status, 403, "blocked users cannot message each other");
  assert.equal((await call("POST", "/api/chat/direct", { as: UID(1), body: { user_id: UID(2) } })).status, 403);
  assert.equal((await call("POST", "/api/chat/direct", { as: UID(1), body: { user_id: UID(1) } })).status, 400, "no chat with yourself");
  blocked = false;
  const sent = await post(UID(2), { kind: "text", body: "<img src=x onerror=alert(1)>" });
  assert.equal(sent.status, 201, "text is stored as-is (it is escaped when displayed)");
  let last; for (let i = 0; i < 25; i++) last = await post(UID(2), { kind: "text", body: "msg " + i });
  assert.equal(last.status, 429, "rate limit after 20 messages / minute");
  assert.equal((await call("DELETE", `/api/chat/messages/${UID(5)}`, { as: UID(1) })).status, 200);
});

test("team chat: only people on that team get its conversation id", async () => {
  conv = null; assert.equal((await call("GET", `/api/chat/team/${UID(6)}`, { as: UID(1) })).status, 404);
  assert.equal((await call("GET", `/api/chat/team/${UID(6)}`)).status, 401);
  conv = { id: UID(5), kind: "team", team_id: UID(6) }; const r = await call("GET", `/api/chat/team/${UID(6)}`, { as: UID(1) });
  assert.equal(r.status, 200); assert.equal((await r.json()).id, UID(5));
});

test("text cleaning and file sniffing", () => {
  assert.equal(chat.cleanText("a\u0000b\u202Ec\r\nd  "), "abc\nd");
  assert.equal(media.sniff(Buffer.from(JPEG)), "image/jpeg");
  assert.equal(media.sniff(Buffer.from("<html>not an image at all</html>")), null);
  assert.equal(media.sniff(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
  assert.equal(media.sniff(Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n"), Buffer.alloc(8)])), "image/png");
});

test("single super admin: a second activation is refused, handover is the only way", async () => {
  const act = (as, pw) => call("POST", "/api/activate-admin", { as, body: { password: pw } });
  superExists = UID(9);
  assert.equal((await act(UID(1), "wrong")).status, 403, "wrong password");
  const r = await act(UID(1), "test-password-123"); assert.equal(r.status, 409); assert.equal((await r.json()).error, "SUPER_ADMIN_EXISTS");
  assert.equal((await act(UID(9), "test-password-123")).status, 200, "the current super admin re-activating is harmless");
  superExists = null; assert.equal((await act(UID(2), "test-password-123")).status, 200, "first activation works");
  let last; for (let i = 0; i < 7; i++) last = await act(UID(1), "bad" + i);
  assert.equal(last.status, 429, "lockout after repeated wrong passwords");
});
