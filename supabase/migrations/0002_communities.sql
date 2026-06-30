-- ============ テーブル ============
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.community_memberships (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);

-- ============ 可視判定ヘルパ（SECURITY DEFINER でRLSをバイパス＝相互再帰を回避）============
create or replace function public.is_community_owner(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.communities c
    where c.id = cid and c.owner_id = auth.uid()
  );
$$;

create or replace function public.is_community_member(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.community_memberships m
    where m.community_id = cid and m.user_id = auth.uid()
      and m.status in ('pending','approved')
  );
$$;

-- ============ RLS ============
alter table public.communities enable row level security;
alter table public.community_memberships enable row level security;

grant select, insert, update, delete on public.communities to authenticated;
grant select, insert, update, delete on public.community_memberships to authenticated;

create policy "communities_select_visible" on public.communities
  for select using (public.is_community_owner(id) or public.is_community_member(id));
create policy "communities_update_owner" on public.communities
  for update using (public.is_community_owner(id)) with check (public.is_community_owner(id));

create policy "memberships_select_self_or_owner" on public.community_memberships
  for select using (user_id = auth.uid() or public.is_community_owner(community_id));
create policy "memberships_update_owner" on public.community_memberships
  for update using (public.is_community_owner(community_id)) with check (public.is_community_owner(community_id));
create policy "memberships_delete_owner" on public.community_memberships
  for delete using (public.is_community_owner(community_id));

-- ============ RPC: コミュニティ作成 ============
create or replace function public.create_community(p_name text)
returns public.communities
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_row public.communities;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if length(trim(p_name)) < 2 then
    raise exception 'name too short';
  end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.communities where invite_code = v_code);
  end loop;
  insert into public.communities (name, invite_code, owner_id)
  values (trim(p_name), v_code, auth.uid())
  returning * into v_row;
  insert into public.community_memberships (community_id, user_id, status, role)
  values (v_row.id, auth.uid(), 'approved', 'owner');
  return v_row;
end;
$$;

-- ============ RPC: 招待コードで参加申請 ============
create or replace function public.join_community_by_code(p_code text)
returns public.communities
language plpgsql security definer set search_path = public as $$
declare
  v_row public.communities;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into v_row from public.communities where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'invalid code';
  end if;
  insert into public.community_memberships (community_id, user_id, status, role)
  values (v_row.id, auth.uid(), 'pending', 'member')
  on conflict (community_id, user_id) do nothing;
  return v_row;
end;
$$;

grant execute on function public.create_community(text) to authenticated;
grant execute on function public.join_community_by_code(text) to authenticated;

-- ============ updated_at トリガ ============
create trigger communities_set_updated_at
  before update on public.communities
  for each row execute function public.set_updated_at();

create trigger community_memberships_set_updated_at
  before update on public.community_memberships
  for each row execute function public.set_updated_at();
