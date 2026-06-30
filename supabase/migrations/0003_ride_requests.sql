-- ============ テーブル ============
create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  depart_at timestamptz not null,
  origin_text text not null,
  destination_text text not null,
  note text,
  status text not null default 'open' check (status in ('open','matched','completed','cancelled')),
  driver_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ ヘルパ（承認済みメンバー判定）============
create or replace function public.is_approved_community_member(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.community_memberships m
    where m.community_id = cid and m.user_id = auth.uid() and m.status = 'approved'
  );
$$;

-- ============ RLS: ride_requests ============
alter table public.ride_requests enable row level security;
grant select, insert, update, delete on public.ride_requests to authenticated;

create policy "ride_requests_select_members" on public.ride_requests
  for select using (public.is_approved_community_member(community_id));

create policy "ride_requests_insert_own" on public.ride_requests
  for insert with check (rider_id = auth.uid() and public.is_approved_community_member(community_id));

create policy "ride_requests_update_involved" on public.ride_requests
  for update using (rider_id = auth.uid() or driver_id = auth.uid())
  with check (rider_id = auth.uid() or driver_id = auth.uid());

-- ============ RLS: push_tokens（自分のみ）============
alter table public.push_tokens enable row level security;
grant select, insert, update, delete on public.push_tokens to authenticated;

create policy "push_tokens_select_own" on public.push_tokens
  for select using (user_id = auth.uid());
create policy "push_tokens_insert_own" on public.push_tokens
  for insert with check (user_id = auth.uid());
create policy "push_tokens_update_own" on public.push_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push_tokens_delete_own" on public.push_tokens
  for delete using (user_id = auth.uid());

-- ============ RPC: 応答して成立（先着・原子的）============
create or replace function public.accept_ride_request(p_request uuid)
returns public.ride_requests
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid;
  v_row public.ride_requests;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select community_id into v_cid from public.ride_requests where id = p_request;
  if v_cid is null then raise exception 'request not found'; end if;
  if not exists (
    select 1 from public.community_memberships m
    where m.community_id = v_cid and m.user_id = auth.uid() and m.status = 'approved'
  ) then
    raise exception 'not an approved member';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_driver
  ) then
    raise exception 'not a driver';
  end if;
  update public.ride_requests
    set driver_id = auth.uid(), status = 'matched'
    where id = p_request and status = 'open'
    returning * into v_row;
  if v_row.id is null then raise exception 'request not open'; end if;
  return v_row;
end;
$$;

grant execute on function public.accept_ride_request(uuid) to authenticated;

-- ============ プッシュ通知（pg_net で Expo Push API を直接POST。ベストエフォート）============
create extension if not exists pg_net;

create or replace function public.notify_drivers_on_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_messages jsonb;
  v_community_name text;
begin
  select name into v_community_name from public.communities where id = new.community_id;
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', 'のりあわせ：新しい「乗せて」',
           'body', coalesce(v_community_name, 'コミュニティ') || 'で乗合の依頼があります',
           'data', jsonb_build_object('requestId', new.id, 'communityId', new.community_id)
         ))
    into v_messages
  from public.push_tokens t
  join public.community_memberships m on m.user_id = t.user_id
  join public.profiles p on p.id = t.user_id
  where m.community_id = new.community_id
    and m.status = 'approved'
    and p.is_driver = true
    and t.user_id <> new.rider_id;

  if v_messages is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_messages
    );
  end if;
  return new;
end;
$$;

create trigger ride_requests_notify_after_insert
  after insert on public.ride_requests
  for each row execute function public.notify_drivers_on_request();

-- ============ updated_at トリガ ============
create trigger ride_requests_set_updated_at
  before update on public.ride_requests
  for each row execute function public.set_updated_at();
create trigger push_tokens_set_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();
