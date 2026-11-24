"use strict";
/* The live-delivery stream on the REAL server code (it needs no database): headers, CORS from file://, auth, events, connection cap, token expiry. */
process.env.SUPER_ADMIN_PASSWORD = "test-password-123";
const test = require("node:test"), assert = require("node:assert/strict"), http = require("node:http");
const db = require("../db"), auth = require("../auth"), chat = require("../chat");
const { handler } = require("../server");
db.state.ready = true; db.state.jwt = "k".repeat(40);
const UID = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
let server, base;
test.before(async () => { server = http.createServer(handler); await new Promise((r) => server.listen(0, r)); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => { server.closeAllConnections && server.closeAllConnections(); server.close(); });
const tok = (id, secs = 600) => auth.sign({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + secs });
async function open(id, secs, extra) { const ctrl = new AbortController(), res = await fetch(base + "/api/chat/stream", { headers: { Authorization: "Bearer " + tok(id, secs), Accept: "text/event-stream", ...extra }, signal: ctrl.signal }); return { res, ctrl, reader: res.body ? res.body.getReader() : null, dec: new TextDecoder() }; }
async function chunk(s, ms = 1500) { const t = new Promise((r) => setTimeout(() => r({ timeout: true }), ms)); const r = await Promise.race([s.reader.read(), t]); return r.timeout ? null : r.done ? "" : s.dec.decode(r.value); }

test("stream: visitors and forged tokens are refused (401)", async () => {
  assert.equal((await fetch(base + "/api/chat/stream")).status, 401);
  assert.equal((await fetch(base + "/api/chat/stream", { headers: { Authorization: "Bearer a.b.c" } })).status, 401);
});
test("stream: event-stream headers, CORS for a file:// page (Origin null), ready event first", async () => {
  const s = await open(UID(1), 600, { Origin: "null" });
  assert.equal(s.res.status, 200); assert.match(s.res.headers.get("content-type"), /text\/event-stream/);
  assert.match(s.res.headers.get("cache-control"), /no-cache/); assert.equal(s.res.headers.get("access-control-allow-origin"), "*"); assert.equal(s.res.headers.get("x-accel-buffering"), "no");
  assert.match(await chunk(s), /event: ready/); s.ctrl.abort();
});
test("stream: a pushed message reaches only the members it is addressed to", async () => {
  const a = await open(UID(1)), b = await open(UID(2)); await chunk(a); await chunk(b);
  chat.push([UID(1)], "message", { id: "m1", body: "hello" });
  const got = await chunk(a); assert.match(got, /event: message/); assert.match(got, /"body":"hello"/);
  assert.equal(await chunk(b, 500), null, "the other person must not receive it");
  a.ctrl.abort(); b.ctrl.abort();
});
test("stream: at most 5 connections per person (the oldest is closed)", async () => {
  const all = []; for (let i = 0; i < 6; i++) { const s = await open(UID(3)); await chunk(s); all.push(s); }
  assert.equal(await chunk(all[0], 1500), "", "the oldest connection was ended by the server");
  all.forEach((s) => s.ctrl.abort());
});
test("stream: the server closes it when the token expires (the page then reconnects with a fresh one)", async () => {
  const s = await open(UID(4), 2); await chunk(s); const t0 = Date.now(), r = await chunk(s, 5000);
  assert.equal(r, "", "stream ended"); assert.ok(Date.now() - t0 < 4500);
});
test("stream: a closed connection is forgotten (no leak)", async () => {
  const s = await open(UID(5)); await chunk(s); assert.ok(chat.clients.get(UID(5))); s.ctrl.abort(); await new Promise((r) => setTimeout(r, 300)); assert.equal(chat.clients.get(UID(5)), undefined);
});
