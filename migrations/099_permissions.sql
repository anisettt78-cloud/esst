-- =====================================================================
--  099  PERMISSIONS - always the LAST migration; re-applied on every start so
--       every table and function created above is covered (new functions would
--       otherwise be executable by everybody, including visitors).
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
-- chat, follows, blocks and media are reachable ONLY through the Node server / the SQL functions
revoke all on public.media, public.follows, public.blocks, public.conversations, public.conversation_members, public.messages from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
-- the only functions a visitor (not logged in) may call: public read-only data
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('is_super_admin','is_staff','is_team_member','is_team_captain','norm_text','person_json','valid_birth_date',
                                'league_standings','league_top_players','league_best_players','team_formation_public','team_roster',
                                'match_detail','player_public','search_players','follow_list','teams_overview') loop
    execute 'grant execute on function ' || r.sig::text || ' to anon';
  end loop;
end $$;
