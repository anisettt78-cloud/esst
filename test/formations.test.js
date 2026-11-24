"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/core/formations.js"), "utf8"), ctx);
const F = ctx.ESST.formations, eq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

test("all required formations exist and have 11 slots with sane coordinates", () => {
  for (const f of ["4-4-2", "4-3-3", "4-2-3-1", "3-5-2", "3-4-3", "5-3-2", "4-1-4-1"]) {
    const L = F.layout(f); assert.equal(L.length, 11, f); assert.equal(F.FORMATIONS[f].reduce((a, b) => a + b, 0), 11);
    assert.equal(L[0].role, "goalkeeper"); assert.equal(L[0].x, 50); assert.equal(L.filter((s) => s.role === "goalkeeper").length, 1);
    assert.equal(L.filter((s) => s.role === "forward").length, F.FORMATIONS[f][F.FORMATIONS[f].length - 1]);
    for (const s of L) { assert.ok(s.x > 5 && s.x < 95 && s.y >= 10 && s.y <= 92, f + " slot " + s.slot); }
    const pts = new Set(L.map((s) => s.x + "," + s.y)); assert.equal(pts.size, 11, "no two players on the same spot in " + f);
    for (let i = 1; i < L.length; i++) assert.ok(L[i].y < L[i - 1].y || (L[i].y === L[i - 1].y && L[i].x > L[i - 1].x), "slots run bottom to top, left to right");
  }
  eq(F.layout("4-2-3-1").map((s) => s.role).join(), "goalkeeper,defender,defender,defender,defender,midfielder,midfielder,midfielder,midfielder,midfielder,forward");
  assert.throws(() => F.layout("9-9-9"));
});
test("assignByRole fills matching rows first, then the nearest role", () => {
  const P = (id, pos) => ({ id, pos }), team = [P("gk", "goalkeeper"), P("d1", "defender"), P("d2", "defender"), P("d3", "defender"), P("d4", "defender"), P("m1", "midfielder"), P("m2", "midfielder"), P("m3", "midfielder"), P("f1", "forward"), P("f2", "forward"), P("f3", "forward")];
  eq(F.assignByRole("4-3-3", team), ["gk", "d1", "d2", "d3", "d4", "m1", "m2", "m3", "f1", "f2", "f3"]);
  const r = F.assignByRole("4-4-2", team); assert.equal(r.filter(Boolean).length, 11); assert.equal(new Set(r).size, 11, "nobody twice"); assert.equal(r[0], "gk"); assert.ok(r.slice(5, 9).includes("m1") && r.slice(5, 9).includes("f3"), "the spare forward drops into midfield");
  eq(F.assignByRole("4-3-3", team.slice(0, 5)).filter(Boolean).length, 5, "fewer than 11 players is fine");
});
test("autoFill picks the best rated of each position, then second positions, then anybody", () => {
  const R = (id, main, ovr, second) => ({ id, main_position: main, ovr, secondary_position: second });
  const roster = [R("g1", "goalkeeper", 70), R("g2", "goalkeeper", 80), R("d1", "defender", 60), R("d2", "defender", 75), R("d3", "defender", 65), R("d4", "defender", 55), R("m1", "midfielder", 90), R("m2", "midfielder", 62), R("m3", "midfielder", 61), R("f1", "forward", 85), R("f2", "forward", 64, "midfielder")];
  const r = F.autoFill("4-3-3", roster); assert.equal(r[0], "g2"); assert.equal(r[1], "d2"); assert.equal(r.filter(Boolean).length, 11, "all 11 players used even though only 2 forwards exist"); assert.equal(new Set(r).size, 11);
  assert.ok(r.includes("m1"), "best midfielder plays"); assert.equal(r.indexOf("g1"), 10, "with only 11 players the reserve keeper has to fill the last free slot");
  const r12 = F.autoFill("4-3-3", roster.concat([R("f3", "forward", 50)])); assert.ok(!r12.includes("g1") && r12.includes("f3"), "with a third forward available the reserve keeper stays out");
});
test("changing formation keeps the same players", () => {
  const s = F.autoFill("4-4-2", Array.from({ length: 11 }, (_, i) => ({ id: "p" + i, main_position: i === 0 ? "goalkeeper" : i < 5 ? "defender" : i < 9 ? "midfielder" : "forward", ovr: 70 })));
  for (const f of F.ORDER) { const t = F.reassign(f, "4-4-2", s); assert.equal(new Set(t).size, 11, f); assert.deepEqual([...t].sort(), [...s].sort(), f + " lost or duplicated a player"); assert.equal(t[0], s[0], "keeper stays in goal"); }
});
test("place / swap / remove never lose or duplicate a player", () => {
  let s = ["a", "b", "c", null, null, null, null, null, null, null, null];
  eq(F.place(s, "x", 3), ["a", "b", "c", "x", null, null, null, null, null, null, null], "bench player onto an empty slot");
  eq(F.place(s, "x", 1)[1], "x"); assert.ok(!F.place(s, "x", 1).includes("b"), "the replaced player goes back to the bench");
  eq(F.place(s, "a", 2).slice(0, 3), ["c", "b", "a"], "pitch player dropped on another slot swaps with its occupant");
  eq(F.place(s, "a", 5).slice(0, 6), [null, "b", "c", null, null, "a"], "pitch player moved to an empty slot frees the old one");
  eq(F.swapSlots(s, 0, 4).slice(0, 5), [null, "b", "c", null, "a"]); eq(F.removeFromPitch(s, "b")[1], null);
  for (let k = 0; k < 500; k++) { const ids = ["a", "b", "c", "x", "y"]; let t = s.slice(); for (let i = 0; i < 8; i++) t = F.place(t, ids[(k * 7 + i) % 5], (k * 3 + i * 5) % 11); const on = t.filter(Boolean); assert.equal(new Set(on).size, on.length, "duplicate after random moves"); }
});
test("short names", () => { assert.equal(F.shortName({ nickname: "Kimo", full_name: "Karim Benali" }), "Kimo"); assert.equal(F.shortName({ full_name: "Karim Benali" }), "Benali"); assert.equal(F.shortName({ full_name: "Madonna" }), "Madonna"); assert.equal(F.shortName(null), ""); });
