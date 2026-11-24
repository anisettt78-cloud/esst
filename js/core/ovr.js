/* ESST core: match report maths (pure functions, unit-tested).
   Ported from the rules of the previous version so ratings stay consistent:
   - rating (OVR) starts at 60 and stays between 50 and 99 (the database clamps it; it is recomputed from the saved rows)
   - result: win +1, draw 0, loss -1 (forwards and midfielders lose the goal difference instead)
   - goal +2 (midfielder +1), assist +1 (midfielder +2), yellow -1, red -2
   - defenders and goalkeepers: appearance +2, -1 per goal conceded while on the pitch, goalkeeper clean sheet +1, big win bonus (+1 for 2 goals, +2 for 4+)
   Event minutes are stored as "minute key" = minute * 100 + stoppage (so 45+2 is 4502). */
(function (g) {
  "use strict";
  const E = (g.ESST = g.ESST || {});
  const START = 60, MIN = 50, MAX = 99;
  const key = (min, extra) => min * 100 + (extra || 0);
  const clamp = (v) => Math.min(MAX, Math.max(MIN, v));
  const byTime = (a, b) => key(a.minute, a.extra_minute) - key(b.minute, b.extra_minute) || (a.sequence || 0) - (b.sequence || 0);
  const sortEvents = (evs) => evs.slice().sort(byTime);
  /* end of the match: 90:00, or one tick after the last event if that is later (so a goal in the very last event still counts as conceded;
   the previous version used the last event's own key, which silently ignored late goals) */
  const endKey = (evs) => { let e = 9000; for (const x of evs) e = Math.max(e, key(x.minute, x.extra_minute) + 1); return e; };

  /* lineups: [{ team_id, players: [{ player_id, match_position, is_starter }] }]  (starters + bench)
     Sub event: player_id = leaves, related_player_id = comes on (must be on that team's bench). Red card: leaves. */
  function computeAppearances(lineups, events) {
    const end = endKey(events), on = new Map(), out = [];
    for (const l of lineups || []) for (const p of l.players || []) if (p.is_starter) on.set(p.player_id, { team_id: l.team_id, match_position: p.match_position, is_starter: true, entry: 0 });
    const leave = (id, at) => { const p = on.get(id); if (!p) return; out.push({ player_id: id, team_id: p.team_id, match_position: p.match_position, is_starter: p.is_starter, entry_minute: p.entry, exit_minute: at, minutes_played: Math.round((at - p.entry) / 100) }); on.delete(id); };
    const bench = (ev) => { for (const l of lineups || []) { if (l.team_id !== ev.team_id) continue; const p = (l.players || []).find((x) => x.player_id === ev.related_player_id && !x.is_starter); if (p) return { team_id: l.team_id, match_position: p.match_position }; } return null; };
    for (const ev of sortEvents(events)) {
      if (ev.event_type === "sub") { leave(ev.player_id, key(ev.minute, ev.extra_minute)); const b = bench(ev); if (b) on.set(ev.related_player_id, { team_id: b.team_id, match_position: b.match_position, is_starter: false, entry: key(ev.minute, ev.extra_minute) }); }
      else if (ev.event_type === "red") leave(ev.player_id, key(ev.minute, ev.extra_minute));
    }
    for (const [id, p] of on) out.push({ player_id: id, team_id: p.team_id, match_position: p.match_position, is_starter: p.is_starter, entry_minute: p.entry, exit_minute: end, minutes_played: Math.round((end - p.entry) / 100) });
    return out;
  }
  /* goals the OTHER team scored while this player was on the pitch (own goals are stored with the benefiting team, so they count too) */
  function concededWhileOn(app, events, teamId) {
    const from = app.entry_minute || 0, to = app.exit_minute;
    return events.filter((e) => e.event_type === "goal" && e.team_id !== teamId && key(e.minute, e.extra_minute) >= from && key(e.minute, e.extra_minute) < to);
  }
  /* rating rows for one player in one match. match = { home_team_id, home_score, away_score } */
  function matchRows(app, match, events) {
    const rows = [];
    if (!app) return { rows, total: 0 };
    const id = app.player_id, home = app.team_id === match.home_team_id, mine = home ? match.home_score : match.away_score, theirs = home ? match.away_score : match.home_score;
    const win = mine > theirs, loss = mine < theirs, pos = app.match_position;
    rows.push({ reason: win ? "win" : loss ? "loss" : "draw", delta: win ? 1 : loss ? (pos === "forward" || pos === "midfielder" ? -(theirs - mine) : -1) : 0 });
    const goalPts = pos === "midfielder" ? 1 : 2, assistPts = pos === "midfielder" ? 2 : 1;
    for (const e of events) if (e.event_type === "goal" && e.detail !== "own_goal") {
      if (e.player_id === id) rows.push({ reason: "goal", delta: goalPts, meta: { event_id: e.id || null } });
      if (e.related_player_id && e.related_player_id === id) rows.push({ reason: "assist", delta: assistPts, meta: { event_id: e.id || null } });
    }
    for (const e of events) if (e.player_id === id) { if (e.event_type === "yellow") rows.push({ reason: "yellow", delta: -1, meta: { event_id: e.id || null } }); if (e.event_type === "red") rows.push({ reason: "red", delta: -2, meta: { event_id: e.id || null } }); }
    if (pos === "defender" || pos === "goalkeeper") {
      rows.push({ reason: "appearance", delta: 2 });
      const conceded = concededWhileOn(app, events, app.team_id);
      for (const c of conceded) rows.push({ reason: "conceded", delta: -1, meta: { event_id: c.id || null } });
      if (pos === "goalkeeper" && conceded.length === 0) rows.push({ reason: "clean_sheet", delta: 1 });
      if (win) { const d = mine - theirs; if (d >= 4) rows.push({ reason: "win_margin", delta: 2 }); else if (d >= 2) rows.push({ reason: "win_margin", delta: 1 }); }
    }
    return { rows, total: rows.reduce((s, r) => s + r.delta, 0) };
  }

  /* Validate the events typed by the super admin. Returns a list of { key, index } (i18n key + 1-based row), empty when fine. */
  function validateEvents(events, o) {
    const errs = [], seen = new Set(), teams = new Set([o.homeTeamId, o.awayTeamId]);
    events.forEach((e, i) => {
      const n = i + 1, bad = (k) => errs.push({ key: k, index: n });
      if (!["goal", "yellow", "red", "sub"].includes(e.event_type)) return bad("result.err.type");
      if (!Number.isInteger(e.minute) || e.minute < 0 || e.minute > 130) return bad("result.err.minute");
      if (e.extra_minute != null && (!Number.isInteger(e.extra_minute) || e.extra_minute < 0 || e.extra_minute > 15)) return bad("result.err.stoppage");
      if (!teams.has(e.team_id)) return bad("result.err.team");
      if (!e.player_id) return bad("result.err.player");
      if (e.event_type === "goal") { if (!["normal", "penalty", "own_goal"].includes(e.detail || "normal")) return bad("result.err.detail"); if (e.detail !== "own_goal" && e.related_player_id && e.related_player_id === e.player_id) return bad("result.err.selfassist"); }
      if (e.event_type === "sub") { if (!e.related_player_id) return bad("result.err.sub_in"); if (e.related_player_id === e.player_id) return bad("result.err.sub_same"); }
      const k = [e.event_type, e.detail || "", e.minute, e.extra_minute == null ? "" : e.extra_minute, e.team_id, e.player_id, e.related_player_id || ""].join("|");
      if (seen.has(k)) return bad("result.err.duplicate"); seen.add(k);
    });
    return errs;
  }
  function score(events, homeTeamId, awayTeamId) { let h = 0, a = 0; for (const e of events) if (e.event_type === "goal") { if (e.team_id === homeTeamId) h++; else if (e.team_id === awayTeamId) a++; } return { home: h, away: a }; }

  /* Everything submit_match_report needs: cleaned events, appearances and rating rows. */
  function buildReport(match, events, lineups) {
    const sc = score(events, match.home_team_id, match.away_team_id), m = { home_team_id: match.home_team_id, home_score: sc.home, away_score: sc.away };
    const apps = computeAppearances(lineups, events), rows = [];
    for (const a of apps) for (const r of matchRows(a, m, events).rows) rows.push({ player_id: a.player_id, reason: r.reason, delta: r.delta, meta: r.meta || null });
    return { score: sc, appearances: apps, ovr_rows: rows };
  }
  E.ovr = { START, MIN, MAX, clamp, key, sortEvents, computeAppearances, concededWhileOn, matchRows, validateEvents, score, buildReport };
})(typeof window !== "undefined" ? window : globalThis);
