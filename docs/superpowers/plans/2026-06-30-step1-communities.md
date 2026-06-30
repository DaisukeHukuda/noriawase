# STEP 1: コミュニティ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「のりあわせ」に**コミュニティ**を実装する — 作成（作成者=主催者）、招待コードでの参加申請→主催者の承認/却下、メンバー管理（申請中/承認済み/停止）、ドライバー登録（車種・ナンバー・任意保険の確認）。

**Architecture:** 新規テーブル `communities` / `community_memberships` を追加。コミュニティの作成・参加は **SECURITY DEFINER の RPC 関数**（`create_community` / `join_community_by_code`）で行い、RLS の相互再帰を避けつつ「招待コードを知る人だけが参加申請できる」を実現する。可視範囲は `is_community_owner` / `is_community_member` という SECURITY DEFINER ヘルパ関数で判定（テーブル相互参照による無限再帰を回避）。クライアントは STEP 0 と同じく「Supabaseクライアントを引数注入する純粋なAPI関数」で構成しモック単体テストする。バリデーション等は純粋関数で TDD。マッチング機能は STEP 2 のため含めない。

**Tech Stack:** Expo SDK 56 / React Native / TypeScript、expo-router、Supabase（`@supabase/supabase-js`、Postgres RLS + RPC）、Jest + jest-expo。

> 設計: [docs/superpowers/specs/2026-06-29-noriawase-design.md](../specs/2026-06-29-noriawase-design.md)
> STEP 0 完了済み資産（再利用）: `AuthProvider`/`useAuth`、`supabase` クライアント、`profiles`/`driver_profiles` テーブル + RLS + `set_updated_at()` 関数、`profileApi`、Jest 環境、`tsconfig` の `types:["jest"]`。

---

## 前提・設計上の決定（MVP）

- **コミュニティ作成**: ログインユーザーは誰でも作成でき、作成者が `owner`。作成時に8文字の招待コードを自動採番し、owner 自身の承認済みメンバー行も自動作成。
- **参加**: 招待コードを入力 → `pending`（申請中）のメンバー行が作られる → 主催者が `approved`（承認）または却下（行を削除）。
- **メンバー状態**: `pending` / `approved` / `suspended`（停止）。`role` は `owner` / `member`。
- **却下** = pending 行の削除（再申請可能にするため）。**停止** = approved → suspended の更新。**復帰** = suspended → approved。
- **ドライバー登録**: 既存 `driver_profiles` に `vehicle_model` / `license_plate` / `insurance_confirmed` を upsert し、`profiles.is_driver` を true に。
- **マッチングは STEP 2**（このSTEPには含めない）。

---

## ファイル構成（作成/変更）

```
supabase/migrations/
  0002_communities.sql          # 新規: communities / community_memberships + RLS + RPC

src/features/community/
  types.ts                      # Community / CommunityMembership / 状態・役割の型
  validation.ts                 # validateCommunityName / normalizeInviteCode（純粋・TDD）
  validation.test.ts
  communityApi.ts               # createCommunity / joinByCode / getCommunity / listMyCommunities
  communityApi.test.ts
  membershipApi.ts              # listMemberships / setMembershipStatus / removeMembership
  membershipApi.test.ts

src/features/driver/
  driverApi.ts                  # getDriverProfile / saveDriverProfile（is_driver も更新）
  driverApi.test.ts

app/(app)/
  communities/
    index.tsx                   # 自分のコミュニティ一覧 + 作成/参加への導線
    create.tsx                  # 作成フォーム → 招待コード表示
    join.tsx                    # 招待コード入力 → 申請
    [id].tsx                    # 詳細 + （主催者なら）メンバー管理
  driver/
    register.tsx                # ドライバー登録フォーム
  profile.tsx                   # 変更: コミュニティ/ドライバー登録への導線を追加
```

責務分離: 画面は表示と入力収集のみ、ロジックは `src/features/*` の関数を呼ぶ。コミュニティ系とドライバー系は別 feature ディレクトリ。

---

## Task 1: DBマイグレーション（communities / memberships + RLS + RPC）

**Files:**
- Create: `supabase/migrations/0002_communities.sql`

