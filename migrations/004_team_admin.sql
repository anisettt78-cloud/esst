-- =====================================================================
--  004  Team pages and requests: overview, requests for captains, my requests,
--       pending transfers for the super admin, leave team, cancel request.
--  (join requests / transfers themselves reuse request_join_team, decide_join_request,
--   request_transfer, captain_approve_transfer, finalize_transfer from the base schema)
-- =====================================================================

create or replace function public.teams_overview()
returns table (team_id uuid, name text, short_name text, logo_url text, color_primary text, color_secondary text, description text,
               archived boolean, players int, captain jsonb, has_formation boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.short_name, t.logo_url, t.color_primary, t.color_secondary, t.description, t.archived,
         (select count(*)::int from public.team_memberships m where m.team_id = t.id and m.status = 'active'),
         (select public.person_json(m.player_id) from public.team_memberships m
           where m.team_id = t.id and m.status = 'active' and m.role_in_team = 'captain' limit 1),
         exists (select 1 from public.team_formations f where f.team_id = t.id)
    from public.teams t
   where not t.archived or public.is_super_admin()
   order by t.archived, t.name
$$;

-- requests waiting for THIS team's captain (or the super admin)
create or replace function public.team_requests(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_team_captain(p_team) or public.is_super_admin()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'join', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'message', r.message, 'player', public.person_json(r.player_id)) order by r.created_at)
                        from public.team_join_requests r where r.team_id = p_team and r.status = 'pending'), '[]'::jsonb),
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'created_at', x.created_at, 'reason', x.reason, 'player', public.person_json(x.player_id),
                              'from_team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = x.from_team_id)) order by x.created_at)
                        from public.team_transfer_requests x where x.to_team_id = p_team and x.status = 'pending'), '[]'::jsonb));
end $$;

-- the logged-in player's own open requests
create or replace function public.my_requests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then return jsonb_build_object('join', '[]'::jsonb, 'transfers', '[]'::jsonb); end if;
  return jsonb_build_object(
    'join', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'team_id', r.team_id, 'team_name', t.name, 'created_at', r.created_at) order by r.created_at)
                        from public.team_join_requests r join public.teams t on t.id = r.team_id where r.player_id = v and r.status = 'pending'), '[]'::jsonb),
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'to_team_id', x.to_team_id, 'team_name', t.name, 'status', x.status, 'created_at', x.created_at) order by x.created_at)
                        from public.team_transfer_requests x join public.teams t on t.id = x.to_team_id where x.player_id = v and x.status in ('pending', 'captain_approved')), '[]'::jsonb));
end $$;

-- transfers waiting for the super admin's final decision
create or replace function public.admin_pending_transfers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'created_at', x.created_at, 'reason', x.reason, 'player', public.person_json(x.player_id),
            'from_team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = x.from_team_id),
            'to_team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = x.to_team_id)) order by x.created_at)
          from public.team_transfer_requests x where x.status in ('pending', 'captain_approved')), '[]'::jsonb);
end $$;

create or replace function public.cancel_join_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.team_join_requests set status = 'cancelled', reviewed_at = now() where id = p_request and player_id = auth.uid() and status = 'pending';
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
end $$;

-- a player leaves his team (a captain cannot: the super admin changes captains)
create or replace function public.leave_team() returns void
language plpgsql security definer set search_path = public as $$
declare v_m public.team_memberships;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_m from public.team_memberships where player_id = auth.uid() and status = 'active';
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_m.role_in_team = 'captain' then raise exception 'CAPTAIN_CANNOT_LEAVE'; end if;
  update public.team_memberships set status = 'left', left_at = now() where id = v_m.id;
end $$;
