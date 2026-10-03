-- air.band accounts and jam history (Supabase / Postgres).
-- Everyone gets an account silently (anonymous sign-in), so joining a jam needs no sign-up;
-- saving an email later turns it into a full account with the same id and history.
-- What's recorded here is what matchmaking will learn from: who played with whom, as what,
-- how far apart they were on the network, and whether they'd jam again.

-- people
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  instruments text[] not null default '{}',
  genres text[] not null default '{}',
  level text check (level in ('beginner', 'intermediate', 'advanced', 'pro')),
  country text check (char_length(country) <= 2),
  bio text check (char_length(bio) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- a jam: one per room (the room's id from the invite link)
create table if not exists public.jams (
  id text primary key,
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  mode text,            -- 'trade' (BARS) or 'free'
  bars int,
  track text,           -- what the band played
  bpm int,
  musical_key text
);

-- who was in it, as what, and for how long
create table if not exists public.jam_players (
  jam_id text not null references public.jams on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  instrument text,
  engine text,          -- 'browser' or 'app 0.6.2' etc.
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (jam_id, user_id)
);
create index if not exists jam_players_user on public.jam_players (user_id);

-- how far apart two players were (measured in the jam, from a's side)
create table if not exists public.pair_latency (
  jam_id text not null references public.jams on delete cascade,
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  measured_at timestamptz not null default now(),
  one_way_ms real,      -- their instrument to your ears
  network_ms real,
  jitter_ms real,
  loss_pct real,
  route text,           -- 'direct', 'relay', 'app'
  primary key (jam_id, a, b, measured_at)
);
create index if not exists pair_latency_pair on public.pair_latency (a, b);

-- "would jam again?" after a jam
create table if not exists public.ratings (
  jam_id text not null references public.jams on delete cascade,
  rater uuid not null references public.profiles (id) on delete cascade,
  ratee uuid not null references public.profiles (id) on delete cascade,
  again boolean not null,
  created_at timestamptz not null default now(),
  primary key (jam_id, rater, ratee),
  check (rater <> ratee)
);
create index if not exists ratings_ratee on public.ratings (ratee);

-- a profile for every new account (anonymous ones too)
create or replace function public.new_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 40))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();

create or replace function public.touch() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch();

-- was I in this jam? (used by the rules below; definer so it doesn't loop through them)
create or replace function public.in_jam(j text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jam_players where jam_id = j and user_id = auth.uid())
$$;

-- rules: everyone signed in (anonymous included) can see profiles; you change only your own things
alter table public.profiles enable row level security;
alter table public.jams enable row level security;
alter table public.jam_players enable row level security;
alter table public.pair_latency enable row level security;
alter table public.ratings enable row level security;

drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "jams: start" on public.jams;
create policy "jams: start" on public.jams for insert to authenticated with check (created_by = auth.uid() or created_by is null);
drop policy if exists "jams: read mine" on public.jams;
create policy "jams: read mine" on public.jams for select to authenticated using (public.in_jam(id) or created_by = auth.uid());
drop policy if exists "jams: creator updates" on public.jams;
create policy "jams: creator updates" on public.jams for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "players: join" on public.jam_players;
create policy "players: join" on public.jam_players for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "players: update own" on public.jam_players;
create policy "players: update own" on public.jam_players for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "players: read my jams" on public.jam_players;
create policy "players: read my jams" on public.jam_players for select to authenticated using (user_id = auth.uid() or public.in_jam(jam_id));   -- your own row too (saving it needs that)

drop policy if exists "latency: add own" on public.pair_latency;
create policy "latency: add own" on public.pair_latency for insert to authenticated with check (a = auth.uid());
drop policy if exists "latency: read own" on public.pair_latency;
create policy "latency: read own" on public.pair_latency for select to authenticated using (a = auth.uid());

drop policy if exists "ratings: give" on public.ratings;
create policy "ratings: give" on public.ratings for insert to authenticated with check (rater = auth.uid() and public.in_jam(jam_id));
drop policy if exists "ratings: change own" on public.ratings;
create policy "ratings: change own" on public.ratings for update to authenticated using (rater = auth.uid()) with check (rater = auth.uid());
drop policy if exists "ratings: read own" on public.ratings;
create policy "ratings: read own" on public.ratings for select to authenticated using (rater = auth.uid());

-- delete my account (and with it everything above, by cascade)
create or replace function public.delete_me() returns void language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- joining a jam in one step: the jam (if it isn't there yet) and you in it. A function,
-- because guests can't see a jam before they're in it (room ids work like invites, so
-- they stay private), and "create it unless it exists" needs to look.
create or replace function public.join_jam(jam text, creator boolean, instrument text, engine text, mode text, bars int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.jams (id, created_by, mode, bars) values (jam, case when creator then auth.uid() end, mode, bars) on conflict (id) do nothing;
  insert into public.jam_players (jam_id, user_id, instrument, engine) values (jam, auth.uid(), instrument, engine)
  on conflict (jam_id, user_id) do update set instrument = excluded.instrument, engine = excluded.engine, left_at = null;
end $$;
revoke all on function public.join_jam(text, boolean, text, text, text, int) from public, anon;
grant execute on function public.join_jam(text, boolean, text, text, text, int) to authenticated;
