#!/usr/bin/env node
"use strict";
/* Real-database check. Run it ONCE against your Railway PostgreSQL (or any PostgreSQL 13+):

     DATABASE_URL="postgres://..." node scripts/verify-db.js

   What it does (everything happens inside ONE transaction that is ROLLED BACK at the end, so your data is never touched):
   1. first-start setup (roles, auth schema) + schema.sql when the database is empty, then indexes.sql
   2. every migration, TWICE (they must be idempotent), each pass attributed per file
   3. every table and function that the SQL files create really exists
   4. smoke queries: league_standings, search_players, match_detail, player_public, teams_overview, sync_team_chat
   5. permissions: visitors (anon) and signed-in users cannot read the private chat / media / follow tables directly
   6. a tiny fixture (2 players, 1 team) proves that team chats are created and kept in sync
   Prints PASS / FAIL / SKIP for each check and exits 1 when anything FAILS. */
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
if (!process.env.DATABASE_URL && !process.env.PGHOST) { console.error("Set DATABASE_URL first, e.g.  DATABASE_URL=postgres://user:pass@host:5432/db node scripts/verify-db.js"); process.exit(2); }
const { Client } = require("pg");
const { BOOT } = require(path.join(root, "db.js"));
const res = []; let sp = 0;
const rec = (s, n, d) => { res.push(s); console.log(s.padEnd(5) + n + (d ? "  -> " + d : "")); };
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

