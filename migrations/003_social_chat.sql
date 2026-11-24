-- =====================================================================
--  003  Media stored in PostgreSQL, follows, blocks, private + team chat,
--       and the permission grants for everything above.
--  Chat/media tables are NOT readable through the generic REST layer:
--  only the Node server (which checks membership itself) touches them.
-- =====================================================================

-- ---- media: photos, logos, voice notes and chat pictures live in the database ----
create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in ('avatar','logo','voice','chat_image')),
  mime        text not null check (mime in ('image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg')),
  size_bytes  int  not null check (size_bytes between 1 and 4000000),
  duration_ms int  check (duration_ms is null or duration_ms between 0 and 125000),
  data        bytea not null,
  created_at  timestamptz not null default now()
);
create index if not exists media_owner_idx on public.media (owner_id, created_at desc);

-- ---- follows / blocks ----
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- ---- conversations ----
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('direct','team')),
  team_id         uuid references public.teams(id) on delete cascade,
  user_a          uuid references public.profiles(id) on delete cascade,   -- direct chats: user_a < user_b
  user_b          uuid references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  check ((kind = 'direct' and team_id is null and user_a is not null and user_b is not null and user_a < user_b)
      or (kind = 'team' and team_id is not null and user_a is null and user_b is null))
);
create unique index if not exists conversations_direct_pair on public.conversations (user_a, user_b) where kind = 'direct';
create unique index if not exists conversations_team_one   on public.conversations (team_id) where kind = 'team';

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('text','voice','image','card')),
  body            text check (body is null or char_length(body) <= 2000),
  media_id        uuid references public.media(id) on delete set null,
  duration_ms     int check (duration_ms is null or duration_ms between 0 and 125000),
  card            jsonb,                          -- {"type":"match|player|team","id":"<uuid>"}
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (deleted_at is not null
         or (kind = 'text'  and body is not null and char_length(trim(body)) > 0)
         or (kind in ('voice','image') and media_id is not null)
         or (kind = 'card'  and card is not null and card->>'type' in ('match','player','team') and public.try_uuid(card->>'id') is not null))
);
create index if not exists messages_conv_created_idx on public.messages (conversation_id, created_at desc);

alter table public.media                enable row level security;
alter table public.follows              enable row level security;
alter table public.blocks               enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
-- (no policies on purpose: with RLS on and no policy, the REST layer sees nothing)

-- ---- team group chat: created with the team, members follow the roster ----
create or replace function public.sync_team_chat(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  if not exists (select 1 from public.teams where id = p_team) then return; end if;
  select id into v_conv from public.conversations where kind = 'team' and team_id = p_team;
  if v_conv is null then
    insert into public.conversations (kind, team_id) values ('team', p_team) on conflict do nothing returning id into v_conv;
    if v_conv is null then select id into v_conv from public.conversations where kind = 'team' and team_id = p_team; end if;
  end if;
  -- members = active players (the captain is one of them) + the super admin
  delete from public.conversation_members cm
   where cm.conversation_id = v_conv
     and cm.user_id not in (select m.player_id from public.team_memberships m where m.team_id = p_team and m.status = 'active'
                            union select pr.id from public.profiles pr where pr.role = 'super_admin');
  insert into public.conversation_members (conversation_id, user_id)
  select v_conv, u.id from (select m.player_id as id from public.team_memberships m where m.team_id = p_team and m.status = 'active'
                            union select pr.id from public.profiles pr where pr.role = 'super_admin') u
  on conflict do nothing;
end $$;

create or replace function public.trg_team_chat_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'teams' then
    perform public.sync_team_chat(new.id);
  elsif tg_op = 'DELETE' then
    perform public.sync_team_chat(old.team_id);
  else
    perform public.sync_team_chat(new.team_id);
    if tg_op = 'UPDATE' and old.team_id is distinct from new.team_id then perform public.sync_team_chat(old.team_id); end if;
  end if;
  return null;
end $$;
drop trigger if exists teams_chat_sync on public.teams;
create trigger teams_chat_sync after insert on public.teams for each row execute function public.trg_team_chat_sync();
drop trigger if exists memberships_chat_sync on public.team_memberships;
create trigger memberships_chat_sync after insert or update or delete on public.team_memberships
  for each row execute function public.trg_team_chat_sync();

-- ---- follow / block functions ----
create or replace function public.follow_player(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_player is null or p_player = v_uid or not exists (select 1 from public.profiles where id = p_player) then raise exception 'PLAYER_NOT_FOUND'; end if;
  if exists (select 1 from public.blocks where (blocker_id = p_player and blocked_id = v_uid) or (blocker_id = v_uid and blocked_id = p_player)) then raise exception 'BLOCKED'; end if;
  insert into public.follows (follower_id, followee_id) values (v_uid, p_player) on conflict do nothing;
end $$;

create or replace function public.unfollow_player(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.follows where follower_id = auth.uid() and followee_id = p_player;
end $$;

-- p_kind: 'followers' (people who follow p_player) or 'following' (people p_player follows)
create or replace function public.follow_list(p_player uuid, p_kind text default 'followers', p_limit int default 50)
returns table (player_id uuid, full_name text, nickname text, display_name text, photo_url text, main_position text, ovr int, is_following boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.nickname, p.display_name, p.photo_url, p.main_position, p.ovr,
         case when auth.uid() is null then false else exists (select 1 from public.follows x where x.follower_id = auth.uid() and x.followee_id = p.id) end
    from public.follows f
    join public.profiles p on p.id = case when p_kind = 'following' then f.followee_id else f.follower_id end
   where (p_kind = 'following' and f.follower_id = p_player) or (p_kind <> 'following' and f.followee_id = p_player)
   order by f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 100))
$$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_user is null or p_user = v_uid or not exists (select 1 from public.profiles where id = p_user) then raise exception 'PLAYER_NOT_FOUND'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_user) on conflict do nothing;
  delete from public.follows where (follower_id = v_uid and followee_id = p_user) or (follower_id = p_user and followee_id = v_uid);
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user;
end $$;

-- backfill: every existing team gets its group chat
do $$ declare r record; begin
  for r in select id from public.teams loop perform public.sync_team_chat(r.id); end loop;
end $$;
