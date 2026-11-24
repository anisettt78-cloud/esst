-- =====================================================================
--  002  League tournament: settings, fixtures columns, team formations,
--       team administration by the super admin, and the PUBLIC read
--       functions (standings, leaders, match page, roster, player card, search).
--  Idempotent. Fixture generation itself is done by the server (league.js).
-- =====================================================================

-- ---- tournament settings ----
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tournament_settings' and column_name = 'state') then
    alter table public.tournament_settings add column state text not null default 'setup';
    -- a database that already has fixtures is a launched tournament
    if exists (select 1 from public.matches) then update public.tournament_settings set state = 'launched' where id = 1; end if;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_state_check') then
    alter table public.tournament_settings add constraint settings_state_check check (state in ('setup','launched'));
  end if;
end $$;
alter table public.tournament_settings add column if not exists legs          int  not null default 1;
alter table public.tournament_settings add column if not exists start_date    date;
alter table public.tournament_settings add column if not exists match_days    int[] not null default '{}';   -- 0 = Sunday ... 6 = Saturday
alter table public.tournament_settings add column if not exists kickoff_times text[] not null default '{}';  -- 'HH:MM'
alter table public.tournament_settings add column if not exists venues        text[] not null default '{}';
alter table public.tournament_settings add column if not exists launched_at   timestamptz;
alter table public.tournament_settings add column if not exists rules_text    text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_legs_check') then
    alter table public.tournament_settings add constraint settings_legs_check check (legs in (1, 2));
  end if;
end $$;

-- ---- matches: matchday + leg ----
alter table public.matches add column if not exists matchday  int;
alter table public.matches add column if not exists leg       int not null default 1;
alter table public.matches add column if not exists generated boolean not null default false;
create index if not exists matches_matchday_idx on public.matches (matchday, kickoff_at);
create unique index if not exists matches_generated_pair_leg on public.matches (home_team_id, away_team_id, leg) where generated;
create index if not exists match_events_player_type_idx on public.match_events (player_id, event_type);

-- ---- lineup players remember where they stand on the pitch (slot 0 = goalkeeper, then defence -> attack, left -> right) ----
alter table public.lineup_players add column if not exists slot int check (slot is null or slot between 0 and 10);

