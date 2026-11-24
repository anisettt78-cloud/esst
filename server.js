"use strict";
/* ESST site: serves the website files AND its built-in backend (accounts + data on Railway PostgreSQL).
   Works from the same origin on Railway, and from file:// (double-click) through CORS + Authorization-header tokens. */
const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const db = require("./db"), api = require("./auth"), U = require("./util");
const media = require("./media"), leagueApi = require("./leagueapi"), chat = require("./chat");
const ROOT = __dirname, PORT = parseInt(process.env.PORT, 10) || 3000;

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8" };
const ROOT_FILES = new Set(["index.html", "config.js", "favicon.svg", "manifest.webmanifest", "robots.txt"]);   // server code and SQL are never served
const PUBLIC_DIRS = new Set(["css", "js", "assets", "fonts", "img"]);
const COMPRESS = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".svg", ".txt"]);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");                 // safe: tokens travel in the Authorization header, never in cookies
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Apikey, Prefer, Accept, Accept-Profile, Content-Profile, Range, X-Duration-Ms, X-Client-Info, If-None-Match");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, ETag");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const gzCache = new Map();
function serveFile(req, res, file, st, rel) {
  const ext = path.extname(file), type = TYPES[ext] || "application/octet-stream", head = req.method === "HEAD";
  const etag = '"' + st.size.toString(36) + "-" + Math.floor(st.mtimeMs).toString(36) + '"';
  const h = { "Content-Type": type, ETag: etag, Vary: "Accept-Encoding",
    "Cache-Control": /^(fonts|img)\//.test(rel) ? "public, max-age=604800" : "no-cache" };      // html/css/js: always revalidate (304 when unchanged)
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, h); return res.end(); }
  if (COMPRESS.has(ext) && st.size < 2e6 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    let c = gzCache.get(file); if (!c || c.etag !== etag) { c = { etag, gz: zlib.gzipSync(fs.readFileSync(file)) }; gzCache.set(file, c); }
    h["Content-Encoding"] = "gzip"; h["Content-Length"] = c.gz.length; res.writeHead(200, h); return res.end(head ? undefined : c.gz);
  }
  h["Content-Length"] = st.size; res.writeHead(200, h);
  if (head) res.end(); else fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res, p) {
  let rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
  if (rel.split("/").some((seg) => seg.startsWith("."))) { res.writeHead(404); return res.end("Not found"); }     // .git, .env ... never
  const top = rel.split("/")[0];
  const allowed = ROOT_FILES.has(rel) || (PUBLIC_DIRS.has(top) && rel.includes("/"));
  if (!allowed) {
    if (path.extname(rel)) { res.writeHead(404); return res.end("Not found"); }
    rel = "index.html";                                              // unknown path without extension: give the app
  }
  const file = path.resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }     // no path tricks
  fs.stat(file, (e, st) => { if (e || !st.isFile()) { res.writeHead(404); return res.end("Not found"); } serveFile(req, res, file, st, rel); });
}

async function extra(req, res, p, url) {
  try {
    if (!db.state.ready) return U.json(req, res, 503, { error: "DB_NOT_READY", message: db.state.error || "Database is starting" });
    if (p.startsWith("/api/media")) return await media.handle(req, res, p, url);
    if (p.startsWith("/api/chat/")) return await chat.handle(req, res, p, url);
    return await leagueApi.handle(req, res, p, url);
  } catch (e) {
    if (e instanceof U.HttpErr) return U.json(req, res, e.status, e.body);
    console.error("[api] " + req.method + " " + p + ":", e && e.message);
    if (!res.headersSent) U.json(req, res, 500, { error: "SERVER_ERROR", message: "Something went wrong" });
  }
}

function handler(req, res) {
  let p, url;
  try { url = new URL(req.url, "http://x"); p = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); return res.end(); }
  cors(res);
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin"); res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.method === "OPTIONS") { res.writeHead(204, { "Content-Length": 0 }); return res.end(); }       // CORS preflight, any path
  if (p === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, db: db.state.ready })); }
  if (p.startsWith("/api/media") || p.startsWith("/api/chat/") || p.startsWith("/api/league/")) return extra(req, res, p, url);
  if (p.startsWith("/auth/v1/") || p.startsWith("/rest/v1/") || p.startsWith("/api/")) return api.handle(req, res, p, url);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, "0.0.0.0", () => { console.log("ESST site listening on " + PORT); db.start(); media.startCleanup(); });
  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
}
module.exports = { handler };
