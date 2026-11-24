"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/core/ovr.js"), "utf8"), ctx);
const O = ctx.ESST.ovr;
const eq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);   // objects from the vm have another prototype
const H = "home", A = "away", M = { home_team_id: H, away_team_id: A };
const L = (team, list) => ({ team_id: team, players: list.map(([id, pos, st]) => ({ player_id: id, match_position: pos, is_starter: st !== false })) });
const rowsOf = (rows) => rows.map((r) => r.reason + (r.delta > 0 ? "+" : "") + r.delta).join(",");

test("win 3-1: scorer forward +1 win +2 goal each; midfielder assist +2", () => {
  const ev = [{ event_type: "goal", team_id: H, player_id: "fw", related_player_id: "mf", minute: 10 }, { event_type: "goal", team_id: H, player_id: "fw", minute: 30, detail: "penalty" }, { event_type: "goal", team_id: H, player_id: "dm", minute: 50 }, { event_type: "goal", team_id: A, player_id: "x", minute: 80 }];
  const lin = [L(H, [["gk", "goalkeeper"], ["df", "defender"], ["mf", "midfielder"], ["fw", "forward"], ["dm", "midfielder"]]), L(A, [["x", "forward"]])];
  const r = O.buildReport(M, ev, lin); eq(r.score, { home: 3, away: 1 });
  const by = (id) => O.matchRows(r.appearances.find((a) => a.player_id === id), { ...M, home_score: 3, away_score: 1 }, ev);
  assert.equal(rowsOf(by("fw").rows), "win+1,goal+2,goal+2"); assert.equal(by("fw").total, 5);
  assert.equal(rowsOf(by("mf").rows), "win+1,assist+2"); assert.equal(rowsOf(by("dm").rows), "win+1,goal+1");
  assert.equal(rowsOf(by("df").rows), "win+1,appearance+2,conceded-1,win_margin+1"); assert.equal(rowsOf(by("gk").rows), "win+1,appearance+2,conceded-1,win_margin+1");
  assert.equal(rowsOf(by("x").rows), "loss-2,goal+2", "attacker loses the goal difference but keeps the goal points");
});
test("clean sheet, big win, defender loss is -1, forward loss is the goal difference", () => {
  const lin = [L(H, [["gk", "goalkeeper"], ["df", "defender"], ["fw", "forward"]]), L(A, [["agk", "goalkeeper"], ["adf", "defender"], ["afw", "forward"]])];
  const ev = ["a", "b", "c", "d"].map((p, i) => ({ event_type: "goal", team_id: H, player_id: "fw", minute: 5 + i * 10 }));
  const r = O.buildReport(M, ev, lin), get = (id) => rowsOf(O.matchRows(r.appearances.find((a) => a.player_id === id), { ...M, home_score: 4, away_score: 0 }, ev).rows);
  assert.equal(get("gk"), "win+1,appearance+2,clean_sheet+1,win_margin+2"); assert.equal(get("df"), "win+1,appearance+2,win_margin+2");
  assert.equal(get("agk"), "loss-1,appearance+2,conceded-1,conceded-1,conceded-1,conceded-1"); assert.equal(get("adf"), "loss-1,appearance+2,conceded-1,conceded-1,conceded-1,conceded-1");
  assert.equal(get("afw"), "loss-4");
});
test("conceded only while on the pitch: substitute and red card change minutes", () => {
  const lin = [L(H, [["gk", "goalkeeper"], ["d1", "defender"], ["d2", "defender", false]]), L(A, [["f", "forward"]])];
  const ev = [{ event_type: "goal", team_id: A, player_id: "f", minute: 20 }, { event_type: "sub", team_id: H, player_id: "d1", related_player_id: "d2", minute: 60 }, { event_type: "goal", team_id: A, player_id: "f", minute: 70 }, { event_type: "red", team_id: H, player_id: "d2", minute: 85 }, { event_type: "goal", team_id: A, player_id: "f", minute: 90 }];
  const apps = O.computeAppearances(lin, ev), a = (id) => apps.find((x) => x.player_id === id);
  assert.equal(a("d1").minutes_played, 60); assert.equal(a("d2").entry_minute, 6000); assert.equal(a("d2").exit_minute, 8500); assert.equal(a("d2").is_starter, false); assert.equal(a("gk").minutes_played, 90);
  const m = { ...M, home_score: 0, away_score: 3 };
  assert.equal(O.matchRows(a("d1"), m, ev).rows.filter((r) => r.reason === "conceded").length, 1, "only the 20' goal");
  assert.equal(O.matchRows(a("d2"), m, ev).rows.filter((r) => r.reason === "conceded").length, 1, "only the 70' goal (red at 85')");
  assert.equal(O.matchRows(a("gk"), m, ev).rows.filter((r) => r.reason === "conceded").length, 3, "incl. the goal in the very last event");
  assert.ok(O.matchRows(a("d2"), m, ev).rows.some((r) => r.reason === "red" && r.delta === -2));
});
test("own goals: credited to the other team, no scorer points, conceded for the defending side", () => {
  const lin = [L(H, [["gk", "goalkeeper"], ["d", "defender"]]), L(A, [["f", "forward"]])];
  const ev = [{ event_type: "goal", detail: "own_goal", team_id: A, player_id: "d", minute: 30 }];
  const r = O.buildReport(M, ev, lin); eq(r.score, { home: 0, away: 1 });
  const d = O.matchRows(r.appearances.find((x) => x.player_id === "d"), { ...M, home_score: 0, away_score: 1 }, ev);
  assert.equal(rowsOf(d.rows), "loss-1,appearance+2,conceded-1"); assert.ok(!d.rows.some((x) => x.reason === "goal"));
  assert.equal(rowsOf(O.matchRows(r.appearances.find((x) => x.player_id === "f"), { ...M, home_score: 0, away_score: 1 }, ev).rows), "win+1");
});
test("event validation", () => {
  const ok = { event_type: "goal", team_id: H, player_id: "p", minute: 10 }, v = (e, extra) => O.validateEvents([e].concat(extra || []), { homeTeamId: H, awayTeamId: A }).map((x) => x.key);
  eq(v(ok), []);
  eq(v({ ...ok, minute: 131 }), ["result.err.minute"]); eq(v({ ...ok, minute: -1 }), ["result.err.minute"]); eq(v({ ...ok, extra_minute: 16 }), ["result.err.stoppage"]);
  eq(v({ ...ok, team_id: "zzz" }), ["result.err.team"]); eq(v({ ...ok, player_id: null }), ["result.err.player"]); eq(v({ ...ok, event_type: "foul" }), ["result.err.type"]);
  eq(v({ ...ok, related_player_id: "p" }), ["result.err.selfassist"]); eq(v({ ...ok, detail: "bicycle" }), ["result.err.detail"]);
  eq(v({ event_type: "sub", team_id: H, player_id: "a", minute: 60 }), ["result.err.sub_in"]); eq(v({ event_type: "sub", team_id: H, player_id: "a", related_player_id: "a", minute: 60 }), ["result.err.sub_same"]);
  eq(v(ok, [{ ...ok }]), ["result.err.duplicate"]);
});
test("clamp and key", () => { assert.equal(O.clamp(120), 99); assert.equal(O.clamp(10), 50); assert.equal(O.key(45, 2), 4502); });