> Step 2 のSQL適用は**人手**（Supabase SQL Editor）。実装サブエージェントはファイル作成とコミットのみ行い、DBへは接続しない。

- [ ] **Step 1: マイグレーションSQLを作成**

Create `supabase/migrations/0002_communities.sql` with EXACTLY:
```sql
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

-- communities: 主催者か（申請中/承認済み）メンバーだけ閲覧。更新は主催者のみ。作成はRPC経由（insertポリシー無し）。
create policy "communities_select_visible" on public.communities
  for select using (public.is_community_owner(id) or public.is_community_member(id));
create policy "communities_update_owner" on public.communities
  for update using (public.is_community_owner(id)) with check (public.is_community_owner(id));

-- memberships: 自分の行 or その community の主催者が閲覧。承認/停止=update、却下=delete は主催者のみ。
-- 参加・owner行の作成はRPC経由（insertポリシー無し）。
create policy "memberships_select_self_or_owner" on public.community_memberships
  for select using (user_id = auth.uid() or public.is_community_owner(community_id));
create policy "memberships_update_owner" on public.community_memberships
  for update using (public.is_community_owner(community_id)) with check (public.is_community_owner(community_id));
create policy "memberships_delete_owner" on public.community_memberships
  for delete using (public.is_community_owner(community_id));

-- ============ RPC: コミュニティ作成（コード採番 + owner行作成を原子的に）============
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

-- ============ updated_at トリガ（STEP 0 の set_updated_at を再利用）============
create trigger communities_set_updated_at
  before update on public.communities
  for each row execute function public.set_updated_at();

create trigger community_memberships_set_updated_at
  before update on public.community_memberships
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: （人手）Supabase に適用**

Supabase ダッシュボード → SQL Editor に `0002_communities.sql` を貼って Run。Expected: `Success. No rows returned`。
（このステップは人手。実装者はここで停止し、適用完了を待つ。）

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/0002_communities.sql
git commit -m "feat: add communities & memberships schema with RLS and RPC"
```

---

## Task 2: バリデーション純粋関数（TDD）

**Files:**
- Test: `src/features/community/validation.test.ts`
- Create: `src/features/community/validation.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/community/validation.test.ts`:
```ts
import { validateCommunityName, normalizeInviteCode } from './validation';

describe('validateCommunityName', () => {
  test('2文字以上ならOK', () => {
    expect(validateCommunityName('日光FC')).toEqual({ ok: true });
  });
  test('1文字以下はエラー', () => {
    const r = validateCommunityName(' a ');
    expect(r.ok).toBe(false);
  });
  test('50文字超はエラー', () => {
    const r = validateCommunityName('あ'.repeat(51));
    expect(r.ok).toBe(false);
  });
});

describe('normalizeInviteCode', () => {
  test('前後空白除去 + 大文字化', () => {
    expect(normalizeInviteCode('  abc123  ')).toBe('ABC123');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/community/validation.test.ts`
Expected: FAIL（`Cannot find module './validation'`）

- [ ] **Step 3: 実装**

Create `src/features/community/validation.ts`:
```ts
export type NameValidation = { ok: true } | { ok: false; error: string };

export function validateCommunityName(name: string): NameValidation {
  const n = name.trim();
  if (n.length < 2) return { ok: false, error: 'コミュニティ名は2文字以上にしてください' };
  if (n.length > 50) return { ok: false, error: 'コミュニティ名は50文字以内にしてください' };
  return { ok: true };
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/community/validation.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: コミット**

```bash
git add src/features/community/validation.ts src/features/community/validation.test.ts
git commit -m "feat: add community name validation & invite code normalization"
```

---

## Task 3: コミュニティ型 + API（作成/参加/取得/自分の一覧）

**Files:**
- Create: `src/features/community/types.ts`
- Test: `src/features/community/communityApi.test.ts`
- Create: `src/features/community/communityApi.ts`

- [ ] **Step 1: 型を作る**

Create `src/features/community/types.ts`:
```ts
export type MembershipStatus = 'pending' | 'approved' | 'suspended';
export type MembershipRole = 'owner' | 'member';

