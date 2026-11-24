"use strict";
/* Player search: (1) the accent / Arabic folding in the browser and in the database are the same table,
   (2) the search_players SQL (taken from migrations/002_league.sql, translated mechanically to SQLite) ranks and filters correctly.
   There is no PostgreSQL here, so this proves the LOGIC, not PostgreSQL syntax. */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
let DatabaseSync; try { ({ DatabaseSync } = require("node:sqlite")); } catch (_) {}
const sql = fs.readFileSync(path.join(__dirname, "../migrations/002_league.sql"), "utf8");
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/core/util.js"), "utf8"), ctx);
const jsNorm = ctx.ESST.u.norm;

/* the folding exactly as the migration defines it; lower() is simulated for ASCII only (the worst case: a "C" locale database) */
const nt = sql.slice(sql.indexOf("create or replace function public.norm_text"), sql.indexOf("$$;", sql.indexOf("create or replace function public.norm_text")));
const lit = [...nt.matchAll(/'([^']*)'/g)].map((m) => m[1]), FROM = lit[lit.length - 2], TO = lit[lit.length - 1], RE = new RegExp(lit.find((x) => x.startsWith("[")), "g");
const sqlNorm = (s) => [...String(s == null ? "" : s).replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(RE, "")].map((c) => { const i = FROM.indexOf(c); return i < 0 ? c : TO[i]; }).join("");

test("browser and database fold text with the same table (accents, capitals, Arabic variants and vowel marks)", () => {
  assert.equal([...FROM].length, [...TO].length, "translate() needs equally long lists");
  const corpus = ["José Álvarez", "JOSÉ ÁLVAREZ", "Bellaïli", "BELLAÏLI", "ÉLODIE Ça va", "ŒUF Æsir Ÿ", "ñandú", "Müller Ångström", "محمد صلاح", "مُحَمَّد", "أحمد إبراهيم آمنة", "احمد ابراهيم امنة", "ٱلله", "فاطمة", "فاطمه", "مؤمن", "مومن", "رئيس", "رييس", "كـــريم", "على", "علي", "Zinedine ZIDANE", "O'Neil-Smith", "", "12 ab"];
  for (const s of corpus) assert.equal(sqlNorm(s), jsNorm(s), JSON.stringify(s));
  assert.equal(jsNorm("ÉÀÇ"), "eac"); assert.equal(jsNorm("أحمد"), jsNorm("احمد")); assert.equal(jsNorm("مُحَمَّد"), jsNorm("محمد")); assert.equal(jsNorm("فاطمة"), jsNorm("فاطمه")); assert.equal(jsNorm("على"), jsNorm("علي"));
});

