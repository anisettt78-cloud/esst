"use strict";
/* League fixture generator (pure functions, no database): round-robin by the circle method,
   1 or 2 legs, bye rounds for odd team counts, home/away balancing, automatic dates. */
const crypto = require("node:crypto");

class PlanError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

function secureShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* Circle method. Returns rounds: [[{home, away}, ...], ...] (leg 1 first, then leg 2 = same rounds mirrored). */
function roundRobin(teamIds, legs) {
  if (!Array.isArray(teamIds) || teamIds.length < 2) throw new PlanError("NOT_ENOUGH_TEAMS");
  if (new Set(teamIds).size !== teamIds.length) throw new PlanError("DUPLICATE_TEAMS");
  if (legs !== 1 && legs !== 2) throw new PlanError("INVALID_LEGS");
  const arr0 = teamIds.slice(); if (arr0.length % 2) arr0.push(null);        // null = bye (rest) round
  const n = arr0.length, rounds = [], diff = new Map(), last = new Map();    // diff = home games - away games; last = venue of previous game
  let arr = arr0.slice();
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i]; if (a === null || b === null) continue;
      const da = diff.get(a) || 0, db = diff.get(b) || 0;
      let aHome;
      if (da !== db) aHome = da < db;                                          // the team that has hosted less hosts now
      else if (last.get(a) && last.get(b) && last.get(a) !== last.get(b)) aHome = last.get(a) === "A";   // else the one who was away last time
      else aHome = ((r + i) % 2 === 0);
      const home = aHome ? a : b, away = aHome ? b : a;
      round.push({ home, away });
      diff.set(home, (diff.get(home) || 0) + 1); diff.set(away, (diff.get(away) || 0) - 1);
      last.set(home, "H"); last.set(away, "A");
    }
    rounds.push(round);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];                        // rotate everyone except the first
  }
  const out = rounds.map((m) => m.map((x) => ({ ...x, leg: 1 })));
  if (legs === 2) for (const m of rounds) out.push(m.map((x) => ({ home: x.away, away: x.home, leg: 2 })));
  return out;
}

/* ---- time zones without any library ---- */
function tzOffsetMin(utcMs, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {}; for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000) / 60000);
}
function zonedToUtcMs(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split("-").map(Number), [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMin(guess, tz); let t = guess - off * 60000;
  const off2 = tzOffsetMin(t, tz); if (off2 !== off) t = guess - off2 * 60000;
  return t;
}
const pad = (n) => String(n).padStart(2, "0");
const ymd = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); };
const dayMs = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };

function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = dayMs(s); return ymd(ms) === s;
}

/* Validate and normalise the plan sent by the super admin. */
function validatePlan(raw, defaults) {
  const p = Object.assign({}, defaults || {}, raw || {});
  const legs = Number(p.legs);
  if (legs !== 1 && legs !== 2) throw new PlanError("INVALID_LEGS");
  if (!validDate(p.start_date)) throw new PlanError("INVALID_START_DATE");
  const days = Array.isArray(p.match_days) ? [...new Set(p.match_days.map(Number))] : [];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new PlanError("INVALID_MATCH_DAYS");
  const times = Array.isArray(p.kickoff_times) ? [...new Set(p.kickoff_times.map(String))].sort() : [];
  if (!times.length || times.length > 8 || times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new PlanError("INVALID_KICKOFF_TIMES");
  const venues = (Array.isArray(p.venues) ? p.venues : []).map((v) => String(v).trim()).filter(Boolean);
  if (venues.length > 10 || venues.some((v) => v.length > 80)) throw new PlanError("INVALID_VENUES");
  return { legs, start_date: p.start_date, match_days: days.sort(), kickoff_times: times, venues: [...new Set(venues)], timezone: p.timezone || "Africa/Algiers" };
}

/* Put dates / times / venues on the rounds. One matchday = one or more consecutive eligible days. */
function schedule(rounds, plan) {
  const slots = []; for (const t of plan.kickoff_times) for (const v of (plan.venues.length ? plan.venues : [null])) slots.push({ t, v });
  const matches = []; let cursor = dayMs(plan.start_date), guard = 0;
  const nextEligible = (ms) => { while (!plan.match_days.includes(new Date(ms).getUTCDay())) { ms += 864e5; if (++guard > 5000) throw new PlanError("SCHEDULE_TOO_LONG"); } return ms; };
  rounds.forEach((round, ri) => {
    let day = nextEligible(cursor), used = 0;
    for (const m of round) {
      if (used === slots.length) { day = nextEligible(day + 864e5); used = 0; }
      const s = slots[used++];
      matches.push({ home: m.home, away: m.away, leg: m.leg, matchday: ri + 1, round_name: "Matchday " + (ri + 1), venue: s.v,
                     kickoff_at: new Date(zonedToUtcMs(ymd(day), s.t, plan.timezone)).toISOString() });
    }
    cursor = day + 864e5;
  });
  return matches;
}

function generate(teamIds, rawPlan, opts) {
  const plan = validatePlan(rawPlan);
  const order = (opts && opts.shuffle === false) ? teamIds : secureShuffle(teamIds);
  return { plan, matches: schedule(roundRobin(order, plan.legs), plan) };
}

module.exports = { roundRobin, schedule, generate, validatePlan, zonedToUtcMs, PlanError, secureShuffle };