export type Community = {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type CommunityMembership = {
  id: string;
  community_id: string;
  user_id: string;
  status: MembershipStatus;
  role: MembershipRole;
  created_at: string;
  updated_at: string;
};

export type MyCommunity = {
  status: MembershipStatus;
  role: MembershipRole;
  community: Community;
};
```

- [ ] **Step 2: 失敗するテストを書く（モッククライアント）**

Create `src/features/community/communityApi.test.ts`:
```ts
import { createCommunity, joinByCode, getCommunity, listMyCommunities } from './communityApi';
import type { Community } from './types';

const sample: Community = {
  id: 'c1', name: '日光FC', invite_code: 'ABCD1234',
  owner_id: 'u1', created_at: 't', updated_at: 't',
};

function mockRpc(result: { data: unknown; error: unknown }) {
  return { rpc: jest.fn().mockResolvedValue(result) } as any;
}

function mockFromSingle(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, eq };
}

function mockFromList(result: { data: unknown; error: unknown }) {
  const eq = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, eq };
}

describe('createCommunity', () => {
  test('rpc create_community を呼び Community を返す', async () => {
    const client = mockRpc({ data: sample, error: null });
    await expect(createCommunity(client, '日光FC')).resolves.toEqual(sample);
    expect(client.rpc).toHaveBeenCalledWith('create_community', { p_name: '日光FC' });
  });
  test('error は throw', async () => {
    const client = mockRpc({ data: null, error: { message: 'x' } });
    await expect(createCommunity(client, '日光FC')).rejects.toBeDefined();
  });
});

describe('joinByCode', () => {
  test('rpc join_community_by_code を呼ぶ', async () => {
    const client = mockRpc({ data: sample, error: null });
    await expect(joinByCode(client, 'abcd1234')).resolves.toEqual(sample);
    expect(client.rpc).toHaveBeenCalledWith('join_community_by_code', { p_code: 'abcd1234' });
  });
});

describe('getCommunity', () => {
  test('communities を1件取得', async () => {
    const { client, from } = mockFromSingle({ data: sample, error: null });
    await expect(getCommunity(client, 'c1')).resolves.toEqual(sample);
    expect(from).toHaveBeenCalledWith('communities');
  });
});

describe('listMyCommunities', () => {
  test('memberships を user_id で引き community を埋め込んで返す', async () => {
    const rows = [{ status: 'approved', role: 'owner', community: sample }];
    const { client, from } = mockFromList({ data: rows, error: null });
    const res = await listMyCommunities(client, 'u1');
    expect(from).toHaveBeenCalledWith('community_memberships');
    expect(res).toEqual([{ status: 'approved', role: 'owner', community: sample }]);
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- src/features/community/communityApi.test.ts`
Expected: FAIL（`Cannot find module './communityApi'`）

- [ ] **Step 4: 実装**

Create `src/features/community/communityApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Community, MyCommunity } from './types';

export async function createCommunity(
  client: SupabaseClient,
  name: string,
): Promise<Community> {
  const { data, error } = await client.rpc('create_community', { p_name: name });
  if (error) throw error;
  return data as Community;
}

export async function joinByCode(
  client: SupabaseClient,
  code: string,
): Promise<Community> {
  const { data, error } = await client.rpc('join_community_by_code', { p_code: code });
  if (error) throw error;
  return data as Community;
}

export async function getCommunity(
  client: SupabaseClient,
  id: string,
): Promise<Community> {
  const { data, error } = await client
    .from('communities')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Community;
}

export async function listMyCommunities(
  client: SupabaseClient,
  userId: string,
): Promise<MyCommunity[]> {
  const { data, error } = await client
    .from('community_memberships')
    .select('status, role, community:communities(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    status: r.status,
    role: r.role,
    community: r.community,
  })) as MyCommunity[];
}
```

- [ ] **Step 5: 成功を確認**

Run: `npm test -- src/features/community/communityApi.test.ts` → PASS（5 passed）
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 6: コミット**

```bash
git add src/features/community/types.ts src/features/community/communityApi.ts src/features/community/communityApi.test.ts
git commit -m "feat: add community types and create/join/get/list API"
```

---

## Task 4: メンバー管理API（一覧/状態変更/削除）

**Files:**
- Test: `src/features/community/membershipApi.test.ts`
- Create: `src/features/community/membershipApi.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/community/membershipApi.test.ts`:
```ts
import {
  listMemberships,
  setMembershipStatus,
  removeMembership,
} from './membershipApi';

describe('listMemberships', () => {
  test('community_id で引き profile を埋め込む', async () => {
    const rows = [
      { id: 'm1', community_id: 'c1', user_id: 'u2', status: 'pending', role: 'member',
        created_at: 't', updated_at: 't', profile: { full_name: '田中花子' } },
    ];
    const order = jest.fn().mockResolvedValue({ data: rows, error: null });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    const res = await listMemberships(client, 'c1');
    expect(from).toHaveBeenCalledWith('community_memberships');
    expect(res).toEqual(rows);
  });
});

describe('setMembershipStatus', () => {
  test('update().eq() を呼ぶ', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ update });
    const client = { from } as any;
    await setMembershipStatus(client, 'm1', 'approved');
    expect(update).toHaveBeenCalledWith({ status: 'approved' });
    expect(eq).toHaveBeenCalledWith('id', 'm1');
  });
  test('error は throw', async () => {
    const eq = jest.fn().mockResolvedValue({ error: { message: 'x' } });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ update });
    const client = { from } as any;
    await expect(setMembershipStatus(client, 'm1', 'suspended')).rejects.toBeDefined();
  });
});