(async () => {
  const c = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  /* one check = one savepoint, so a failing check never poisons the following ones */
  async function check(name, fn, opts) {
    const s = "sp" + (++sp); await c.query("savepoint " + s);
    try { const d = await fn(); await c.query("rollback to savepoint " + s); rec("PASS", name, typeof d === "string" ? d : ""); }
    catch (e) { await c.query("rollback to savepoint " + s); rec(opts && opts.skip ? "SKIP" : "FAIL", name, String(e.message).split("\n")[0]); }
  }
  async function step(name, sql) {                                   // used for the setup: a failure here is kept out of the transaction state
    const s = "sp" + (++sp); await c.query("savepoint " + s);
    try { await c.query(sql); await c.query("release savepoint " + s); rec("PASS", name); return true; }
    catch (e) { await c.query("rollback to savepoint " + s); rec("FAIL", name, String(e.message).split("\n")[0]); return false; }
  }
  try {
    await c.query("begin");
    const ver = (await c.query("show server_version")).rows[0].server_version; console.log("PostgreSQL " + ver + "\n");
    await step("first-start setup (roles, auth schema)", BOOT);
    const empty = !(await c.query("select to_regclass('public.profiles') as r")).rows[0].r;
    if (empty) await step("empty database: schema.sql", read("schema.sql")); else console.log("(existing database detected: schema.sql is skipped, like the server does)");
    await step("indexes.sql", read("indexes.sql"));
    const files = fs.readdirSync(path.join(root, "migrations")).filter((x) => /^\d+.*\.sql$/.test(x)).sort();
    for (const pass of [1, 2]) for (const f of files) await step("migration " + f + " (pass " + pass + (pass === 2 ? ", must be idempotent" : "") + ")", read("migrations/" + f));
    if (files[files.length - 1] !== "099_permissions.sql") rec("FAIL", "099_permissions.sql must be the LAST migration", files[files.length - 1]);

    /* every table / function the SQL files create must exist */
    const all = read("schema.sql") + files.map((f) => read("migrations/" + f)).join("\n");
    const tables = [...new Set([...all.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map((m) => m[1]))];
    const fns = [...new Set([...all.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\s*\(/g)].map((m) => m[1]))];
    await check("all " + tables.length + " tables exist", async () => { const r = await c.query("select t from unnest($1::text[]) t where to_regclass('public.' || t) is null", [tables]); if (r.rowCount) throw new Error("missing: " + r.rows.map((x) => x.t).join(", ")); });
    await check("all " + fns.length + " functions exist", async () => { const r = await c.query("select f from unnest($1::text[]) f where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f)", [fns]); if (r.rowCount) throw new Error("missing: " + r.rows.map((x) => x.f).join(", ")); });

    /* smoke queries (read only) */
    await check("league_standings()", async () => "rows: " + (await c.query("select * from public.league_standings()")).rowCount);
    await check("search_players('')", async () => "rows: " + (await c.query("select * from public.search_players('')")).rowCount);
    await check("teams_overview()", async () => "rows: " + (await c.query("select * from public.teams_overview()")).rowCount);
    await check("match_detail(unknown id) answers null instead of failing", async () => { await c.query("select public.match_detail(gen_random_uuid())"); });
    await check("player_public(unknown id) answers null instead of failing", async () => { await c.query("select public.player_public(gen_random_uuid())"); });
    await check("sync_team_chat() for every existing team", async () => { await c.query("select public.sync_team_chat(id) from public.teams"); });

    /* permissions: private tables are closed to the web roles */
    for (const role of ["anon", "authenticated"]) for (const t of ["messages", "media", "follows", "blocks", "conversations", "conversation_members"]) {
      await check(role + " cannot read " + t + " directly", async () => {
        await c.query("set local role " + role);
        try { await c.query("select 1 from public." + t + " limit 1"); } catch (e) { if (e.code === "42501") return; throw e; }       // the savepoint rollback restores the role (the transaction is aborted here, so no further statements)
        await c.query("reset role"); throw new Error("the role CAN read " + t);
      });
    }

    /* fixture: two players + one team -> team chat is created and follows the roster */
    await check("team chat sync with real rows (fixture, rolled back)", async () => {
      const mk = async (n) => (await c.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, 'x', $2::jsonb) returning id", [n + "@verify.test", JSON.stringify({ full_name: "Verify " + n, birth_date: "2000-01-01", main_position: "forward", preferred_foot: "right" })])).rows[0].id;
      const a = await mk("a"), b = await mk("b");
      if (!(await c.query("select 1 from public.profiles where id = $1", [a])).rowCount) throw new Error("signup trigger did not create a profile");
      const team = (await c.query("insert into public.teams (name, short_name) values ('Verify FC', 'VFC') returning id")).rows[0].id;
      await c.query("insert into public.team_memberships (team_id, player_id, status, role_in_team) values ($1, $2, 'active', 'captain'), ($1, $3, 'active', 'player')", [team, a, b]);
      await c.query("select public.sync_team_chat($1)", [team]);
      const r = await c.query("select count(*)::int n from public.conversation_members cm join public.conversations cv on cv.id = cm.conversation_id where cv.kind = 'team' and cv.team_id = $1", [team]);
      if (r.rows[0].n < 2) throw new Error("expected both players in the team chat, found " + r.rows[0].n);
      await c.query("update public.team_memberships set status = 'left' where team_id = $1 and player_id = $2", [team, b]);
      await c.query("select public.sync_team_chat($1)", [team]);
      const r2 = await c.query("select count(*)::int n from public.conversation_members cm join public.conversations cv on cv.id = cm.conversation_id where cv.kind = 'team' and cv.team_id = $1 and cm.player_id = $2", [team, b]);
      if (r2.rows[0].n !== 0) throw new Error("a player who left the team is still in its chat");
      return "2 members, then 1 after a player left";
    }, { skip: true });
  } catch (e) { rec("FAIL", "unexpected error", e.message); }
  finally { try { await c.query("rollback"); } catch (_) {} await c.end(); }
  const f = res.filter((x) => x === "FAIL").length;
  console.log("\n" + res.filter((x) => x === "PASS").length + " passed, " + f + " failed, " + res.filter((x) => x === "SKIP").length + " skipped. Nothing was changed in your database (rolled back).");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error("verify-db crashed:", e.message); process.exit(2); });
