-- =====================================================================
--  001  Roles (member + one super admin), profiles (birth date, privacy),
--       removal of the staff-request and team-request flows.
--  Idempotent: runs on every start, on an empty database and on one with data.
--  Nothing here deletes players, teams, matches, events or messages.
-- =====================================================================

-- ---- profiles: birth date (birth_year is kept and stays in sync) ----
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists birth_date_estimated boolean not null default false;
alter table public.profiles add column if not exists bio text;

-- birth_year used to be limited to 1940..2020; a real date needs a wider range
do $$ declare r record; begin
  for r in select conname from pg_constraint
            where conrelid = 'public.profiles'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%birth_year%' and conname <> 'profiles_birth_year_range' loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'profiles_birth_year_range') then
    alter table public.profiles add constraint profiles_birth_year_range check (birth_year is null or birth_year between 1900 and 2100);
  end if;
end $$;

-- carry every existing birth_year into birth_date (1 January of that year, flagged as an estimate,
-- so nobody loses their data and the profile can ask them for the exact day later).
-- This runs BEFORE the validation trigger below exists, so old values are never rejected.
update public.profiles
   set birth_date = make_date(birth_year, 1, 1), birth_date_estimated = true
 where birth_date is null and birth_year is not null;

create or replace function public.valid_birth_date(d date) returns boolean
language sql stable as $$
  select d is not null and d <= current_date
     and extract(year from age(current_date, d)) between 8 and 90
$$;

create or replace function public.profiles_birth_guard() returns trigger
language plpgsql as $$
declare v_check boolean := false;
begin
  if tg_op = 'INSERT' then v_check := true;
  elsif new.birth_date is distinct from old.birth_date then v_check := true;
  end if;
  if v_check and new.birth_date is not null then
    if not public.valid_birth_date(new.birth_date) then raise exception 'INVALID_BIRTH_DATE'; end if;
    new.birth_date_estimated := false;          -- a date entered by the user is exact
  end if;
  if new.birth_date is not null then new.birth_year := extract(year from new.birth_date)::int; end if;
  return new;
end $$;
drop trigger if exists profiles_birth_guard on public.profiles;
create trigger profiles_birth_guard before insert or update on public.profiles
  for each row execute function public.profiles_birth_guard();

-- ---- roles: only 'member' and 'super_admin' ----
do $$ declare r record; begin
  for r in select conname from pg_constraint
            where conrelid = 'public.profiles'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%score_manager%' loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;
update public.profiles set role = 'member' where role in ('pending', 'score_manager');
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_member_or_super') then
    alter table public.profiles add constraint profiles_role_member_or_super check (role in ('member', 'super_admin'));
  end if;
end $$;

-- ONE super admin: if an old database has several, the earliest account keeps the role
do $$ declare v_keep uuid; v_n int; begin
  select count(*) into v_n from public.profiles where role = 'super_admin';
  if v_n > 1 then
    select id into v_keep from public.profiles where role = 'super_admin' order by created_at asc, id asc limit 1;
    update public.profiles set role = 'member' where role = 'super_admin' and id <> v_keep;
    raise notice '[001] % super admins found: kept the oldest account, the others are now members', v_n;
  end if;
end $$;
create unique index if not exists profiles_single_super_admin on public.profiles ((role)) where role = 'super_admin';

-- the old "staff" helper now means "the super admin" (existing security rules keep working)
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
$$;

-- ---- privacy: e-mails were readable by every logged-in user. They stay in auth.users only. ----
update public.profiles set email = null where email is not null;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full text := nullif(trim(meta->>'full_name'), '');
  v_name text;
  v_bd   date;
  v_year int;
  v_pos  text;
  v_foot text;
begin
  v_name := coalesce(nullif(trim(meta->>'display_name'), ''), v_full, split_part(new.email, '@', 1));
  begin v_bd := (meta->>'birth_date')::date; exception when others then v_bd := null; end;
  if v_bd is not null and not public.valid_birth_date(v_bd) then v_bd := null; end if;
  if v_bd is null and (meta->>'birth_year') ~ '^[0-9]{4}$' then
    v_year := (meta->>'birth_year')::int;
    if v_year between 1940 and 2020 then v_bd := make_date(v_year, 1, 1); end if;
  end if;
  v_pos  := case when (meta->>'main_position') in ('goalkeeper','defender','midfielder','forward') then meta->>'main_position' end;
  v_foot := case when (meta->>'preferred_foot') in ('right','left','both') then meta->>'preferred_foot' end;
  insert into public.profiles (id, email, display_name, full_name, nickname, birth_date, main_position, preferred_foot, profile_complete)
  values (new.id, null, v_name, v_full, nullif(trim(meta->>'nickname'), ''), v_bd, v_pos, v_foot,
          (v_full is not null and v_bd is not null and v_pos is not null and v_foot is not null))
  on conflict (id) do nothing;
  return new;
end $$;

-- profiles are no longer world-readable: a user reads their own row, the super admin reads all.
-- Everyone else gets public data through the functions in 002 (no e-mail, no exact birth date).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin());

-- ---- remove the "request admin access" and "users create teams" flows ----
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('submit_staff_request','review_staff_request','change_manager_role','request_team_creation','approve_team_creation') loop
    execute 'drop function ' || r.sig::text;
  end loop;
end $$;
drop table if exists public.staff_access_requests cascade;
drop table if exists public.team_creation_requests cascade;

-- ---- teams: colours; at most one active captain per team ----
alter table public.teams add column if not exists color_primary   text not null default '#9fd356';
alter table public.teams add column if not exists color_secondary text not null default '#0b0d0a';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'teams_colors_hex') then
    alter table public.teams add constraint teams_colors_hex
      check (color_primary ~ '^#[0-9a-fA-F]{6}$' and color_secondary ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

update public.team_memberships m set role_in_team = 'player'
 where m.status = 'active' and m.role_in_team = 'captain'
   and exists (select 1 from public.team_memberships o
                where o.team_id = m.team_id and o.status = 'active' and o.role_in_team = 'captain'
                  and (o.joined_at, o.id) < (m.joined_at, m.id));
create unique index if not exists memberships_one_captain on public.team_memberships (team_id)
  where status = 'active' and role_in_team = 'captain';

-- lineups: visible to everyone once saved (they used to stay hidden until the match was live)
drop policy if exists lineups_select on public.match_lineups;
create policy lineups_select on public.match_lineups for select to anon, authenticated using (true);
drop policy if exists lineup_players_select on public.lineup_players;
create policy lineup_players_select on public.lineup_players for select to anon, authenticated using (true);
