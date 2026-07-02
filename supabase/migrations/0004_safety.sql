-- ============ watchers（見守り関係）============
create table public.watchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,          -- 見守られる人（利用者）
  watcher_user_id uuid not null references public.profiles(id) on delete cascade,  -- 見守る家族
  created_at timestamptz not null default now(),
  unique (user_id, watcher_user_id),
  check (user_id <> watcher_user_id)
);

alter table public.watchers enable row level security;
grant select, delete on public.watchers to authenticated;

-- 自分が「見守られる側」か「見守る側」の行だけ見える。削除は本人（見守られる側）のみ。追加はRPC経由。
create policy "watchers_select_related" on public.watchers
  for select using (user_id = auth.uid() or watcher_user_id = auth.uid());
create policy "watchers_delete_own" on public.watchers
  for delete using (user_id = auth.uid());

-- ============ RPC: メールアドレスで見守り家族を追加 ============
create or replace function public.add_watcher_by_email(p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_target from auth.users where lower(email) = lower(trim(p_email));
  if v_target is null then raise exception 'user not found'; end if;
  if v_target = auth.uid() then raise exception 'cannot watch yourself'; end if;
  insert into public.watchers (user_id, watcher_user_id)
  values (auth.uid(), v_target)
  on conflict (user_id, watcher_user_id) do nothing;
end;
$$;

grant execute on function public.add_watcher_by_email(text) to authenticated;

-- ============ profiles の氏名可視: 見守り関係にも開放 ============
create or replace function public.is_watch_related(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.watchers w
    where (w.user_id = auth.uid() and w.watcher_user_id = target)
       or (w.watcher_user_id = auth.uid() and w.user_id = target)
  );
$$;

create policy "profiles_select_watch_related" on public.profiles
  for select using (public.is_watch_related(id));

-- ============ ride_events（乗車記録・監査ログ）============
create table public.ride_events (
  id uuid primary key default gen_random_uuid(),
  ride_request_id uuid not null references public.ride_requests(id) on delete cascade,
  event text not null check (event in ('created','matched','completed','cancelled')),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ride_events enable row level security;
grant select on public.ride_events to authenticated;
-- insert/update/delete のポリシーは意図的に無し（書込はSECURITY DEFINERトリガのみ＝アプリから改変不可）

create policy "ride_events_select_involved" on public.ride_events
  for select using (
    exists (
      select 1 from public.ride_requests r
      where r.id = ride_request_id
        and (r.rider_id = auth.uid()
             or r.driver_id = auth.uid()
             or public.is_community_owner(r.community_id))
    )
  );

create or replace function public.log_ride_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ride_events (ride_request_id, event, actor_id)
    values (new.id, 'created', new.rider_id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.ride_events (ride_request_id, event, actor_id)
    values (
      new.id,
      new.status,
      case when new.status = 'matched' then new.driver_id else auth.uid() end
    );
  end if;
  return new;
end;
$$;

create trigger ride_requests_log_event
  after insert or update on public.ride_requests
  for each row execute function public.log_ride_event();

-- ============ reviews（乗車後の相互評価・報告）============
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  ride_request_id uuid not null references public.ride_requests(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating text not null check (rating in ('good','problem')),
  comment text,
  created_at timestamptz not null default now(),
  unique (ride_request_id, reviewer_id)
);

alter table public.reviews enable row level security;
grant select, insert on public.reviews to authenticated;

-- 完了済みの乗車の当事者だけが自分名義で投稿できる
create policy "reviews_insert_participant" on public.reviews
  for insert with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.ride_requests r
      where r.id = ride_request_id
        and r.status = 'completed'
        and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
    )
  );

-- 本人（書いた/書かれた）とコミュニティ主催者が閲覧可（問題報告の把握→停止判断につなげる）
create policy "reviews_select_involved" on public.reviews
  for select using (
    reviewer_id = auth.uid()
    or reviewee_id = auth.uid()
    or exists (
      select 1 from public.ride_requests r
      where r.id = ride_request_id and public.is_community_owner(r.community_id)
    )
  );

-- ============ 見守り・成立プッシュ通知（AFTER UPDATE）============
create or replace function public.notify_on_ride_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rider_name text;
  v_driver_name text;
  v_msgs jsonb;
begin
  if new.status = old.status then return new; end if;
  select full_name into v_rider_name from public.profiles where id = new.rider_id;
  select full_name into v_driver_name from public.profiles where id = new.driver_id;

  if new.status = 'matched' then
    -- 利用者本人 + 見守り家族へ
    select jsonb_agg(jsonb_build_object(
             'to', t.token,
             'title', 'のりあわせ：乗合が成立しました',
             'body', coalesce(v_rider_name,'利用者') || 'さんを ' || coalesce(v_driver_name,'ドライバー')
                     || 'さんが乗せます（' || new.origin_text || ' → ' || new.destination_text || '）',
             'data', jsonb_build_object('requestId', new.id)
           ))
      into v_msgs
    from public.push_tokens t
    where t.user_id = new.rider_id
       or t.user_id in (select w.watcher_user_id from public.watchers w where w.user_id = new.rider_id);
  elsif new.status = 'completed' then
    -- 見守り家族へ
    select jsonb_agg(jsonb_build_object(
             'to', t.token,
             'title', 'のりあわせ：到着しました',
             'body', coalesce(v_rider_name,'利用者') || 'さんの乗合が完了しました（'
                     || new.origin_text || ' → ' || new.destination_text || '）',
             'data', jsonb_build_object('requestId', new.id)
           ))
      into v_msgs
    from public.push_tokens t
    where t.user_id in (select w.watcher_user_id from public.watchers w where w.user_id = new.rider_id);
  end if;

  if v_msgs is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_msgs
    );
  end if;
  return new;
end;
$$;

create trigger ride_requests_notify_after_update
  after update on public.ride_requests
  for each row execute function public.notify_on_ride_update();