const SKIP = !DatabaseSync || typeof (new (DatabaseSync || function () {})(":memory:")).function !== "function";
function body() { const i = sql.indexOf("create or replace function public.search_players("), a = sql.indexOf("as $$", i) + 5, b = sql.indexOf("$$;", a); return sql.slice(a, b).trim(); }
function translated() {
  let q = body().replace(/public\./g, "").replace(/greatest\(/g, "max(").replace(/least\(/g, "min(")
    .replace("select p.id, p.full_name", "select p.id as player_id, p.full_name").replace("t.id, t.name, t.short_name, t.logo_url", "t.id as team_id, t.name as team_name, t.short_name as team_short, t.logo_url as team_logo")
    .replace("regexp_split_to_table(q.n, '\\s+') tok", "json_each(:tokens) tok").replace("where tok <> ''", "where tok.value <> ''").replace("replace(replace(replace(tok, '\\', '\\\\')", "replace(replace(replace(tok.value, '\\', '\\\\')")
    .replace("'_', '\\_') || '%')", "'_', '\\_') || '%' escape '\\')")
    .replace(/\bp_q\b/g, ":q").replace(/\bp_team\b/g, ":team").replace(/\bp_position\b/g, ":pos").replace(/\bp_limit\b/g, ":lim");
  assert.ok(q.includes("json_each(:tokens)") && q.includes("escape '\\'"), "translation did not apply");
  return q;
}
function mk() {
  const db = new DatabaseSync(":memory:"); db.function("norm_text", { deterministic: true }, (s) => sqlNorm(s));
  db.exec(`create table profiles(id text primary key, full_name text, nickname text, display_name text, photo_url text, main_position text, ovr int);
    create table teams(id text primary key, name text, short_name text, logo_url text);
    create table team_memberships(player_id text, team_id text, status text);
    insert into teams values ('A','Atlas United','ATL',null),('B','River Plate','RIV',null);`);
  const P = db.prepare("insert into profiles values (?,?,?,?,?,?,?)"), M = db.prepare("insert into team_memberships values (?,?,?)");
  [["1", "José Álvarez", "Pepe", "forward", 70, "A"], ["2", "Ahmed El Amrani", null, "midfielder", 65, "A"], ["3", "محمد صلاح", "الملك", "forward", 90, "B"], ["4", "أحمد حسني", null, "defender", 60, "B"], ["5", "Ahmed Bellaïli", "Bella", "goalkeeper", 72, null],
   ["6", "Karim Benali", "Kimo", "forward", 74, "A"], ["7", "Zinedine Zidane", "Zizou", "midfielder", 99, "B"], ["8", "Mohamed Abdelmoumene Benchaabane El Hadj", null, "defender", 61, "A"], ["9", "100% Player_One", null, "defender", 50, "A"], ["10", "ÉLODIE Çelik", null, "forward", 66, "B"], ["11", "Jose Alvarez Junior", null, "forward", 80, "B"]]
    .forEach(([id, n, nick, pos, ovr, team]) => { P.run(id, n, nick, n, null, pos, ovr); if (team) M.run(id, team, "active"); });
  M.run("2", "B", "left");                                          // a player who left a team is not "in" it
  return db;
}
const names = (rows) => rows.map((r) => r.full_name);
function search(db, q, team = null, pos = null, lim = 20) {
  const toks = sqlNorm(q.trim()).split(/\s+/);
  return db.prepare(translated()).all({ q, team, pos, lim, tokens: JSON.stringify(toks.length ? toks : [""]) });
}

test("search: accents and capitals are ignored (jose finds José, ALVAREZ finds Álvarez, bellaili finds Bellaïli, elodie finds ÉLODIE)", { skip: SKIP }, () => {
  const db = mk();
  assert.deepEqual(names(search(db, "jose")), ["Jose Alvarez Junior", "José Álvarez"]);               // both spellings; higher rating first
  assert.deepEqual(names(search(db, "ALVAREZ")).sort(), ["Jose Alvarez Junior", "José Álvarez"]);
  assert.deepEqual(names(search(db, "bellaili")), ["Ahmed Bellaïli"]); assert.deepEqual(names(search(db, "elodie")), ["ÉLODIE Çelik"]); assert.deepEqual(names(search(db, "celik")), ["ÉLODIE Çelik"]);
});
test("search: Arabic - alef variants, vowel marks, ta marbuta", { skip: SKIP }, () => {
  const db = mk();
  assert.deepEqual(names(search(db, "محمد")), ["محمد صلاح"]); assert.deepEqual(names(search(db, "مُحَمَّد")), ["محمد صلاح"]); assert.deepEqual(names(search(db, "احمد")), ["أحمد حسني"]); assert.deepEqual(names(search(db, "أحمد")), ["أحمد حسني"]);
  assert.deepEqual(names(search(db, "الملك")), ["محمد صلاح"], "Arabic nickname");
});
test("search: several words must ALL match (any order), nickname matches, and % _ are not wildcards", { skip: SKIP }, () => {
  const db = mk();
  assert.deepEqual(names(search(db, "ahmed am")), ["Ahmed El Amrani"]); assert.deepEqual(names(search(db, "amrani ahmed")), ["Ahmed El Amrani"]); assert.deepEqual(names(search(db, "kimo")), ["Karim Benali"]); assert.deepEqual(names(search(db, "zizou")), ["Zinedine Zidane"]);
  assert.deepEqual(names(search(db, "%")), ["100% Player_One"], "a percent sign only matches a real percent sign"); assert.deepEqual(names(search(db, "_")), ["100% Player_One"]); assert.deepEqual(names(search(db, "a_c")), []);
  assert.deepEqual(names(search(db, "qqqq")), []);
});
test("search: starts-with first, then rating, then name; empty query lists everybody by rating; limit is capped at 30", { skip: SKIP }, () => {
  const db = mk();
  assert.deepEqual(names(search(db, "ahmed")).slice(0, 2), ["Ahmed Bellaïli", "Ahmed El Amrani"]);
  assert.equal(names(search(db, "be"))[0], "Ahmed Bellaïli", "the nickname \"Bella\" starts with the query, so he comes first");
  const all = search(db, ""); assert.equal(all.length, 11); assert.equal(all[0].full_name, "Zinedine Zidane"); assert.ok(all.every((r, i) => i === 0 || all[i - 1].ovr >= r.ovr), "rating order");
  assert.equal(search(db, "", null, null, 3).length, 3); assert.equal(search(db, "", null, null, 100).length, 11, "limit 100 is clamped to 30 (only 11 exist)"); assert.equal(search(db, "", null, null, 0).length, 1, "limit 0 is clamped to 1");
  const starts = search(db, "ka"); assert.equal(starts[0].full_name, "Karim Benali");
});
test("search: team and position filters (alone and combined, with a query)", { skip: SKIP }, () => {
  const db = mk();
  assert.deepEqual(names(search(db, "", "A")).sort(), ["100% Player_One", "Ahmed El Amrani", "José Álvarez", "Karim Benali", "Mohamed Abdelmoumene Benchaabane El Hadj"].sort());
  assert.deepEqual(names(search(db, "", null, "goalkeeper")), ["Ahmed Bellaïli"]); assert.deepEqual(names(search(db, "", "B", "forward")), ["محمد صلاح", "Jose Alvarez Junior", "ÉLODIE Çelik"]);
  assert.deepEqual(names(search(db, "alvarez", "A")), ["José Álvarez"]); assert.deepEqual(names(search(db, "ahmed", "B")), ["أحمد حسني"].filter(() => false), "Ahmed El Amrani left team B; the Arabic Ahmed does not contain the latin letters");
  const r = search(db, "kimo")[0]; assert.equal(r.team_name, "Atlas United"); assert.equal(r.team_short, "ATL"); assert.equal(r.main_position, "forward"); assert.equal(r.ovr, 74);
  assert.equal(search(db, "bellaili")[0].team_id, null, "a free agent has no team");
});
