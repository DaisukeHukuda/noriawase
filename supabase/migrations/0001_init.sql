-- profiles: auth.users 1件につき1行
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  is_driver boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- driver_profiles: ドライバーの追加情報
create table public.driver_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  vehicle_model text,
  license_plate text,
  insurance_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS 有効化
alter table public.profiles enable row level security;
alter table public.driver_profiles enable row level security;

-- テーブルアクセス権限（プロジェクト作成時に新規テーブル自動公開をOFFにしているため明示付与）
-- ログイン済みユーザーのみ。実際に見える行は上記 RLS で「自分の行」に限定される。
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.driver_profiles to authenticated;

-- 自分の profile のみ
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 自分の driver_profile のみ
create policy "driver_select_own" on public.driver_profiles
  for select using (auth.uid() = id);
create policy "driver_insert_own" on public.driver_profiles
  for insert with check (auth.uid() = id);
create policy "driver_update_own" on public.driver_profiles
  for update using (auth.uid() = id);

-- サインアップ時に profiles 行を自動作成（full_name はメタデータから）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger driver_profiles_set_updated_at
  before update on public.driver_profiles
  for each row execute function public.set_updated_at();
