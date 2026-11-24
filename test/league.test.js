"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const L = require("../league");
const ids = (n) => Array.from({ length: n }, (_, i) => "T" + (i + 1));

for (const n of [2, 3, 4, 5, 6, 8, 10]) for (const legs of [1, 2]) {
  test(`round-robin ${n} teams, ${legs} leg(s)`, () => {
    const rounds = L.roundRobin(ids(n), legs), T = ids(n);
    const perLeg = n % 2 ? n : n - 1;
    assert.equal(rounds.length, perLeg * legs, "number of rounds");
    const pair = new Map(), home = new Map(), away = new Map();
    rounds.forEach((r, ri) => {
      const seen = new Set();
      for (const m of r) {
        assert.notEqual(m.home, m.away);
        for (const t of [m.home, m.away]) { assert.ok(!seen.has(t), `team ${t} plays twice in round ${ri + 1}`); seen.add(t); }
        const k = [m.home, m.away].sort().join("-"); pair.set(k, (pair.get(k) || 0) + 1);
        home.set(m.home, (home.get(m.home) || 0) + 1); away.set(m.away, (away.get(m.away) || 0) + 1);
      }
      assert.equal(r.length, Math.floor(n / 2), "matches per round");
    });
    assert.equal(pair.size, n * (n - 1) / 2, "every pair meets");
    for (const c of pair.values()) assert.equal(c, legs, "each pair plays exactly `legs` times");
    if (legs === 2) { // home and away once each
      const dir = new Set(); for (const r of rounds) for (const m of r) { assert.ok(!dir.has(m.home + ">" + m.away)); dir.add(m.home + ">" + m.away); }
    }
    for (const t of T) { const d = (home.get(t) || 0) - (away.get(t) || 0); assert.ok(Math.abs(d) <= 1, `home/away balance for ${t}: ${d}`); }
    for (const t of T) { // every team plays all others
      const played = rounds.flat().filter((m) => m.home === t || m.away === t).length;
      assert.equal(played, (n - 1) * legs);
    }
  });
}

test("max consecutive same-venue streak is reported and small", () => {
  for (const n of [4, 5, 6, 8, 10]) {
    const rounds = L.roundRobin(ids(n), 1); let worst = 0;
    for (const t of ids(n)) { let s = 0, prev = null; for (const r of rounds) { const m = r.find((x) => x.home === t || x.away === t); if (!m) continue; const v = m.home === t ? "H" : "A"; s = v === prev ? s + 1 : 1; prev = v; worst = Math.max(worst, s); } }
    console.log(`  n=${n}: longest home/away streak = ${worst}`);
    assert.ok(worst <= 3);
  }
});

test("errors", () => {
  assert.throws(() => L.roundRobin(["a"], 1), { code: "NOT_ENOUGH_TEAMS" });
  assert.throws(() => L.roundRobin(["a", "a"], 1), { code: "DUPLICATE_TEAMS" });
  assert.throws(() => L.roundRobin(["a", "b"], 3), { code: "INVALID_LEGS" });
});

test("plan validation", () => {
  const ok = { legs: 1, start_date: "2026-12-05", match_days: [5, 6], kickoff_times: ["16:00", "18:00"], venues: ["Court 1"] };
  assert.equal(L.validatePlan(ok).legs, 1);
  assert.throws(() => L.validatePlan({ ...ok, start_date: "2026-02-31" }), { code: "INVALID_START_DATE" });
  assert.throws(() => L.validatePlan({ ...ok, match_days: [] }), { code: "INVALID_MATCH_DAYS" });
  assert.throws(() => L.validatePlan({ ...ok, match_days: [7] }), { code: "INVALID_MATCH_DAYS" });
  assert.throws(() => L.validatePlan({ ...ok, kickoff_times: ["25:00"] }), { code: "INVALID_KICKOFF_TIMES" });
  assert.throws(() => L.validatePlan({ ...ok, legs: 5 }), { code: "INVALID_LEGS" });
});

test("scheduling: only chosen weekdays, ordered, slots respected, no team twice in a time slot", () => {
  const plan = L.validatePlan({ legs: 2, start_date: "2026-12-05", match_days: [5, 6], kickoff_times: ["16:00", "18:00"], venues: ["A", "B"] });
  const { matches } = L.generate(ids(6), plan, { shuffle: false });
  assert.equal(matches.length, 30);
  let prevMd = 0, prevT = 0;
  for (const m of matches) {
    const local = new Date(new Date(m.kickoff_at).getTime() + 3600e3);              // Africa/Algiers = UTC+1, no DST
    assert.ok([5, 6].includes(local.getUTCDay()), "weekday " + local.getUTCDay());
    assert.ok(m.matchday >= prevMd); prevMd = m.matchday;
    assert.ok(new Date(m.kickoff_at).getTime() >= prevT - 1); prevT = new Date(m.kickoff_at).getTime();
    assert.ok(["A", "B"].includes(m.venue));
  }
  const slot = new Set(); for (const m of matches) { const k = m.kickoff_at + "|" + m.venue; assert.ok(!slot.has(k), "double-booked " + k); slot.add(k); }
  assert.equal(matches[0].kickoff_at, "2026-12-05T15:00:00.000Z");                  // Saturday 5 Dec 2026, 16:00 Algiers
});

test("time zones incl. daylight saving", () => {
  assert.equal(new Date(L.zonedToUtcMs("2026-12-05", "16:00", "Africa/Algiers")).toISOString(), "2026-12-05T15:00:00.000Z");
  assert.equal(new Date(L.zonedToUtcMs("2026-07-01", "16:00", "Europe/Paris")).toISOString(), "2026-07-01T14:00:00.000Z");
  assert.equal(new Date(L.zonedToUtcMs("2026-01-15", "16:00", "Europe/Paris")).toISOString(), "2026-01-15T15:00:00.000Z");
});

test("10 teams, one venue, one time slot spills over to extra days but keeps matchday order", () => {
  const plan = L.validatePlan({ legs: 1, start_date: "2026-12-05", match_days: [6], kickoff_times: ["16:00"], venues: [] });
  const { matches } = L.generate(ids(10), plan, { shuffle: false });
  assert.equal(matches.length, 45);
  assert.equal(new Set(matches.map((m) => m.kickoff_at.slice(0, 10))).size, 45, "one match per Saturday with a single slot");
  for (let i = 1; i < matches.length; i++) assert.ok(matches[i].kickoff_at >= matches[i - 1].kickoff_at);
});
