"use strict";
/* Super-admin league actions. Every route re-checks the role in the database. */
const db = require("./db"), auth = require("./auth"), U = require("./util"), L = require("./league");
const MIN_SQUAD = 11;

async function settingsRow(q) {
  return (await q.query(`select state, legs, to_char(start_date,'YYYY-MM-DD') as start_date, match_days, kickoff_times, venues, timezone
                           from public.tournament_settings where id = 1`)).rows[0];
}
async function checks() {
  const st = await settingsRow(db.pool);
  const teams = (await db.pool.query(`select t.id, t.name,
      (select count(*)::int from public.team_memberships m where m.team_id = t.id and m.status = 'active') as players,
      exists (select 1 from public.team_memberships m where m.team_id = t.id and m.status = 'active' and m.role_in_team = 'captain') as has_captain
      from public.teams t where not t.archived order by t.name`)).rows;
  const warnings = [];
  for (const t of teams) {
    if (!t.has_captain) warnings.push({ team_id: t.id, name: t.name, code: "NO_CAPTAIN" });
    if (t.players < MIN_SQUAD) warnings.push({ team_id: t.id, name: t.name, code: "FEW_PLAYERS", players: t.players, needed: MIN_SQUAD });
  }
  return { state: st.state, settings: st, teams: teams.length, warnings, min_squad: MIN_SQUAD, can_launch: st.state === "setup" && teams.length >= 2 };
}
async function impact(q) {
  const n = async (sql) => (await q.query(sql)).rows[0].n;
  return {
    matches: await n("select count(*)::int n from public.matches"),
    finished: await n("select count(*)::int n from public.matches where status = 'finished'"),
    events: await n("select count(*)::int n from public.match_events"),
    reports: await n("select count(*)::int n from public.match_reports"),
    lineups: await n("select count(*)::int n from public.match_lineups"),
    appearances: await n("select count(*)::int n from public.player_match_appearances"),
    ovr_entries: await n("select count(*)::int n from public.player_ovr_ledger"),
  };
}

async function build(req, res, rebuild) {
  await U.requireSuper(req);
  const body = (await auth.readBody(req)) || {};
  if (rebuild && body.confirm !== "REBUILD") throw U.err(400, "CONFIRMATION_REQUIRED", 'Type REBUILD to confirm');
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const st = await settingsRow({ query: (s, p) => client.query(s + " for update", p) });
    if (!rebuild && st.state !== "setup") throw U.err(409, "ALREADY_LAUNCHED", "The tournament is already launched");
    if (rebuild && st.state !== "launched") throw U.err(409, "NOT_LAUNCHED", "Launch the tournament first");
    const teams = (await client.query("select id from public.teams where not archived order by id")).rows.map((r) => r.id);
    if (teams.length < 2) throw U.err(400, "NOT_ENOUGH_TEAMS", "At least 2 teams are needed");
    let gen;
    try { gen = L.generate(teams, Object.assign({}, st, body)); } catch (e) { if (e instanceof L.PlanError) throw U.err(400, e.code, e.message); throw e; }
    let deleted = null;
    if (rebuild) {
      deleted = await impact(client);
      const players = (await client.query("select distinct player_id from public.player_ovr_ledger")).rows.map((r) => r.player_id);
      await client.query("delete from public.matches");                      // events, reports, lineups, appearances, ledger, suspensions cascade
      for (const id of players) await client.query("select public.recompute_player_ovr($1)", [id]);   // ratings go back to what the remaining history gives (60 base)
    }
    const M = gen.matches, col = (f) => M.map(f);
    await client.query(`insert into public.matches (home_team_id, away_team_id, kickoff_at, venue, round_name, matchday, leg, generated, status)
        select h, a, k, v, r, d, l, true, 'scheduled' from unnest($1::uuid[], $2::uuid[], $3::timestamptz[], $4::text[], $5::text[], $6::int[], $7::int[]) as x(h, a, k, v, r, d, l)`,
      [col((m) => m.home), col((m) => m.away), col((m) => m.kickoff_at), col((m) => m.venue), col((m) => m.round_name), col((m) => m.matchday), col((m) => m.leg)]);
    const p = gen.plan;
    await client.query(`update public.tournament_settings set state = 'launched', legs = $1, start_date = $2, match_days = $3, kickoff_times = $4, venues = $5,
                            launched_at = coalesce(launched_at, now()) where id = 1`, [p.legs, p.start_date, p.match_days, p.kickoff_times, p.venues]);
    await client.query("commit");
    return U.json(req, res, 200, { ok: true, matches: M.length, matchdays: Math.max(...M.map((m) => m.matchday)), deleted });
  } catch (e) { try { await client.query("rollback"); } catch (_) {} throw e; }
  finally { client.release(); }
}

async function handle(req, res, p) {
  if (p === "/api/league/checks" && req.method === "GET") { await U.requireSuper(req); return U.json(req, res, 200, await checks()); }
  if (p === "/api/league/impact" && req.method === "GET") { await U.requireSuper(req); return U.json(req, res, 200, await impact(db.pool)); }
  if (p === "/api/league/launch" && req.method === "POST") return build(req, res, false);
  if (p === "/api/league/rebuild" && req.method === "POST") return build(req, res, true);
  throw U.err(404, "NOT_FOUND");
}
module.exports = { handle, MIN_SQUAD };
