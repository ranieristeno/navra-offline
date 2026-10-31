-- NAVRA: run in Supabase SQL Editor as database owner, once.
-- RLS keeps each workspace private to its members. The client must use only an anon/publishable key.
create extension if not exists pgcrypto;

create table if not exists public.navra_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'NAVRA',
  invite_code text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now()
);
create table if not exists public.navra_members (
  workspace_id uuid not null references public.navra_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);
create index if not exists navra_members_user_idx on public.navra_members(user_id);
create table if not exists public.navra_records (
  id uuid primary key,
  workspace_id uuid not null references public.navra_workspaces(id) on delete cascade,
  type text not null check(type in ('watch','supplier','shipment','market')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists navra_records_workspace_idx on public.navra_records(workspace_id);

alter table public.navra_workspaces enable row level security;
alter table public.navra_members enable row level security;
alter table public.navra_records enable row level security;

-- Members can see their own membership and the workspace they belong to.
drop policy if exists "Read own NAVRA membership" on public.navra_members;
create policy "Read own NAVRA membership" on public.navra_members for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Read own NAVRA workspaces" on public.navra_workspaces;
create policy "Read own NAVRA workspaces" on public.navra_workspaces for select to authenticated using (
  exists(select 1 from public.navra_members m where m.workspace_id = id and m.user_id = (select auth.uid()))
);

-- Neither unauthenticated visitors nor users of other groups can read or modify records.
drop policy if exists "Read NAVRA records" on public.navra_records;
create policy "Read NAVRA records" on public.navra_records for select to authenticated using (
  exists(select 1 from public.navra_members m where m.workspace_id = navra_records.workspace_id and m.user_id = (select auth.uid()))
);
drop policy if exists "Insert NAVRA records" on public.navra_records;
create policy "Insert NAVRA records" on public.navra_records for insert to authenticated with check (
  exists(select 1 from public.navra_members m where m.workspace_id = navra_records.workspace_id and m.user_id = (select auth.uid()))
);
drop policy if exists "Update NAVRA records" on public.navra_records;
create policy "Update NAVRA records" on public.navra_records for update to authenticated using (
  exists(select 1 from public.navra_members m where m.workspace_id = navra_records.workspace_id and m.user_id = (select auth.uid()))
) with check (
  exists(select 1 from public.navra_members m where m.workspace_id = navra_records.workspace_id and m.user_id = (select auth.uid()))
);
drop policy if exists "Delete NAVRA records" on public.navra_records;
create policy "Delete NAVRA records" on public.navra_records for delete to authenticated using (
  exists(select 1 from public.navra_members m where m.workspace_id = navra_records.workspace_id and m.user_id = (select auth.uid()))
);

-- Joining requires an unguessable private invitation code. Functions run with controlled owner permissions.
create or replace function public.navra_create_workspace(p_name text default 'NAVRA')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare wid uuid; code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.navra_members where user_id=auth.uid()) then raise exception 'Already a member of a NAVRA workspace'; end if;
  insert into public.navra_workspaces(name) values(left(coalesce(nullif(trim(p_name),''),'NAVRA'),80)) returning id,invite_code into wid,code;
  insert into public.navra_members(workspace_id,user_id) values(wid,auth.uid());
  return jsonb_build_object('workspace_id',wid,'invite_code',code,'name',coalesce(nullif(trim(p_name),''),'NAVRA'));
end $$;

create or replace function public.navra_join_workspace(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare wid uuid; wname text; code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.navra_members where user_id=auth.uid()) then raise exception 'Already a member of a NAVRA workspace'; end if;
  select id,name,invite_code into wid,wname,code from public.navra_workspaces where invite_code=trim(p_code);
  if wid is null then raise exception 'Invalid invitation code'; end if;
  insert into public.navra_members(workspace_id,user_id) values(wid,auth.uid()) on conflict do nothing;
  return jsonb_build_object('workspace_id',wid,'invite_code',code,'name',wname);
end $$;

revoke all on function public.navra_create_workspace(text) from public, anon;
revoke all on function public.navra_join_workspace(text) from public, anon;
grant execute on function public.navra_create_workspace(text) to authenticated;
grant execute on function public.navra_join_workspace(text) to authenticated;
grant select on public.navra_workspaces, public.navra_members to authenticated;
grant select,insert,update,delete on public.navra_records to authenticated;
-- Do not grant direct insert/update/delete for workspaces/members; only the audited RPCs can alter them.