-- ---- team-level formation (visible on the team page, editable by that team's captain) ----
create table if not exists public.team_formations (
  team_id    uuid primary key references public.teams(id) on delete cascade,
  formation  text not null,
  starters   jsonb not null default '[]'::jsonb,   -- [{"slot":0,"player_id":"..."}]  slot 0 = goalkeeper, then defence -> attack, left -> right
  bench      jsonb not null default '[]'::jsonb,   -- ["player_id", ...]
  captain_id uuid references public.profiles(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.team_formations enable row level security;
drop policy if exists team_formations_select on public.team_formations;
create policy team_formations_select on public.team_formations for select to anon, authenticated using (true);

create or replace function public.save_team_formation(
  p_team uuid, p_formation text, p_starters jsonb, p_bench jsonb, p_captain uuid)
returns public.team_formations
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.team_formations;
  v_n     int; v_d int; v_slots int;
  v_ids   uuid[]; v_bench uuid[];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not (public.is_team_captain(p_team) or public.is_super_admin()) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'TEAM_NOT_FOUND'; end if;
  if p_formation is null or p_formation not in ('4-4-2','4-3-3','4-2-3-1','3-5-2','3-4-3','5-3-2','4-1-4-1') then
    raise exception 'INVALID_LINEUP';
  end if;
  if jsonb_typeof(coalesce(p_starters, 'null'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_bench, 'null'::jsonb)) <> 'array' then
    raise exception 'INVALID_LINEUP';
  end if;
  select count(*), count(distinct x.player_id), count(distinct x.slot), coalesce(array_agg(x.player_id), '{}')
    into v_n, v_d, v_slots, v_ids
    from jsonb_to_recordset(p_starters) as x(slot int, player_id uuid);
  if v_n > 11 or v_n <> v_d or v_n <> v_slots
     or exists (select 1 from jsonb_to_recordset(p_starters) as x(slot int, player_id uuid)
                 where x.slot is null or x.slot not between 0 and 10 or x.player_id is null) then
    raise exception 'INVALID_LINEUP';
  end if;
  select coalesce(array_agg(b::uuid), '{}') into v_bench from jsonb_array_elements_text(p_bench) b;
  if coalesce(array_length(v_bench, 1), 0) > 12
     or (select count(distinct u) from unnest(v_bench) u) <> coalesce(array_length(v_bench, 1), 0)
     or v_ids && v_bench then
    raise exception 'INVALID_LINEUP';
  end if;
  if exists (select 1 from unnest(v_ids || v_bench) pid
              where not exists (select 1 from public.team_memberships m
                                 where m.team_id = p_team and m.player_id = pid and m.status = 'active')) then
    raise exception 'INVALID_LINEUP';
  end if;
  if p_captain is not null and not (p_captain = any (v_ids || v_bench)) then raise exception 'INVALID_LINEUP'; end if;

  insert into public.team_formations (team_id, formation, starters, bench, captain_id, updated_by, updated_at)
  values (p_team, p_formation, coalesce(p_starters, '[]'), coalesce(p_bench, '[]'), p_captain, v_uid, now())
  on conflict (team_id) do update
    set formation = excluded.formation, starters = excluded.starters, bench = excluded.bench,
        captain_id = excluded.captain_id, updated_by = v_uid, updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- ---- match lineup: same name and arguments as before, relaxed + fixed ----
--  * 4-1-4-1 added; jersey numbers optional; only the captain of THAT team (or the super admin) may save
create or replace function public.save_lineup(
  p_match_id uuid, p_team_id uuid, p_formation text,
  p_captain_id uuid, p_vice_captain_id uuid, p_tactics text, p_players jsonb)
returns public.match_lineups
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_match   public.matches;
  v_lineup  public.match_lineups;
  v_total   int; v_starters int; v_distinct int; v_jerseys int; v_jdistinct int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not (public.is_team_captain(p_team_id) or public.is_super_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if p_team_id not in (v_match.home_team_id, v_match.away_team_id) then raise exception 'INVALID_LINEUP'; end if;
  if v_match.status <> 'scheduled' then raise exception 'LINEUP_LOCKED'; end if;
  if coalesce((select l.is_locked from public.match_lineups l where l.match_id = p_match_id and l.team_id = p_team_id), false) then
    raise exception 'LINEUP_LOCKED';
  end if;
  if p_formation is null or p_formation not in ('4-4-2','4-3-3','4-2-3-1','3-5-2','3-4-3','5-3-2','4-1-4-1') then
    raise exception 'INVALID_LINEUP';
  end if;
  if jsonb_typeof(coalesce(p_players, 'null'::jsonb)) <> 'array' then raise exception 'INVALID_LINEUP'; end if;

  select count(*), count(*) filter (where x.is_starter), count(distinct x.player_id),
         count(x.jersey_number), count(distinct x.jersey_number)
    into v_total, v_starters, v_distinct, v_jerseys, v_jdistinct
    from jsonb_to_recordset(p_players) as x(player_id uuid, jersey_number int, match_position text,
                                            is_starter boolean, is_captain boolean, is_vice_captain boolean, slot int);
  if (select count(x.slot) <> count(distinct x.slot) from jsonb_to_recordset(p_players) as x(slot int, is_starter boolean) where x.is_starter) then raise exception 'INVALID_LINEUP'; end if;
  if v_total = 0 or v_starters <> 11 or (v_total - v_starters) > 7 or v_distinct <> v_total or v_jerseys <> v_jdistinct then
    raise exception 'INVALID_LINEUP';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_players) as x(player_id uuid, jersey_number int, match_position text,
                                                              is_starter boolean, is_captain boolean, is_vice_captain boolean, slot int)
             where not exists (select 1 from public.team_memberships m
                                where m.team_id = p_team_id and m.player_id = x.player_id and m.status = 'active')
                or exists (select 1 from public.player_suspensions s
                            where s.player_id = x.player_id and s.suspended_for_match_id = p_match_id and s.status = 'pending')
                or x.match_position is null
                or x.match_position not in ('goalkeeper','defender','midfielder','forward')
                or (x.jersey_number is not null and (x.jersey_number < 1 or x.jersey_number > 99))) then
    raise exception 'INVALID_LINEUP';
  end if;
  if (select count(*) from jsonb_to_recordset(p_players) as x(is_captain boolean) where x.is_captain) > 1 then
    raise exception 'INVALID_LINEUP';
  end if;

  insert into public.match_lineups (match_id, team_id, formation, captain_id, vice_captain_id, tactics, is_public, created_by, updated_by)
  values (p_match_id, p_team_id, p_formation, p_captain_id, p_vice_captain_id, nullif(trim(coalesce(p_tactics, '')), ''), true, v_uid, v_uid)
  on conflict (match_id, team_id) do update
    set formation = excluded.formation, captain_id = excluded.captain_id, vice_captain_id = excluded.vice_captain_id,
        tactics = excluded.tactics, is_public = true, updated_by = v_uid, updated_at = now()
  returning * into v_lineup;

  delete from public.lineup_players where lineup_id = v_lineup.id;
  insert into public.lineup_players (lineup_id, player_id, jersey_number, match_position, is_starter, is_captain, is_vice_captain, slot)
  select v_lineup.id, x.player_id, x.jersey_number, x.match_position,
         coalesce(x.is_starter, false), coalesce(x.is_captain, false), coalesce(x.is_vice_captain, false), case when coalesce(x.is_starter, false) then x.slot end
    from jsonb_to_recordset(p_players) as x(player_id uuid, jersey_number int, match_position text,
                                            is_starter boolean, is_captain boolean, is_vice_captain boolean, slot int);
  return v_lineup;
end $$;

-- ---- team administration (super admin only; teams/captains/players are never written directly) ----
create or replace function public.admin_set_captain(p_team uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'TEAM_NOT_FOUND'; end if;
  update public.team_memberships set role_in_team = 'player'
   where team_id = p_team and status = 'active' and role_in_team = 'captain' and player_id is distinct from p_player;
  if p_player is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_player) then raise exception 'PLAYER_NOT_FOUND'; end if;
  if exists (select 1 from public.team_memberships where player_id = p_player and status = 'active' and team_id <> p_team) then
    raise exception 'ALREADY_IN_A_TEAM';
  end if;
  if exists (select 1 from public.team_memberships where team_id = p_team and player_id = p_player and status = 'active') then
    update public.team_memberships set role_in_team = 'captain' where team_id = p_team and player_id = p_player and status = 'active';
  else
    insert into public.team_memberships (team_id, player_id, status, role_in_team) values (p_team, p_player, 'active', 'captain');
  end if;
  update public.team_join_requests set status = 'cancelled', reviewed_at = now() where player_id = p_player and status = 'pending';
end $$;

create or replace function public.admin_create_team(
  p_name text, p_short text, p_logo_url text default null, p_color_primary text default null,
  p_color_secondary text default null, p_description text default null, p_captain uuid default null)
returns public.teams language plpgsql security definer set search_path = public as $$
declare
  v_name  text := trim(coalesce(p_name, ''));
  v_short text := upper(trim(coalesce(p_short, '')));
  v_logo  text := nullif(trim(coalesce(p_logo_url, '')), '');
  v_c1    text := coalesce(nullif(trim(p_color_primary), ''), '#9fd356');
  v_c2    text := coalesce(nullif(trim(p_color_secondary), ''), '#0b0d0a');
  v_team  public.teams;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 or char_length(v_short) < 2 or char_length(v_short) > 6 then raise exception 'INVALID_TEAM'; end if;
  if v_logo is not null and v_logo !~* '^(https?://|/api/media/).+' then raise exception 'INVALID_TEAM'; end if;
  if v_c1 !~ '^#[0-9a-fA-F]{6}$' or v_c2 !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_TEAM'; end if;
  begin
    insert into public.teams (name, short_name, logo_url, description, color_primary, color_secondary)
    values (v_name, v_short, v_logo, nullif(trim(coalesce(p_description, '')), ''), v_c1, v_c2) returning * into v_team;
  exception when unique_violation then raise exception 'DUPLICATE_TEAM'; end;
  if p_captain is not null then perform public.admin_set_captain(v_team.id, p_captain); end if;
  return v_team;
end $$;

create or replace function public.admin_add_player(p_team uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'TEAM_NOT_FOUND'; end if;
  if not exists (select 1 from public.profiles where id = p_player) then raise exception 'PLAYER_NOT_FOUND'; end if;
  if exists (select 1 from public.team_memberships where player_id = p_player and status = 'active') then raise exception 'ALREADY_IN_A_TEAM'; end if;
  insert into public.team_memberships (team_id, player_id, status, role_in_team) values (p_team, p_player, 'active', 'player');
  update public.team_join_requests set status = 'cancelled', reviewed_at = now() where player_id = p_player and status = 'pending';
end $$;

create or replace function public.admin_remove_player(p_team uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  update public.team_memberships set status = 'left', left_at = now(), role_in_team = 'player'
   where team_id = p_team and player_id = p_player and status = 'active';
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;
end $$;

-- ---- hand the super-admin role to another account (the unique index keeps it to one) ----
create or replace function public.transfer_super_admin(p_new uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r record;
begin
  if v_uid is null or not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if p_new is null or p_new = v_uid or not exists (select 1 from public.profiles where id = p_new) then raise exception 'PLAYER_NOT_FOUND'; end if;
  update public.profiles set role = 'member' where id = v_uid;
  update public.profiles set role = 'super_admin' where id = p_new;
  for r in select id from public.teams loop perform public.sync_team_chat(r.id); end loop;
end $$;

-- =====================================================================
--  PUBLIC READ FUNCTIONS (callable by visitors who are not logged in)
-- =====================================================================

-- accent / case / Arabic-variant insensitive text for searching
create or replace function public.norm_text(t text) returns text
language sql immutable as $$
  -- accented capitals are listed too, so folding works even when the database locale cannot lower-case them
  select translate(
           regexp_replace(lower(coalesce(t, '')), '[\u064B-\u0652\u0640]', '', 'g'),
           'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸŒÆأإآٱىةؤئ',
           'aaaaaaceeeeiiiinooooouuuuyyoaaaaaaaceeeeiiiinooooouuuuyyoaاااايهوي')
$$;

-- a player as shown in cards and lists (never e-mail, never exact birth date)
create or replace function public.person_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'nickname', p.nickname, 'display_name', p.display_name,
    'photo_url', p.photo_url, 'ovr', p.ovr, 'main_position', p.main_position) end
  from (select 1) _ left join public.profiles p on p.id = p_id
$$;

create or replace function public.league_standings()
returns table (pos int, team_id uuid, name text, short_name text, logo_url text, color_primary text,
               played int, won int, drawn int, lost int, gf int, ga int, gd int, points int, form text)
language sql stable security definer set search_path = public as $$
  with st as (select points_for_win as w, points_for_draw as d, points_for_loss as l from public.tournament_settings where id = 1),
  res as (
    select m.id as match_id, m.kickoff_at, m.home_team_id as team_id, m.away_team_id as opp_id, m.home_score as gf, m.away_score as ga
      from public.matches m where m.status = 'finished' and m.home_score is not null and m.away_score is not null
    union all
    select m.id, m.kickoff_at, m.away_team_id, m.home_team_id, m.away_score, m.home_score
      from public.matches m where m.status = 'finished' and m.home_score is not null and m.away_score is not null
  ),
  scored as (
    select r.*, case when r.gf > r.ga then (select w from st) when r.gf = r.ga then (select d from st) else (select l from st) end as pts from res r
  ),
  agg as (
    select t.id as team_id, t.name, t.short_name, t.logo_url, t.color_primary,
           count(s.match_id)::int as played,
           (count(*) filter (where s.gf > s.ga))::int as won,
           (count(*) filter (where s.gf = s.ga))::int as drawn,
           (count(*) filter (where s.gf < s.ga))::int as lost,
           coalesce(sum(s.gf), 0)::int as gf, coalesce(sum(s.ga), 0)::int as ga,
           (coalesce(sum(s.gf), 0) - coalesce(sum(s.ga), 0))::int as gd,
           coalesce(sum(s.pts), 0)::int as points
      from public.teams t left join scored s on s.team_id = t.id
     where not t.archived group by t.id
  ),
  -- head-to-head: points earned against the teams that are level on points, goal difference and goals scored
  h2h as (
    select a.team_id, coalesce(sum(s.pts), 0)::int as h2h_pts
      from agg a
      left join agg b on b.team_id <> a.team_id and b.points = a.points and b.gd = a.gd and b.gf = a.gf
      left join scored s on s.team_id = a.team_id and s.opp_id = b.team_id
     group by a.team_id
  )
  select (row_number() over (order by a.points desc, a.gd desc, a.gf desc, h.h2h_pts desc, a.name asc))::int as pos,
         a.team_id, a.name, a.short_name, a.logo_url, a.color_primary,
         a.played, a.won, a.drawn, a.lost, a.gf, a.ga, a.gd, a.points,
         coalesce((select string_agg(case when z.gf > z.ga then 'W' when z.gf = z.ga then 'D' else 'L' end, '' order by z.kickoff_at asc)
                     from (select x.* from scored x where x.team_id = a.team_id order by x.kickoff_at desc limit 5) z), '') as form
    from agg a join h2h h on h.team_id = a.team_id
   order by 1
$$;

-- p_stat: 'goals' | 'assists' | 'yellow' | 'red'   (own goals never count for the scorer)
create or replace function public.league_top_players(p_stat text, p_limit int default 10)
returns table (player_id uuid, full_name text, nickname text, display_name text, photo_url text,
               team_id uuid, team_name text, team_short text, team_logo text, value int, matches int)
language sql stable security definer set search_path = public as $$
  with ev as (
    select case when p_stat = 'assists' then e.related_player_id else e.player_id end as pid, e.match_id
      from public.match_events e join public.matches m on m.id = e.match_id and m.status = 'finished'
     where (p_stat = 'goals'   and e.event_type = 'goal' and coalesce(e.detail, 'normal') <> 'own_goal')
        or (p_stat = 'assists' and e.event_type = 'goal' and coalesce(e.detail, 'normal') <> 'own_goal' and e.related_player_id is not null)
        or (p_stat = 'yellow'  and e.event_type = 'yellow')
        or (p_stat = 'red'     and e.event_type = 'red')
  ), tot as (select pid, count(*)::int as v from ev where pid is not null group by pid)
  select p.id, p.full_name, p.nickname, p.display_name, p.photo_url, t.id, t.name, t.short_name, t.logo_url, tot.v,
         (select count(*)::int from public.player_match_appearances a join public.matches mm on mm.id = a.match_id and mm.status = 'finished' where a.player_id = p.id)
    from tot join public.profiles p on p.id = tot.pid
    left join public.team_memberships tm on tm.player_id = p.id and tm.status = 'active'
    left join public.teams t on t.id = tm.team_id
   order by tot.v desc, p.full_name asc nulls last
   limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;

-- p_by: 'ovr' (rating) or 'performance'. perf_score = 4*goals + 3*assists + 1*matches - 1*yellow - 3*red
create or replace function public.league_best_players(p_by text default 'ovr', p_limit int default 10)
returns table (player_id uuid, full_name text, nickname text, display_name text, photo_url text, main_position text,
               team_id uuid, team_name text, team_short text, ovr int, matches int, goals int, assists int, yellow int, red int, perf_score int)
language sql stable security definer set search_path = public as $$
  with s as (
    select p.id,
      (select count(*)::int from public.player_match_appearances a join public.matches m on m.id = a.match_id and m.status = 'finished' where a.player_id = p.id) as mp,
      (select count(*)::int from public.match_events e join public.matches m on m.id = e.match_id and m.status = 'finished' where e.player_id = p.id and e.event_type = 'goal' and coalesce(e.detail,'normal') <> 'own_goal') as g,
      (select count(*)::int from public.match_events e join public.matches m on m.id = e.match_id and m.status = 'finished' where e.related_player_id = p.id and e.event_type = 'goal' and coalesce(e.detail,'normal') <> 'own_goal') as a,
      (select count(*)::int from public.match_events e join public.matches m on m.id = e.match_id and m.status = 'finished' where e.player_id = p.id and e.event_type = 'yellow') as y,
      (select count(*)::int from public.match_events e join public.matches m on m.id = e.match_id and m.status = 'finished' where e.player_id = p.id and e.event_type = 'red') as r
      from public.profiles p
  )
  select p.id, p.full_name, p.nickname, p.display_name, p.photo_url, p.main_position, t.id, t.name, t.short_name, p.ovr,
         s.mp, s.g, s.a, s.y, s.r, (4 * s.g + 3 * s.a + s.mp - s.y - 3 * s.r)
    from s join public.profiles p on p.id = s.id
    left join public.team_memberships tm on tm.player_id = p.id and tm.status = 'active'
    left join public.teams t on t.id = tm.team_id
   where p_by = 'ovr' or s.mp > 0
   order by case when p_by = 'ovr' then p.ovr else (4 * s.g + 3 * s.a + s.mp - s.y - 3 * s.r) end desc, p.full_name asc nulls last
   limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;

create or replace function public.team_formation_public(p_team uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team_id', f.team_id, 'formation', f.formation, 'captain_id', f.captain_id, 'updated_at', f.updated_at,
    'starters', coalesce((select jsonb_agg(jsonb_build_object('slot', (s->>'slot')::int, 'player', public.person_json((s->>'player_id')::uuid)) order by (s->>'slot')::int)
                            from jsonb_array_elements(f.starters) s
                           where exists (select 1 from public.team_memberships m where m.team_id = f.team_id and m.player_id = (s->>'player_id')::uuid and m.status = 'active')), '[]'::jsonb),
    'bench', coalesce((select jsonb_agg(public.person_json(b::uuid))
                         from jsonb_array_elements_text(f.bench) b
                        where exists (select 1 from public.team_memberships m where m.team_id = f.team_id and m.player_id = b::uuid and m.status = 'active')), '[]'::jsonb))
  from public.team_formations f where f.team_id = p_team
$$;

create or replace function public.team_roster(p_team uuid)
returns table (player_id uuid, full_name text, nickname text, display_name text, photo_url text,
               main_position text, secondary_position text, preferred_foot text, ovr int, jersey_number int, role_in_team text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.nickname, p.display_name, p.photo_url, p.main_position, p.secondary_position, p.preferred_foot,
         p.ovr, m.jersey_number, m.role_in_team
    from public.team_memberships m join public.profiles p on p.id = m.player_id
   where m.team_id = p_team and m.status = 'active'
   order by (m.role_in_team = 'captain') desc, p.ovr desc, p.full_name asc nulls last
$$;

create or replace function public.match_detail(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then return null; end if;
  return jsonb_build_object(
    'match', to_jsonb(m),
    'home', (select jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'logo_url', t.logo_url, 'color_primary', t.color_primary) from public.teams t where t.id = m.home_team_id),
    'away', (select jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'logo_url', t.logo_url, 'color_primary', t.color_primary) from public.teams t where t.id = m.away_team_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.event_type, 'detail', e.detail, 'minute', e.minute, 'extra_minute', e.extra_minute,
                          'team_id', e.team_id, 'player', public.person_json(e.player_id), 'related', public.person_json(e.related_player_id)) order by e.sequence)
                          from public.match_events e where e.match_id = m.id), '[]'::jsonb),
    'lineups', coalesce((select jsonb_agg(jsonb_build_object('team_id', l.team_id, 'formation', l.formation, 'captain_id', l.captain_id,
                          'players', coalesce((select jsonb_agg(jsonb_build_object('player', public.person_json(lp.player_id), 'jersey_number', lp.jersey_number,
                                     'position', lp.match_position, 'is_starter', lp.is_starter, 'is_captain', lp.is_captain, 'slot', lp.slot) order by lp.is_starter desc, lp.jersey_number nulls last)
                                     from public.lineup_players lp where lp.lineup_id = l.id), '[]'::jsonb)))
                          from public.match_lineups l where l.match_id = m.id), '[]'::jsonb),
    'team_formations', jsonb_build_array(public.team_formation_public(m.home_team_id), public.team_formation_public(m.away_team_id)));
end $$;

create or replace function public.player_public(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; v_team jsonb; v_stats jsonb; v_hist jsonb; v_me uuid := auth.uid();
begin
  select * into p from public.profiles where id = p_id;
  if not found then return null; end if;
  select jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'logo_url', t.logo_url, 'color_primary', t.color_primary,
                            'role_in_team', m.role_in_team, 'jersey_number', m.jersey_number)
    into v_team from public.team_memberships m join public.teams t on t.id = m.team_id where m.player_id = p_id and m.status = 'active';
  select jsonb_build_object(
    'matches', (select count(*) from public.player_match_appearances a join public.matches mm on mm.id = a.match_id and mm.status = 'finished' where a.player_id = p_id),
    'goals',   (select count(*) from public.match_events e join public.matches mm on mm.id = e.match_id and mm.status = 'finished' where e.player_id = p_id and e.event_type = 'goal' and coalesce(e.detail,'normal') <> 'own_goal'),
    'assists', (select count(*) from public.match_events e join public.matches mm on mm.id = e.match_id and mm.status = 'finished' where e.related_player_id = p_id and e.event_type = 'goal' and coalesce(e.detail,'normal') <> 'own_goal'),
    'yellow',  (select count(*) from public.match_events e join public.matches mm on mm.id = e.match_id and mm.status = 'finished' where e.player_id = p_id and e.event_type = 'yellow'),
    'red',     (select count(*) from public.match_events e join public.matches mm on mm.id = e.match_id and mm.status = 'finished' where e.player_id = p_id and e.event_type = 'red')) into v_stats;
  select coalesce(jsonb_agg(h order by h->>'kickoff_at' desc), '[]'::jsonb) into v_hist from (
    select jsonb_build_object('match_id', mm.id, 'kickoff_at', mm.kickoff_at, 'home', th.short_name, 'away', ta.short_name,
             'home_score', mm.home_score, 'away_score', mm.away_score, 'team_id', a.team_id, 'home_id', mm.home_team_id, 'away_id', mm.away_team_id,
             'goals', (select count(*) from public.match_events e where e.match_id = mm.id and e.player_id = p_id and e.event_type = 'goal' and coalesce(e.detail,'normal') <> 'own_goal'),
             'assists', (select count(*) from public.match_events e where e.match_id = mm.id and e.related_player_id = p_id and e.event_type = 'goal' and coalesce(e.detail,'normal') <> 'own_goal')) as h
      from public.player_match_appearances a join public.matches mm on mm.id = a.match_id and mm.status = 'finished'
      join public.teams th on th.id = mm.home_team_id join public.teams ta on ta.id = mm.away_team_id
     where a.player_id = p_id order by mm.kickoff_at desc limit 20) q;
  return jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'nickname', p.nickname, 'display_name', p.display_name, 'photo_url', p.photo_url, 'bio', p.bio,
    'age', case when p.birth_date is null then null else extract(year from age(current_date, p.birth_date))::int end,
    'age_estimated', p.birth_date_estimated,
    'height_cm', p.height_cm, 'weight_kg', p.weight_kg, 'preferred_foot', p.preferred_foot,
    'main_position', p.main_position, 'secondary_position', p.secondary_position, 'ovr', p.ovr,
    'team', v_team, 'stats', v_stats, 'history', v_hist,
    'followers', (select count(*) from public.follows f where f.followee_id = p_id),
    'following', (select count(*) from public.follows f where f.follower_id = p_id),
    'is_following', case when v_me is null then false else exists (select 1 from public.follows f where f.follower_id = v_me and f.followee_id = p_id) end,
    'is_me', v_me is not null and v_me = p_id);
