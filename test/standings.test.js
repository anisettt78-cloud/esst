"use strict";
/* Checks the LOGIC of the standings / leaders SQL from migrations/002_league.sql.
   There is no PostgreSQL here, so the function bodies are taken from the migration file, translated mechanically to SQLite syntax
   (casts removed, string_agg -> group_concat, greatest/least -> max/min) and compared with an independent JavaScript reference on random leagues.
   This proves the ranking rules, NOT PostgreSQL syntax. */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
let DatabaseSync; try { ({ DatabaseSync } = require("node:sqlite")); } catch (_) {}
const sql = fs.readFileSync(path.join(__dirname, "../migrations/002_league.sql"), "utf8");
function body(name) {
  const i = sql.indexOf("create or replace function public." + name + "("); assert.ok(i >= 0, name + " not found");
  const a = sql.indexOf("as $$", i) + 5, b = sql.indexOf("$$;", a); return sql.slice(a, b).trim();
}
const toSqlite = (s) => s.replace(/public\./g, "").replace(/::int\b/g, "").replace(/string_agg\(/g, "group_concat(").replace(/ order by z\.kickoff_at asc\)/, " ORDER BY z.kickoff_at ASC)")
  .replace(/greatest\(/g, "max(").replace(/least\(/g, "min(");
const SKIP = !DatabaseSync;

function mkdb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`create table tournament_settings(id int, points_for_win int, points_for_draw int, points_for_loss int);
    create table teams(id text primary key, name text, short_name text, logo_url text, color_primary text, archived int default 0);
    create table matches(id text primary key, home_team_id text, away_team_id text, kickoff_at text, status text, home_score int, away_score int);
    create table match_events(id integer primary key, match_id text, event_type text, detail text, player_id text, related_player_id text);
    create table profiles(id text primary key, full_name text, nickname text, display_name text, photo_url text);
    create table player_match_appearances(match_id text, player_id text);
    create table team_memberships(player_id text, team_id text, status text);
    insert into tournament_settings values (1,3,1,0);`);
  return db;
}
const standingsSql = (n = "league_standings") => toSqlite(body(n));
function topSql(stat) { return toSqlite(body("league_top_players")).replace("select p.id, p.full_name", "select p.id as player_id, p.full_name").replace(/p_stat/g, "'" + stat + "'").replace(/p_limit/g, "50"); }

/* independent reference implementation */
function reference(teams, matches, W = 3, D = 1, L = 0) {
  const st = new Map(teams.map((t) => [t.id, { id: t.id, name: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, res: [] }])), fin = matches.filter((m) => m.status === "finished").sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  const pts = (a, b) => (a > b ? W : a === b ? D : L);
  for (const m of fin) for (const [t, o, gf, ga] of [[m.home_team_id, m.away_team_id, m.home_score, m.away_score], [m.away_team_id, m.home_team_id, m.away_score, m.home_score]]) {
    const s = st.get(t); s.p++; s.gf += gf; s.ga += ga; s.pts += pts(gf, ga); gf > ga ? s.w++ : gf === ga ? s.d++ : s.l++; s.res.push({ o, pts: pts(gf, ga), c: gf > ga ? "W" : gf === ga ? "D" : "L" });
  }
  const arr = [...st.values()]; arr.forEach((s) => { s.gd = s.gf - s.ga; });
  for (const a of arr) a.h2h = arr.filter((b) => b.id !== a.id && b.pts === a.pts && b.gd === a.gd && b.gf === a.gf).reduce((sum, b) => sum + a.res.filter((r) => r.o === b.id).reduce((x, r) => x + r.pts, 0), 0);
  arr.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.h2h - a.h2h || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return arr.map((s, i) => ({ pos: i + 1, id: s.id, p: s.p, w: s.w, d: s.d, l: s.l, gf: s.gf, ga: s.ga, gd: s.gd, pts: s.pts, form: s.res.slice(-5).map((r) => r.c).join("") }));
}
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

test("standings: SQL logic equals the reference on 300 random leagues (incl. ties, head-to-head, form, unfinished matches)", { skip: SKIP }, () => {
  const q = standingsSql();
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed), n = 3 + Math.floor(r() * 6), db = mkdb(), teams = Array.from({ length: n }, (_, i) => ({ id: "T" + i, name: "Team " + String.fromCharCode(65 + ((i * 7 + seed) % 26)) + i }));
    const ins = db.prepare("insert into teams (id,name,short_name,archived) values (?,?,?,0)"); teams.forEach((t) => ins.run(t.id, t.name, "X"));
    const ms = []; let k = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b && r() < 0.8) {
      const fin = r() < 0.85, hs = Math.floor(r() * 3), as = Math.floor(r() * 3);   // small scores on purpose: lots of ties
      ms.push({ id: "M" + k, home_team_id: teams[a].id, away_team_id: teams[b].id, kickoff_at: "2026-12-" + String(1 + Math.floor(k / 9)).padStart(2, "0") + "T" + String(10 + (k % 9)).padStart(2, "0") + ":00", status: fin ? "finished" : "scheduled", home_score: fin ? hs : null, away_score: fin ? as : null }); k++;
    }
    const im = db.prepare("insert into matches values (?,?,?,?,?,?,?)"); ms.forEach((m) => im.run(m.id, m.home_team_id, m.away_team_id, m.kickoff_at, m.status, m.home_score, m.away_score));
    const got = db.prepare(q).all().map((x) => ({ pos: x.pos, id: x.team_id, p: x.played, w: x.won, d: x.drawn, l: x.lost, gf: x.gf, ga: x.ga, gd: x.gd, pts: x.points, form: x.form }));
    assert.deepEqual(got, reference(teams, ms), "seed " + seed);
  }
});

