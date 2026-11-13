-- Life Tracker: database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again (it skips or replaces what already exists).
--
-- What it makes:
--   user_data          one row per user per section (pnl / life / journal / looksmax), the whole section as JSON
--   user_data_history  earlier versions (kept automatically whenever a row is overwritten, last 10 per section)
--   media bucket       Journal photos and audio + Looksmax progress photos, one folder per user ("<user id>/<file id>")
--   delete_my_account  lets a logged-in user delete their own account and data
-- Row Level Security is ON everywhere: a user can only ever read or write their own rows and files.

-- ---------- Sections ----------
create table if not exists public.user_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  section    text        not null,
  data       jsonb       not null,
  changed_at timestamptz not null default now(),  -- when the change was made on the device (newest wins)
  updated_at timestamptz not null default now(),  -- when the server saved it (used to spot clashes)
  device     text,
  primary key (user_id, section)
);
-- Which sections exist. Replaced on every run, so adding a section later (Looksmax, 2026-11-13)
-- only needs this file run again.
alter table public.user_data drop constraint if exists user_data_section_check;
alter table public.user_data add constraint user_data_section_check
  check (section in ('pnl', 'life', 'journal', 'looksmax'));
alter table public.user_data enable row level security;

drop policy if exists "own rows: read"   on public.user_data;
drop policy if exists "own rows: add"    on public.user_data;
drop policy if exists "own rows: change" on public.user_data;
drop policy if exists "own rows: delete" on public.user_data;
create policy "own rows: read"   on public.user_data for select to authenticated using (user_id = auth.uid());
create policy "own rows: add"    on public.user_data for insert to authenticated with check (user_id = auth.uid());
create policy "own rows: change" on public.user_data for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows: delete" on public.user_data for delete to authenticated using (user_id = auth.uid());

-- ---------- Earlier versions ----------
create table if not exists public.user_data_history (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  section     text        not null,
  data        jsonb       not null,
  changed_at  timestamptz,
  device      text,
  replaced_at timestamptz not null default now(),
  reason      text        not null default 'replaced'
);
create index if not exists user_data_history_lookup on public.user_data_history (user_id, section, replaced_at desc);
alter table public.user_data_history enable row level security;

drop policy if exists "own history: read"   on public.user_data_history;
drop policy if exists "own history: add"    on public.user_data_history;
drop policy if exists "own history: delete" on public.user_data_history;
create policy "own history: read"   on public.user_data_history for select to authenticated using (user_id = auth.uid());
create policy "own history: add"    on public.user_data_history for insert to authenticated with check (user_id = auth.uid());
create policy "own history: delete" on public.user_data_history for delete to authenticated using (user_id = auth.uid());

-- Every overwrite: stamp the server time and keep the old version (last 10 per section)
create or replace function public.user_data_keep_previous() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if old.data is distinct from new.data then
    insert into public.user_data_history (user_id, section, data, changed_at, device, reason)
    values (old.user_id, old.section, old.data, old.changed_at, old.device, 'replaced');
    delete from public.user_data_history h
    where h.user_id = old.user_id and h.section = old.section
      and h.id not in (select id from public.user_data_history
                       where user_id = old.user_id and section = old.section
                       order by replaced_at desc limit 10);
  end if;
  return new;
end $$;
drop trigger if exists user_data_keep_previous on public.user_data;
create trigger user_data_keep_previous before update on public.user_data
  for each row execute function public.user_data_keep_previous();

-- ---------- Photos and audio ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)  -- private, 50 MB per file (the free plan's limit)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "own media: read"   on storage.objects;
drop policy if exists "own media: add"    on storage.objects;
drop policy if exists "own media: change" on storage.objects;
drop policy if exists "own media: delete" on storage.objects;
create policy "own media: read"   on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own media: add"    on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own media: change" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own media: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Delete my account ----------
-- The app deletes the user's files first (through Storage), then calls this.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not logged in'; end if;
  delete from public.user_data_history where user_id = uid;
  delete from public.user_data where user_id = uid;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