end $$;

create or replace function public.search_players(p_q text default '', p_team uuid default null, p_position text default null, p_limit int default 20)
returns table (player_id uuid, full_name text, nickname text, display_name text, photo_url text, main_position text, ovr int,
               team_id uuid, team_name text, team_short text, team_logo text)
language sql stable security definer set search_path = public as $$
  with q as (select public.norm_text(trim(coalesce(p_q, ''))) as n)
  select p.id, p.full_name, p.nickname, p.display_name, p.photo_url, p.main_position, p.ovr, t.id, t.name, t.short_name, t.logo_url
    from public.profiles p
    left join public.team_memberships tm on tm.player_id = p.id and tm.status = 'active'
    left join public.teams t on t.id = tm.team_id, q
   where coalesce(p.full_name, p.display_name) is not null
     and (p_team is null or tm.team_id = p_team)
     and (p_position is null or p.main_position = p_position)
     and not exists (
           select 1 from regexp_split_to_table(q.n, '\s+') tok
            where tok <> '' and public.norm_text(coalesce(p.full_name, '') || ' ' || coalesce(p.nickname, '') || ' ' || coalesce(p.display_name, ''))
                                  not like '%' || replace(replace(replace(tok, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by (public.norm_text(coalesce(p.full_name, p.display_name)) like q.n || '%' or public.norm_text(coalesce(p.nickname, '')) like q.n || '%') desc,
            p.ovr desc, p.full_name asc nulls last
   limit greatest(1, least(coalesce(p_limit, 20), 30))
$$;