describe('removeMembership', () => {
  test('delete().eq() を呼ぶ', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ delete: del });
    const client = { from } as any;
    await removeMembership(client, 'm1');
    expect(eq).toHaveBeenCalledWith('id', 'm1');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/community/membershipApi.test.ts`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装**

Create `src/features/community/membershipApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommunityMembership, MembershipStatus } from './types';

export type MembershipWithProfile = CommunityMembership & {
  profile: { full_name: string } | null;
};

export async function listMemberships(
  client: SupabaseClient,
  communityId: string,
): Promise<MembershipWithProfile[]> {
  const { data, error } = await client
    .from('community_memberships')
    .select('*, profile:profiles(full_name)')
    .eq('community_id', communityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MembershipWithProfile[];
}

export async function setMembershipStatus(
  client: SupabaseClient,
  membershipId: string,
  status: MembershipStatus,
): Promise<void> {
  const { error } = await client
    .from('community_memberships')
    .update({ status })
    .eq('id', membershipId);
  if (error) throw error;
}

export async function removeMembership(
  client: SupabaseClient,
  membershipId: string,
): Promise<void> {
  const { error } = await client
    .from('community_memberships')
    .delete()
    .eq('id', membershipId);
  if (error) throw error;
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/community/membershipApi.test.ts` → PASS（4 passed）
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: コミット**

```bash
git add src/features/community/membershipApi.ts src/features/community/membershipApi.test.ts
git commit -m "feat: add membership list/status/remove API"
```

---

## Task 5: ドライバー登録API（取得/保存）

**Files:**
- Test: `src/features/driver/driverApi.test.ts`
- Create: `src/features/driver/driverApi.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/driver/driverApi.test.ts`:
```ts
import { getDriverProfile, saveDriverProfile } from './driverApi';

describe('getDriverProfile', () => {
  test('行が無ければ null', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    await expect(getDriverProfile(client, 'u1')).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('driver_profiles');
  });
});

describe('saveDriverProfile', () => {
  test('driver_profiles を upsert し profiles.is_driver を true に更新', async () => {
    const saved = {
      id: 'u1', vehicle_model: '軽トラ', license_plate: '宇都宮 480 あ 12-34',
      insurance_confirmed: true,
    };
    // driver_profiles upsert chain
    const dpSingle = jest.fn().mockResolvedValue({ data: saved, error: null });
    const dpSelect = jest.fn().mockReturnValue({ single: dpSingle });
    const upsert = jest.fn().mockReturnValue({ select: dpSelect });
    // profiles update chain
    const pEq = jest.fn().mockResolvedValue({ error: null });
    const pUpdate = jest.fn().mockReturnValue({ eq: pEq });
    const from = jest.fn().mockImplementation((table: string) => {
      if (table === 'driver_profiles') return { upsert };
      if (table === 'profiles') return { update: pUpdate };
      throw new Error('unexpected table ' + table);
    });
    const client = { from } as any;
    const res = await saveDriverProfile(client, 'u1', {
      vehicleModel: '軽トラ',
      licensePlate: '宇都宮 480 あ 12-34',
      insuranceConfirmed: true,
    });
    expect(res).toEqual(saved);
    expect(upsert).toHaveBeenCalledWith({
      id: 'u1',
      vehicle_model: '軽トラ',
      license_plate: '宇都宮 480 あ 12-34',
      insurance_confirmed: true,
    });
    expect(pUpdate).toHaveBeenCalledWith({ is_driver: true });
    expect(pEq).toHaveBeenCalledWith('id', 'u1');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/driver/driverApi.test.ts`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装**

Create `src/features/driver/driverApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type DriverProfile = {
  id: string;
  vehicle_model: string | null;
  license_plate: string | null;
  insurance_confirmed: boolean;
};

export type DriverInput = {
  vehicleModel: string;
  licensePlate: string;
  insuranceConfirmed: boolean;
};

export async function getDriverProfile(
  client: SupabaseClient,
  userId: string,
): Promise<DriverProfile | null> {
  const { data, error } = await client
    .from('driver_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as DriverProfile) ?? null;
}

export async function saveDriverProfile(
  client: SupabaseClient,
  userId: string,
  input: DriverInput,
): Promise<DriverProfile> {
  const { data, error } = await client
    .from('driver_profiles')
    .upsert({
      id: userId,
      vehicle_model: input.vehicleModel,
      license_plate: input.licensePlate,
      insurance_confirmed: input.insuranceConfirmed,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: pErr } = await client
    .from('profiles')
    .update({ is_driver: true })
    .eq('id', userId);
  if (pErr) throw pErr;

  return data as DriverProfile;
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/driver/driverApi.test.ts` → PASS（2 passed）
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: コミット**

```bash
git add src/features/driver/driverApi.ts src/features/driver/driverApi.test.ts
git commit -m "feat: add driver profile get/save API"
```

---

## Task 6: コミュニティ 一覧 / 作成 / 参加 画面

**Files:**
- Create: `app/(app)/communities/index.tsx`
- Create: `app/(app)/communities/create.tsx`
- Create: `app/(app)/communities/join.tsx`

- [ ] **Step 1: 一覧画面**

Create `app/(app)/communities/index.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { listMyCommunities } from '../../../src/features/community/communityApi';
import type { MyCommunity } from '../../../src/features/community/types';

const STATUS_LABEL: Record<string, string> = {
  pending: '申請中',
  approved: '参加中',
  suspended: '停止中',
};

export default function CommunitiesIndex() {
  const { session } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<MyCommunity[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      setLoading(true);
      listMyCommunities(supabase, session.user.id)
        .then((rows) => { if (active) setItems(rows); })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>コミュニティ</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="作成" onPress={() => router.push('/(app)/communities/create')} />
        <Button title="参加" onPress={() => router.push('/(app)/communities/join')} />
      </View>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.community.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>まだコミュニティがありません</Text>}
          renderItem={({ item }) => (
            <Link href={`/(app)/communities/${item.community.id}`} asChild>
              <Text style={{ paddingVertical: 12, fontSize: 16 }}>
                {item.community.name}（{STATUS_LABEL[item.status] ?? item.status}
                {item.role === 'owner' ? '・主催者' : ''}）
              </Text>
            </Link>
          )}
        />
      )}
    </View>
  );
}
```

- [ ] **Step 2: 作成画面**

Create `app/(app)/communities/create.tsx`:
```tsx
import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { createCommunity } from '../../../src/features/community/communityApi';
import { validateCommunityName } from '../../../src/features/community/validation';
import type { Community } from '../../../src/features/community/types';

export default function CreateCommunity() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Community | null>(null);

  async function onCreate() {
    const v = validateCommunityName(name);
    if (!v.ok) { Alert.alert('入力エラー', v.error); return; }
    setBusy(true);
    try {
      const community = await createCommunity(supabase, name);
      setCreated(community);
    } catch (e) {
      Alert.alert('作成できませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>「{created.name}」を作成しました</Text>
        <Text>仲間に渡す招待コード：</Text>
        <Text selectable style={{ fontSize: 28, fontWeight: '700', letterSpacing: 2 }}>
          {created.invite_code}
        </Text>
        <Text style={{ color: '#86868b' }}>このコードを伝えると、相手は「参加」から申請できます。</Text>
        <Button title="コミュニティを開く" onPress={() => router.replace(`/(app)/communities/${created.id}`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>コミュニティを作成</Text>
      <Text>コミュニティ名（例：日光FCスポーツ少年団）</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="コミュニティ名"
        style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 }}
      />
      <Button title={busy ? '作成中…' : '作成する'} onPress={onCreate} disabled={busy} />
    </View>
  );
}
```

- [ ] **Step 3: 参加画面**

Create `app/(app)/communities/join.tsx`:
```tsx
import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { joinByCode } from '../../../src/features/community/communityApi';
import { normalizeInviteCode } from '../../../src/features/community/validation';

export default function JoinCommunity() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function onJoin() {
    const normalized = normalizeInviteCode(code);
    if (normalized.length < 4) { Alert.alert('入力エラー', '招待コードを入力してください'); return; }
    setBusy(true);
    try {
      const community = await joinByCode(supabase, normalized);
      Alert.alert('申請しました', `「${community.name}」への参加を申請しました。主催者の承認をお待ちください。`);
      router.replace('/(app)/communities');
    } catch (e) {
      Alert.alert('参加できませんでした', '招待コードを確認してください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>コミュニティに参加</Text>
      <Text>招待コード（主催者からもらったコード）</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="例: ABCD1234"
        style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12, letterSpacing: 2 }}
      />
      <Button title={busy ? '申請中…' : '参加を申請'} onPress={onJoin} disabled={busy} />
    </View>
  );
}
```

- [ ] **Step 4: 検証**

Run: `npx tsc --noEmit` → exit 0
Run: `npm test` → 全テスト緑（既存 + 本STEPの追加分）

- [ ] **Step 5: コミット**

```bash
git add "app/(app)/communities/index.tsx" "app/(app)/communities/create.tsx" "app/(app)/communities/join.tsx"
git commit -m "feat: add communities list / create / join screens"
```

---

## Task 7: コミュニティ詳細 + メンバー管理画面

**Files:**
- Create: `app/(app)/communities/[id].tsx`

- [ ] **Step 1: 詳細＋管理画面**

Create `app/(app)/communities/[id].tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { getCommunity } from '../../../src/features/community/communityApi';
import {
  listMemberships,
  setMembershipStatus,
  removeMembership,
  type MembershipWithProfile,
} from '../../../src/features/community/membershipApi';
import type { Community } from '../../../src/features/community/types';

export default function CommunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<MembershipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const isOwner = !!community && !!session && community.owner_id === session.user.id;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const c = await getCommunity(supabase, id);
      setCommunity(c);
      const m = await listMemberships(supabase, id);
      setMembers(m);
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('操作エラー', (e as Error).message);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!community) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>コミュニティが見つかりません</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>{community.name}</Text>
      {isOwner && (
        <Text>
          招待コード：<Text selectable style={{ fontWeight: '700', letterSpacing: 2 }}>{community.invite_code}</Text>
        </Text>
      )}
      <Text style={{ fontSize: 16, fontWeight: '600', marginTop: 8 }}>
        メンバー{isOwner ? '（主催者として管理）' : ''}
      </Text>
      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={<Text style={{ color: '#86868b' }}>メンバーはいません</Text>}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>
              {item.profile?.full_name ?? '（氏名未取得）'}
              {item.role === 'owner' ? '・主催者' : ''}（
              {item.status === 'pending' ? '申請中' : item.status === 'approved' ? '参加中' : '停止中'}）
            </Text>
            {isOwner && item.role !== 'owner' && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {item.status === 'pending' && (
                  <>
                    <Button title="承認" onPress={() => act(() => setMembershipStatus(supabase, item.id, 'approved'))} />
                    <Button title="却下" color="#ff3b30" onPress={() => act(() => removeMembership(supabase, item.id))} />
                  </>
                )}
                {item.status === 'approved' && (
                  <Button title="停止" color="#ff9f0a" onPress={() => act(() => setMembershipStatus(supabase, item.id, 'suspended'))} />
                )}
                {item.status === 'suspended' && (
                  <Button title="復帰" onPress={() => act(() => setMembershipStatus(supabase, item.id, 'approved'))} />
                )}
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 3: コミット**

```bash
git add "app/(app)/communities/[id].tsx"
git commit -m "feat: add community detail and member management screen"
```

---

## Task 8: ドライバー登録画面 + プロフィール導線

**Files:**
- Create: `app/(app)/driver/register.tsx`
- Modify: `app/(app)/profile.tsx`

- [ ] **Step 1: ドライバー登録画面**

Create `app/(app)/driver/register.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { getDriverProfile, saveDriverProfile } from '../../../src/features/driver/driverApi';

export default function DriverRegister() {
  const { session } = useAuth();
  const router = useRouter();
  const [vehicleModel, setVehicleModel] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [insurance, setInsurance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      setLoading(true);
      getDriverProfile(supabase, session.user.id)
        .then((d) => {
          if (!active || !d) return;
          setVehicleModel(d.vehicle_model ?? '');
          setLicensePlate(d.license_plate ?? '');
          setInsurance(d.insurance_confirmed);
        })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  async function onSave() {
    if (!session) return;
    if (vehicleModel.trim().length < 1 || licensePlate.trim().length < 1) {
      Alert.alert('入力エラー', '車種とナンバーを入力してください');
      return;
    }
    if (!insurance) {
      Alert.alert('確認', '安全のため、任意保険への加入確認が必要です');
      return;
    }
    setSaving(true);
    try {
      await saveDriverProfile(supabase, session.user.id, {
        vehicleModel: vehicleModel.trim(),
        licensePlate: licensePlate.trim(),
        insuranceConfirmed: insurance,
      });
      Alert.alert('登録しました', 'ドライバーとして登録されました');
      router.back();
    } catch (e) {
      Alert.alert('保存エラー', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>ドライバー登録</Text>
      <Text>車種</Text>
      <TextInput
        value={vehicleModel}
        onChangeText={setVehicleModel}
        placeholder="例: 軽トラック / プリウス"
        style={inputStyle}
      />
      <Text>ナンバー</Text>
      <TextInput
        value={licensePlate}
        onChangeText={setLicensePlate}
        placeholder="例: 宇都宮 480 あ 12-34"
        style={inputStyle}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <Switch value={insurance} onValueChange={setInsurance} />
        <Text style={{ flex: 1 }}>任意保険に加入していることを確認しました</Text>
      </View>
      <Button title={saving ? '保存中…' : '登録する'} onPress={onSave} disabled={saving} />
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#d1d1d6',
  borderRadius: 8,
  padding: 12,
} as const;
```

- [ ] **Step 2: プロフィール画面に導線を追加**

In `app/(app)/profile.tsx`, add a `useRouter` import and navigation buttons. Change the import line:
```tsx
import { useEffect, useState } from 'react';
```
to:
```tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
```
Then, inside `ProfileScreen`, add the router right after the `useAuth()` line:
```tsx
  const router = useRouter();
```
Then REPLACE this block:
```tsx
      <Text style={{ color: '#86868b' }}>
        ドライバー登録: {profile?.is_driver ? '済み' : '未（STEP 1 で対応）'}
      </Text>
      <Button title={saving ? '保存中…' : '保存'} onPress={onSave} disabled={saving} />
      <View style={{ height: 12 }} />
      <Button title="ログアウト" color="#ff3b30" onPress={signOut} />
```
with:
```tsx
      <Button title={saving ? '保存中…' : '保存'} onPress={onSave} disabled={saving} />

      <View style={{ height: 16 }} />
      <Button title="コミュニティ" onPress={() => router.push('/(app)/communities')} />
      <View style={{ height: 8 }} />
      <Button
        title={profile?.is_driver ? 'ドライバー情報を編集' : 'ドライバー登録'}
        onPress={() => router.push('/(app)/driver/register')}
      />

      <View style={{ height: 16 }} />
      <Button title="ログアウト" color="#ff3b30" onPress={signOut} />
```

- [ ] **Step 3: 検証**

Run: `npx tsc --noEmit` → exit 0
Run: `npm test` → 全テスト緑

- [ ] **Step 4: コミット**

```bash
git add "app/(app)/driver/register.tsx" "app/(app)/profile.tsx"
git commit -m "feat: add driver registration screen and profile navigation"
```

---

## Task 9: 総合検証（テスト・型・バックエンド一気通貫）

**Files:** （コード変更なし。検証のみ）

- [ ] **Step 1: 全テスト + 型チェック**

Run: `npm test` → 全 suite 緑
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 2: （人手 or コントローラ）バックエンド一気通貫の確認**

`0002_communities.sql` を適用済みの本番Supabaseに対し、ログイン済みクライアントで以下を確認（STEP 0 と同様の使い捨てユーザーで可。コントローラ=Opus がヘッドレス検証してよい）:
1. `create_community('テスト会')` → community が返り、`invite_code` が付与される。
2. 別ユーザーで `join_community_by_code(code)` → `pending` メンバー行ができる。
3. 主催者で `listMemberships(communityId)` → pending の申請者が見える。
4. 主催者で `setMembershipStatus(membershipId,'approved')` → `approved` に。
5. 申請者で `listMyCommunities(uid)` → 当該コミュニティが `approved` で見える。
6. RLS: 無関係な第三者ユーザーからは当該 community / memberships が**見えない**こと。
7. `saveDriverProfile` → `driver_profiles` が upsert され `profiles.is_driver=true`。

Expected: 1〜7 すべて期待どおり（特に6のRLSで他人のコミュニティが漏れないこと）。

- [ ] **Step 3: 最終コミット（あれば）/ ブランチ完了**

検証で問題なければ STEP 1 ブランチを完了（finishing-a-development-branch）。

---

## Self-Review（計画作成者チェック）

- **Spec カバレッジ**: ①作成=Task1(RPC)+Task3(API)+Task6(画面)、②コード参加→承認/却下=Task1(RPC/RLS)+Task3/4(API)+Task6/7(画面)、③メンバー管理(状態)=Task4+Task7、④ドライバー登録=Task5+Task8。マッチングはSTEP 2のため除外（正しい）。
- **プレースホルダ**: 各コード手順に実コードを記載。曖昧表現なし。
- **型整合**: `Community`/`CommunityMembership`/`MembershipStatus`/`MyCommunity`(types.ts) → communityApi/membershipApi/画面で一致。`MembershipWithProfile`(membershipApi.ts) は `[id].tsx` で import。`DriverInput`/`DriverProfile`(driverApi.ts) は register 画面で使用。RPC 引数名 `p_name`/`p_code` は Task1 のSQL関数と Task3 のAPIで一致。`setMembershipStatus` の引数順（client, id, status）は Task4 定義と Task7 使用で一致。
- **RLS再帰**: communities と memberships のポリシーが相互参照するが、判定を SECURITY DEFINER 関数（is_community_owner / is_community_member）に逃がして無限再帰を回避。作成・参加・owner行作成は SECURITY DEFINER RPC 経由（直接 insert ポリシー無し＝安全）。
- **既知の前提**: `set_updated_at()` と `gen_random_uuid()` は STEP 0 / Postgres 既存。`driver_profiles` は STEP 0 で作成済み・RLS/grant 済みのため Task5 は upsert のみ。

## 留意点（実装担当向け）
- Task 1 Step 2（SQL適用）は人手。実装サブエージェントはファイル作成＋コミットで停止し、適用完了を待つ。
- 埋め込みselect（`communities(*)` / `profiles(full_name)`）はモックが煩雑なため単体テストは簡易。実挙動は Task 9 のバックエンド検証で担保する。
- 画面の検証は `tsc --noEmit`。実機UI操作は任意（STEP 0 同様、関数層は検証済み）。
