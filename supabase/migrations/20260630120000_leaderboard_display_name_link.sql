-- leaderboard_entries.display_name was denormalized — frozen at submit time — so a
-- user renaming themselves never updated their existing leaderboard rows. Link it
-- to the user instead: add an FK to profiles so reads embed the LIVE display name,
-- and stop requiring the column (new inserts omit it). Kept nullable rather than
-- dropped so a client still mid-deploy that sends it won't error; a later migration
-- can drop the column once nothing writes it.

alter table public.leaderboard_entries alter column display_name drop not null;

-- Safety / self-correct: ensure every account has a profile before adding the FK,
-- so the constraint validates even if some pre-trigger account slipped through.
-- handle_new_user already creates one per sign-up; this backfills any gap (same
-- logic as the original profiles backfill). With this, the migration can't fail
-- on prod's existing accounts — a missing profile is created, not rejected.
insert into public.profiles (user_id, display_name)
select u.id, public.unique_display_name(u.raw_user_meta_data->>'display_name')
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;

-- FK on user_id → profiles(user_id) so PostgREST can embed `profiles(display_name)`.
-- The existing user_id → auth.users FK stays; the `auth` schema isn't exposed to the
-- API, so the embeddable relationship is unambiguously `profiles`.
alter table public.leaderboard_entries
  drop constraint if exists leaderboard_entries_profile_fkey;
alter table public.leaderboard_entries
  add constraint leaderboard_entries_profile_fkey
  foreign key (user_id) references public.profiles (user_id) on delete cascade;

notify pgrst, 'reload schema';