test("standings: a tie broken only by head-to-head, archived teams hidden, custom points", { skip: SKIP }, () => {
  const db = mkdb(); const T = (id, n, arch = 0) => db.prepare("insert into teams (id,name,short_name,archived) values (?,?,?,?)").run(id, n, "X", arch);
  T("A", "Alpha"); T("B", "Bravo"); T("C", "Charlie"); T("Z", "Hidden", 1);
  const M = (id, h, a, hs, as, t) => db.prepare("insert into matches values (?,?,?,?,?,?,?)").run(id, h, a, t, "finished", hs, as);
  M("1", "A", "B", 1, 0, "2026-12-01"); M("2", "B", "C", 1, 0, "2026-12-02"); M("3", "C", "A", 1, 0, "2026-12-03");   // a perfect cycle: all level
  M("4", "A", "C", 0, 0, "2026-12-04"); M("5", "B", "A", 0, 0, "2026-12-05");
  const rows = db.prepare(standingsSql()).all();
  assert.equal(rows.length, 3, "archived team is not listed"); assert.ok(rows.every((r) => r.team_id !== "Z"));
  const ref = reference([{ id: "A", name: "Alpha" }, { id: "B", name: "Bravo" }, { id: "C", name: "Charlie" }], [1, 2, 3, 4, 5].map((i) => db.prepare("select * from matches where id=?").get(String(i))).map((m) => ({ ...m })));
  assert.deepEqual(rows.map((r) => r.team_id), ref.map((r) => r.id));
  db.exec("update tournament_settings set points_for_win = 2, points_for_draw = 1, points_for_loss = 0");
  assert.equal(db.prepare(standingsSql()).all().find((r) => r.team_id === "A").points, reference([{ id: "A", name: "Alpha" }, { id: "B", name: "Bravo" }, { id: "C", name: "Charlie" }], [1, 2, 3, 4, 5].map((i) => ({ ...db.prepare("select * from matches where id=?").get(String(i)) })), 2, 1, 0).find((r) => r.id === "A").pts);
});

test("leaders: goals / assists / cards count only finished matches; own goals never count for the scorer", { skip: SKIP }, () => {
  const db = mkdb(); db.exec(`insert into teams (id,name,short_name) values ('A','Alpha','ALP'),('B','Bravo','BRA');
    insert into profiles (id,full_name) values ('p1','Ann'),('p2','Bob'),('p3','Cid'),('p4','Dan');
    insert into team_memberships values ('p1','A','active'),('p2','A','active'),('p3','B','active'),('p4','B','left');
    insert into matches values ('m1','A','B','2026-12-01','finished',3,1), ('m2','A','B','2026-12-08','scheduled',null,null);
    insert into player_match_appearances values ('m1','p1'),('m1','p2'),('m1','p3');`);
  const E = db.prepare("insert into match_events (match_id,event_type,detail,player_id,related_player_id) values (?,?,?,?,?)");
  E.run("m1", "goal", "normal", "p1", "p2"); E.run("m1", "goal", "penalty", "p1", null); E.run("m1", "goal", "own_goal", "p3", null); E.run("m1", "goal", "normal", "p3", null);
  E.run("m1", "yellow", null, "p3", null); E.run("m1", "yellow", null, "p3", null); E.run("m1", "red", null, "p2", null); E.run("m2", "goal", "normal", "p2", "p1");   // m2 is not finished -> ignored
  // columns are read by POSITION (the function's OUT parameter order): player_id, full_name, nickname, display_name, photo_url, team_id, team_name, team_short, team_logo, value, matches
  const cols = (r) => Object.values(r), rowsFor = (s) => db.prepare(topSql(s)).all().map((r) => [cols(r)[1], cols(r)[9]]);
  assert.deepEqual(rowsFor("goals"), [["Ann", 2], ["Cid", 1]], "own goal and the unfinished match are ignored");
  assert.deepEqual(rowsFor("assists"), [["Bob", 1]]); assert.deepEqual(rowsFor("yellow"), [["Cid", 2]]); assert.deepEqual(rowsFor("red"), [["Bob", 1]]);
  const ann = cols(db.prepare(topSql("goals")).all()[0]); assert.equal(ann[6], "Alpha", "team name"); assert.equal(ann[10], 1, "matches played");
});
