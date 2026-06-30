# STEP 2: マッチングの心臓 + プッシュ通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コミュニティ内で利用者が「乗せて」リクエストを出し、同じコミュニティの承認済みドライバーに（プッシュ通知＋アプリ内一覧で）届き、ドライバーが応答して**乗合が成立**するまでを実装する。

**Architecture:** `ride_requests` テーブルを追加。閲覧/作成は「承認済みメンバー」に限定するRLS、応答（成立）は競合に強い **SECURITY DEFINER RPC `accept_ride_request`**（`open`→`matched` を原子的に）で行う。プッシュ通知は **`pg_net` 拡張 + AFTER INSERT トリガ**から Expo Push API を直接叩く（Edge Function/CLI 不要・ベストエフォート）。アプリ内一覧が確実な経路、プッシュはその上乗せ。クライアントは従来同様「Supabaseクライアント注入の純粋API関数」でモック単体テスト、ロジックはTDD、画面は tsc 検証。

**Tech Stack:** Expo SDK 56 / React Native / TypeScript、expo-router、expo-notifications、Supabase（Postgres RLS + RPC + pg_net）、Jest + jest-expo。

> 設計: [docs/superpowers/specs/2026-06-29-noriawase-design.md](../specs/2026-06-29-noriawase-design.md)
> STEP 0/1 完了済み資産（再利用）: `AuthProvider`/`useAuth`、`supabase`、`profiles`/`driver_profiles`/`communities`/`community_memberships`、RLSヘルパ `is_community_owner`/`is_community_member`/`shares_community`、`set_updated_at()`、各 feature API、Jest 環境。

---

## 前提・設計上の決定（MVP）

- **リクエスト**: 承認済みメンバーが、自分が属するコミュニティに対して「希望日時・出発地・目的地・メモ」で作成。状態は `open`/`matched`/`completed`/`cancelled`。
- **成立**: ドライバー（`is_driver` かつ承認済みメンバー）が `accept_ride_request` RPC で応答。`open` の時だけ成立し `matched` に（先着・競合安全）。
- **キャンセル/完了**: rider 本人 or 割当 driver が直接 update（RLSで本人/担当に限定）。
- **プッシュ通知**: `pg_net` + INSERT トリガで Expo Push API を叩く。コミュニティの承認済みドライバーのトークン宛。**ベストエフォート**（失敗してもリクエスト作成は成功し、アプリ内一覧で確認できる）。
- **希望日時**: MVP は `YYYY-MM-DD HH:MM` のテキスト入力を純粋関数 `parseDepartAt` で ISO に変換（日時ピッカー依存を避ける。将来差し替え）。
- **コミュニティ選択UI不要**: リクエスト作成はコミュニティ詳細から `communityId` を渡して遷移するため、選択ピッカーは持たない。

## 人手前提（コード実装とは別に必要）

- **0003 SQL の適用**（SQL Editor、Task 1）。`pg_net` 拡張の有効化を含む。
- **プッシュ実機テスト**: Expo Go ではこのSDKのリモート通知が動かないため、**dev build** が必要（`npx expo install expo-notifications` 済みのうえ EAS もしくはローカルでビルド）。アプリ内一覧での成立確認は dev build 無しでも可能。EAS の `projectId` が無い間、プッシュトークン登録は失敗してもアプリは落ちない（ベストエフォート）。

---

## ファイル構成（作成/変更）

```
supabase/migrations/
  0003_ride_requests.sql          # 新規: ride_requests, push_tokens, helper, accept RPC, pg_net 通知トリガ

src/features/ride/
  types.ts                        # RideRequest / RideStatus
  validation.ts                   # parseDepartAt / validateRideText（純粋・TDD）
  validation.test.ts
  rideRequestApi.ts               # create/get/listMine/listOpen/accept/cancel/complete
  rideRequestApi.test.ts

src/features/notifications/
  registerPushToken.ts            # savePushToken（純粋API・TDD）
  registerPushToken.test.ts
  usePushRegistration.ts          # expo-notifications で権限→token取得→保存（フック）

app/(app)/
  _layout.tsx                     # 変更: usePushRegistration() を呼ぶ
  requests/
    create.tsx                    # 「乗せて」作成（communityId パラメータ）
    index.tsx                     # ドライバー向け：募集中一覧（自分のコミュニティ）
    mine.tsx                      # 自分のリクエスト一覧
    [id].tsx                      # 詳細＋操作（accept/cancel/complete）
  communities/[id].tsx            # 変更: 承認済みメンバーに「乗せてと頼む」導線
  profile.tsx                     # 変更: 「乗合をさがす」「自分のリクエスト」導線
app.json                          # 変更: expo-notifications プラグイン
```

---

## Task 1: DBマイグレーション（ride_requests / push_tokens / RPC / 通知トリガ）

**Files:**
- Create: `supabase/migrations/0003_ride_requests.sql`

> Step 2 のSQL適用は人手。実装サブエージェントはファイル作成＋コミットのみ。DBへ接続しない。

- [ ] **Step 1: マイグレーションSQLを作成**

Create `supabase/migrations/0003_ride_requests.sql` with EXACTLY:
```sql
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

-- ============ ヘルパ（承認済みメンバー判定。SECURITY DEFINERで再帰回避）============
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

-- rider本人 or 割当済みdriver のみ更新可（キャンセル/完了）。成立(accept)はRPC経由。
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
```

- [ ] **Step 2: （人手）適用**

SQL Editor に貼って Run。`create extension if not exists pg_net;` を含むので、pg_net が有効化される。Expected: `Success. No rows returned`。

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/0003_ride_requests.sql
git commit -m "feat: add ride_requests, push_tokens, accept RPC, push trigger"
```

---

## Task 2: ライド型 + 入力バリデーション（TDD）

**Files:**
- Create: `src/features/ride/types.ts`
- Test: `src/features/ride/validation.test.ts`
- Create: `src/features/ride/validation.ts`

- [ ] **Step 1: 型を作る**

Create `src/features/ride/types.ts`:
```ts
export type RideStatus = 'open' | 'matched' | 'completed' | 'cancelled';

export type RideRequest = {
  id: string;
  community_id: string;
  rider_id: string;
  depart_at: string;
  origin_text: string;
  destination_text: string;
  note: string | null;
  status: RideStatus;
  driver_id: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: 失敗するテストを書く**

Create `src/features/ride/validation.test.ts`:
```ts
import { parseDepartAt, validateRideText } from './validation';

describe('parseDepartAt', () => {
  test('YYYY-MM-DD HH:MM を ISO に変換', () => {
    const r = parseDepartAt('2026-07-01 09:30');
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.iso).toBe('string');
  });
  test('不正な形式はエラー', () => {
    const r = parseDepartAt('あした');
    expect(r.ok).toBe(false);
  });
  test('空はエラー', () => {
    const r = parseDepartAt('   ');
    expect(r.ok).toBe(false);
  });
});

describe('validateRideText', () => {
  test('出発地・目的地が両方あればOK', () => {
    expect(validateRideText('自宅', '日光総合体育館')).toEqual({ ok: true });
  });
  test('どちらか空ならエラー', () => {
    expect(validateRideText('自宅', '  ').ok).toBe(false);
    expect(validateRideText('', '体育館').ok).toBe(false);
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- src/features/ride/validation.test.ts`
Expected: FAIL（モジュール無し）

- [ ] **Step 4: 実装**

Create `src/features/ride/validation.ts`:
```ts
export type ParseResult = { ok: true; iso: string } | { ok: false; error: string };
export type TextValidation = { ok: true } | { ok: false; error: string };

// "YYYY-MM-DD HH:MM" をローカル日時として解釈し ISO 文字列にする
export function parseDepartAt(input: string): ParseResult {
  const s = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(s)) {
    return { ok: false, error: '日時は「2026-07-01 09:30」の形式で入力してください' };
  }
  const date = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: '日時の値が正しくありません' };
  }
  return { ok: true, iso: date.toISOString() };
}

export function validateRideText(origin: string, destination: string): TextValidation {
  if (origin.trim().length < 1) return { ok: false, error: '出発地を入力してください' };
  if (destination.trim().length < 1) return { ok: false, error: '目的地を入力してください' };
  return { ok: true };
}
```

- [ ] **Step 5: 成功を確認**

Run: `npm test -- src/features/ride/validation.test.ts` → PASS（5 passed）

- [ ] **Step 6: コミット**

```bash
git add src/features/ride/types.ts src/features/ride/validation.ts src/features/ride/validation.test.ts
git commit -m "feat: add ride types and depart-time/text validation"
```

---

## Task 3: ライドリクエストAPI（作成/取得/一覧/応答/キャンセル/完了）

**Files:**
- Test: `src/features/ride/rideRequestApi.test.ts`
- Create: `src/features/ride/rideRequestApi.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/ride/rideRequestApi.test.ts`:
```ts
import {
  createRequest, acceptRequest, cancelRequest, completeRequest,
  getRequest, listMyRequests, listOpenRequests,
} from './rideRequestApi';
import type { RideRequest } from './types';

const sample: RideRequest = {
  id: 'r1', community_id: 'c1', rider_id: 'u1',
  depart_at: '2026-07-01T00:30:00.000Z', origin_text: '自宅', destination_text: '体育館',
  note: null, status: 'open', driver_id: null, created_at: 't', updated_at: 't',
};

function rpcClient(result: { data: unknown; error: unknown }) {
  return { rpc: jest.fn().mockResolvedValue(result) } as any;
}
function insertClient(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  const from = jest.fn().mockReturnValue({ insert });
  return { client: { from } as any, from, insert };
}
function selectSingleClient(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from };
}
function selectListClient(result: { data: unknown; error: unknown }) {
  const order = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select };
}
function updateClient(result: { error: unknown }) {
  const eq = jest.fn().mockResolvedValue(result);
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ update });
  return { client: { from } as any, update, eq };
}

describe('createRequest', () => {
  test('ride_requests に insert して返す', async () => {
    const { client, from } = insertClient({ data: sample, error: null });
    const res = await createRequest(client, 'u1', {
      communityId: 'c1', departAt: sample.depart_at, originText: '自宅', destinationText: '体育館',
    });
    expect(from).toHaveBeenCalledWith('ride_requests');
    expect(res).toEqual(sample);
  });
});

describe('acceptRequest', () => {
  test('rpc accept_ride_request を呼ぶ', async () => {
    const client = rpcClient({ data: { ...sample, status: 'matched', driver_id: 'd1' }, error: null });
    const res = await acceptRequest(client, 'r1');
    expect(client.rpc).toHaveBeenCalledWith('accept_ride_request', { p_request: 'r1' });
    expect(res.status).toBe('matched');
  });
  test('error は throw', async () => {
    const client = rpcClient({ data: null, error: { message: 'x' } });
    await expect(acceptRequest(client, 'r1')).rejects.toBeDefined();
  });
});

describe('cancel/complete', () => {
  test('cancelRequest は status=cancelled で update', async () => {
    const { client, update, eq } = updateClient({ error: null });
    await cancelRequest(client, 'r1');
    expect(update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(eq).toHaveBeenCalledWith('id', 'r1');
  });
  test('completeRequest は status=completed で update', async () => {
    const { client, update } = updateClient({ error: null });
    await completeRequest(client, 'r1');
    expect(update).toHaveBeenCalledWith({ status: 'completed' });
  });
});

describe('getRequest', () => {
  test('1件取得', async () => {
    const { client, from } = selectSingleClient({ data: sample, error: null });
    await expect(getRequest(client, 'r1')).resolves.toEqual(sample);
    expect(from).toHaveBeenCalledWith('ride_requests');
  });
});

describe('listMyRequests / listOpenRequests', () => {
  test('listMyRequests は rider_id で引く', async () => {
    const { client, from } = selectListClient({ data: [sample], error: null });
    await expect(listMyRequests(client, 'u1')).resolves.toEqual([sample]);
    expect(from).toHaveBeenCalledWith('ride_requests');
  });
  test('listOpenRequests は status=open で引く', async () => {
    const { client, from } = selectListClient({ data: [sample], error: null });
    await expect(listOpenRequests(client)).resolves.toEqual([sample]);
    expect(from).toHaveBeenCalledWith('ride_requests');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/ride/rideRequestApi.test.ts`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装**

Create `src/features/ride/rideRequestApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RideRequest } from './types';

export type CreateRideInput = {
  communityId: string;
  departAt: string; // ISO
  originText: string;
  destinationText: string;
  note?: string;
};

export async function createRequest(
  client: SupabaseClient,
  riderId: string,
  input: CreateRideInput,
): Promise<RideRequest> {
  const { data, error } = await client
    .from('ride_requests')
    .insert({
      community_id: input.communityId,
      rider_id: riderId,
      depart_at: input.departAt,
      origin_text: input.originText,
      destination_text: input.destinationText,
      note: input.note ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RideRequest;
}

export async function acceptRequest(
  client: SupabaseClient,
  requestId: string,
): Promise<RideRequest> {
  const { data, error } = await client.rpc('accept_ride_request', { p_request: requestId });
  if (error) throw error;
  return data as RideRequest;
}

export async function cancelRequest(client: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await client.from('ride_requests').update({ status: 'cancelled' }).eq('id', requestId);
  if (error) throw error;
}

export async function completeRequest(client: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await client.from('ride_requests').update({ status: 'completed' }).eq('id', requestId);
  if (error) throw error;
}

export async function getRequest(client: SupabaseClient, id: string): Promise<RideRequest> {
  const { data, error } = await client.from('ride_requests').select('*').eq('id', id).single();
  if (error) throw error;
  return data as RideRequest;
}

export async function listMyRequests(
  client: SupabaseClient,
  riderId: string,
): Promise<RideRequest[]> {
  const { data, error } = await client
    .from('ride_requests')
    .select('*')
    .eq('rider_id', riderId)
    .order('depart_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RideRequest[];
}

// RLS により「自分が承認済みメンバーのコミュニティ」の open のみ返る
export async function listOpenRequests(client: SupabaseClient): Promise<RideRequest[]> {
  const { data, error } = await client
    .from('ride_requests')
    .select('*')
    .eq('status', 'open')
    .order('depart_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RideRequest[];
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/ride/rideRequestApi.test.ts` → PASS（9 passed）
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: コミット**

```bash
git add src/features/ride/rideRequestApi.ts src/features/ride/rideRequestApi.test.ts
git commit -m "feat: add ride request API (create/accept/cancel/complete/list)"
```

---

## Task 4: プッシュトークン保存 + expo-notifications 登録フック

**Files:**
- Test: `src/features/notifications/registerPushToken.test.ts`
- Create: `src/features/notifications/registerPushToken.ts`
- Create: `src/features/notifications/usePushRegistration.ts`
- Modify: `app.json`（expo-notifications プラグイン）
- Modify: `app/(app)/_layout.tsx`（フック呼び出し）

- [ ] **Step 1: 失敗するテストを書く（保存API）**

Create `src/features/notifications/registerPushToken.test.ts`:
```ts
import { savePushToken } from './registerPushToken';

describe('savePushToken', () => {
  test('push_tokens に upsert する', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    const client = { from } as any;
    await savePushToken(client, 'u1', 'ExponentPushToken[abc]');
    expect(from).toHaveBeenCalledWith('push_tokens');
    expect(upsert).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]', user_id: 'u1' });
  });
  test('error は throw', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: { message: 'x' } });
    const from = jest.fn().mockReturnValue({ upsert });
    const client = { from } as any;
    await expect(savePushToken(client, 'u1', 't')).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/notifications/registerPushToken.test.ts`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装（保存API）**

Create `src/features/notifications/registerPushToken.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function savePushToken(
  client: SupabaseClient,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await client.from('push_tokens').upsert({ token, user_id: userId });
  if (error) throw error;
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/notifications/registerPushToken.test.ts` → PASS（2 passed）

- [ ] **Step 5: expo-notifications を導入**

```bash
npx expo install expo-notifications
```
（npmキャッシュが root 所有で失敗する場合は `npm install expo-notifications --cache /tmp/npm-cache-user` で回避し、バージョンは SDK 56 互換のものにする。報告に導入バージョンを記載すること。）

- [ ] **Step 6: app.json に通知プラグインを追加**

`app.json` の `expo.plugins` 配列に `"expo-notifications"` を追加（既存の `"expo-router"`, `"expo-status-bar"` は残す）。例:
```json
"plugins": [
  "expo-router",
  "expo-status-bar",
  "expo-notifications"
]
```

- [ ] **Step 7: 登録フックを作成**

Create `src/features/notifications/usePushRegistration.ts`:
```ts
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../../lib/supabase';
import { savePushToken } from './registerPushToken';
import { useAuth } from '../auth/useAuth';

// ログイン後にプッシュ権限を求め、Expoトークンを取得して push_tokens に保存する。
// ベストエフォート: 権限拒否・projectId未設定・Expo Go 等で失敗しても黙って無視する。
export function usePushRegistration() {
  const { session } = useAuth();
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await Notifications.getPermissionsAsync();
        let granted = current.granted;
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          // @ts-expect-error easConfig は型に無い場合がある
          Constants.easConfig?.projectId;
        const tokenResp = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        if (!cancelled && tokenResp?.data) {
          await savePushToken(supabase, session.user.id, tokenResp.data);
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);
}
```

- [ ] **Step 8: (app) レイアウトでフックを呼ぶ**

Modify `app/(app)/_layout.tsx`. Read it first; it currently is:
```tsx
import { Stack } from 'expo-router';

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```
Replace its entire content with:
```tsx
import { Stack } from 'expo-router';
import { usePushRegistration } from '../../src/features/notifications/usePushRegistration';

export default function AppLayout() {
  usePushRegistration();
  return <Stack screenOptions={{ headerShown: true }} />;
}
```

- [ ] **Step 9: 検証**

Run: `npx tsc --noEmit` → exit 0
Run: `npm test` → 全緑
（注: 実機プッシュ受信テストは dev build が必要。ここではコード・型・保存APIの検証まで。）

- [ ] **Step 10: コミット**

```bash
git add src/features/notifications/ app.json "app/(app)/_layout.tsx" package.json package-lock.json
git commit -m "feat: add push token registration (expo-notifications)"
```

---

## Task 5: 「乗せて」作成画面 + コミュニティ詳細からの導線

**Files:**
- Create: `app/(app)/requests/create.tsx`
- Modify: `app/(app)/communities/[id].tsx`

- [ ] **Step 1: 作成画面**

Create `app/(app)/requests/create.tsx`:
```tsx
import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { createRequest } from '../../../src/features/ride/rideRequestApi';
import { parseDepartAt, validateRideText } from '../../../src/features/ride/validation';

export default function CreateRequest() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const [departAt, setDepartAt] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!session || !communityId) return;
    const t = parseDepartAt(departAt);
    if (!t.ok) { Alert.alert('入力エラー', t.error); return; }
    const v = validateRideText(origin, destination);
    if (!v.ok) { Alert.alert('入力エラー', v.error); return; }
    setBusy(true);
    try {
      const req = await createRequest(supabase, session.user.id, {
        communityId,
        departAt: t.iso,
        originText: origin.trim(),
        destinationText: destination.trim(),
        note: note.trim() || undefined,
      });
      Alert.alert('依頼を出しました', 'コミュニティのドライバーに届きました。');
      router.replace(`/(app)/requests/${req.id}`);
    } catch (e) {
      Alert.alert('依頼できませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>「乗せて」と頼む</Text>
      <Text>希望日時（例: 2026-07-01 09:30）</Text>
      <TextInput value={departAt} onChangeText={setDepartAt} placeholder="2026-07-01 09:30" style={inputStyle} />
      <Text>出発地</Text>
      <TextInput value={origin} onChangeText={setOrigin} placeholder="例: 自宅" style={inputStyle} />
      <Text>目的地</Text>
      <TextInput value={destination} onChangeText={setDestination} placeholder="例: 日光総合体育館" style={inputStyle} />
      <Text>メモ（任意）</Text>
      <TextInput value={note} onChangeText={setNote} placeholder="補足があれば" style={inputStyle} />
      <Button title={busy ? '送信中…' : 'この内容で頼む'} onPress={onSubmit} disabled={busy} />
    </View>
  );
}

const inputStyle = { borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 } as const;
```

- [ ] **Step 2: コミュニティ詳細に導線を追加**

Modify `app/(app)/communities/[id].tsx`. Read it first. Add `useRouter` to the existing `expo-router` import (it currently imports `useFocusEffect, useLocalSearchParams`):
```tsx
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
```
Add the router inside the component, right after `const { session } = useAuth();`:
```tsx
  const router = useRouter();
```
Then, in the returned JSX, right AFTER the community title line:
```tsx
      <Text style={{ fontSize: 22, fontWeight: '600' }}>{community.name}</Text>
```
insert a "乗せてと頼む" button shown to approved members (owner counts as approved). Add this block immediately after that title line:
```tsx
      <Button
        title="「乗せて」と頼む"
        onPress={() => router.push(`/(app)/requests/create?communityId=${community.id}`)}
      />
```
(`Button` is already imported in this file from 'react-native'.)

- [ ] **Step 3: 検証**

Run: `npx tsc --noEmit` → exit 0. Run `npm test` → 全緑。If an unexpected tsc error appears, STOP and report.

- [ ] **Step 4: コミット**

```bash
git add "app/(app)/requests/create.tsx" "app/(app)/communities/[id].tsx"
git commit -m "feat: add ride request create screen and community entry point"
```

---

## Task 6: 募集中一覧（ドライバー向け）+ 自分のリクエスト一覧

**Files:**
- Create: `app/(app)/requests/index.tsx`
- Create: `app/(app)/requests/mine.tsx`

- [ ] **Step 1: 募集中一覧（ドライバー向け）**

Create `app/(app)/requests/index.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { listOpenRequests } from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';

export default function OpenRequests() {
  const { session } = useAuth();
  const [items, setItems] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listOpenRequests(supabase)
        .then((rows) => {
          if (!active) return;
          const mine = session?.user.id;
          setItems(rows.filter((r) => r.rider_id !== mine));
        })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>募集中の乗合</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>いまは募集がありません</Text>}
          renderItem={({ item }) => (
            <Link href={`/(app)/requests/${item.id}`} asChild>
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                <Text style={{ fontSize: 16 }}>{item.origin_text} → {item.destination_text}</Text>
                <Text style={{ color: '#86868b' }}>{new Date(item.depart_at).toLocaleString('ja-JP')}</Text>
              </View>
            </Link>
          )}
        />
      )}
    </View>
  );
}
```

- [ ] **Step 2: 自分のリクエスト一覧**

Create `app/(app)/requests/mine.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { listMyRequests } from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';

const STATUS_LABEL: Record<string, string> = {
  open: '募集中', matched: '成立', completed: '完了', cancelled: 'キャンセル',
};

export default function MyRequests() {
  const { session } = useAuth();
  const [items, setItems] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      setLoading(true);
      listMyRequests(supabase, session.user.id)
        .then((rows) => { if (active) setItems(rows); })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>自分のリクエスト</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>まだリクエストがありません</Text>}
          renderItem={({ item }) => (
            <Link href={`/(app)/requests/${item.id}`} asChild>
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                <Text style={{ fontSize: 16 }}>{item.origin_text} → {item.destination_text}</Text>
                <Text style={{ color: '#86868b' }}>
                  {new Date(item.depart_at).toLocaleString('ja-JP')}（{STATUS_LABEL[item.status] ?? item.status}）
                </Text>
              </View>
            </Link>
          )}
        />
      )}
    </View>
  );
}
```

- [ ] **Step 3: 検証**

Run: `npx tsc --noEmit` → exit 0. Run `npm test` → 全緑。

- [ ] **Step 4: コミット**

```bash
git add "app/(app)/requests/index.tsx" "app/(app)/requests/mine.tsx"
git commit -m "feat: add open requests (driver) and my requests lists"
```

---

## Task 7: リクエスト詳細 + 操作（応答/キャンセル/完了）

**Files:**
- Create: `app/(app)/requests/[id].tsx`

- [ ] **Step 1: 詳細＋操作画面**

Create `app/(app)/requests/[id].tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import {
  getRequest, acceptRequest, cancelRequest, completeRequest,
} from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';

const STATUS_LABEL: Record<string, string> = {
  open: '募集中', matched: '成立', completed: '完了', cancelled: 'キャンセル',
};

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [req, setReq] = useState<RideRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setReq(await getRequest(supabase, id));
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      Alert.alert(okMsg);
      await load();
    } catch (e) {
      Alert.alert('操作エラー', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }
  if (!req) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>見つかりません</Text></View>;
  }

  const me = session?.user.id;
  const isRider = me === req.rider_id;
  const isDriver = me === req.driver_id;

  return (
    <View style={{ flex: 1, padding: 24, gap: 10 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>{req.origin_text} → {req.destination_text}</Text>
      <Text>{new Date(req.depart_at).toLocaleString('ja-JP')}</Text>
      <Text>状態：{STATUS_LABEL[req.status] ?? req.status}</Text>
      {req.note ? <Text>メモ：{req.note}</Text> : null}

      {req.status === 'open' && !isRider && (
        <Button title={busy ? '処理中…' : '乗せます'} disabled={busy}
          onPress={() => act(() => acceptRequest(supabase, req.id), '成立しました')} />
      )}
      {req.status === 'matched' && (isRider || isDriver) && (
        <Button title={busy ? '処理中…' : '完了にする'} disabled={busy}
          onPress={() => act(() => completeRequest(supabase, req.id), '完了しました')} />
      )}
      {isRider && (req.status === 'open' || req.status === 'matched') && (
        <Button title={busy ? '処理中…' : 'キャンセル'} color="#ff3b30" disabled={busy}
          onPress={() => act(() => cancelRequest(supabase, req.id), 'キャンセルしました')} />
      )}
    </View>
  );
}
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit` → exit 0. Run `npm test` → 全緑。

- [ ] **Step 3: コミット**

```bash
git add "app/(app)/requests/[id].tsx"
git commit -m "feat: add ride request detail with accept/cancel/complete"
```

---

## Task 8: プロフィールからの導線

**Files:**
- Modify: `app/(app)/profile.tsx`

- [ ] **Step 1: 導線ボタンを追加**

Modify `app/(app)/profile.tsx`. Read it first. It currently has (from STEP 1) a block of navigation buttons ending with the logout button. Locate this block:
```tsx
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
REPLACE it with (adds two ride links between the driver button and logout):
```tsx
      <View style={{ height: 16 }} />
      <Button title="コミュニティ" onPress={() => router.push('/(app)/communities')} />
      <View style={{ height: 8 }} />
      <Button
        title={profile?.is_driver ? 'ドライバー情報を編集' : 'ドライバー登録'}
        onPress={() => router.push('/(app)/driver/register')}
      />
      <View style={{ height: 8 }} />
      <Button title="乗合をさがす（ドライバー）" onPress={() => router.push('/(app)/requests')} />
      <View style={{ height: 8 }} />
      <Button title="自分のリクエスト" onPress={() => router.push('/(app)/requests/mine')} />

      <View style={{ height: 16 }} />
      <Button title="ログアウト" color="#ff3b30" onPress={signOut} />
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit` → exit 0. Run `npm test` → 全緑。

- [ ] **Step 3: コミット**

```bash
git add "app/(app)/profile.tsx"
git commit -m "feat: link ride request screens from profile"
```

---

## Task 9: 総合検証 + main マージ

**Files:** （コード変更なし。検証のみ）

- [ ] **Step 1: 全テスト + 型チェック**

Run: `npm test` → 全 suite 緑
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 2: （コントローラ=Opus）バックエンド一気通貫のヘッドレス検証**

`0003` 適用済みの本番Supabaseに対し、使い捨てユーザーで以下を確認:
1. owner 作成 + member 参加 + owner 承認（STEP 1 の流れで下準備）。member を `saveDriverProfile` でドライバー化。
2. rider（owner）が `ride_requests` に insert（`createRequest`）→ `open` で作成。
3. driver（member）が `listOpenRequests` で当該リクエストが見える（RLS: 同コミュニティ承認済み）。
4. driver が `accept_ride_request` → `matched`・`driver_id` が driver に。
5. 別の無関係ユーザーには当該リクエストが**見えない**（RLS）。
6. `accept` を二重に呼ぶと2回目は `request not open` で失敗（競合安全）。
7. rider が `cancelRequest`（open の別リクエストで）→ `cancelled`。

Expected: 1〜7 期待どおり。特に 5（RLS隔離）と 6（二重成立防止）。

- [ ] **Step 3: （人手・任意）プッシュ実機テスト**

dev build（EAS もしくはローカル）でアプリを起動 → ログイン → 通知許可 → `push_tokens` に行ができることを確認。別ユーザーで同コミュニティに「乗せて」を作成 → ドライバー端末に通知が届くことを確認。
（dev build が未準備なら本ステップはスキップ可。アプリ内一覧での成立確認で STEP 2 の価値は成立する。）

- [ ] **Step 4: ブランチ完了**

`finishing-a-development-branch` で `step-2-matching` → `main` マージ＆push。

---

## Self-Review（計画作成者チェック）

- **Spec カバレッジ**: リクエスト発信=Task2/3/5、ドライバーへ通知（プッシュ=Task1トリガ+Task4登録／アプリ内一覧=Task6）、応答・成立=Task1(accept RPC)+Task3+Task7。完了/キャンセル=Task3/7。導線=Task5/8。設計STEP 2の「発信→通知→応答・成立」を網羅。
- **プレースホルダ**: 各コード手順に実コード記載。曖昧表現なし。
- **型整合**: `RideRequest`/`RideStatus`(types.ts) → rideRequestApi/画面で一致。`CreateRideInput`(rideRequestApi.ts) は create 画面で使用。RPC 引数 `p_request` は Task1 SQL と Task3 API で一致。`parseDepartAt`/`validateRideText`(validation.ts) は create 画面で使用。`savePushToken`(registerPushToken.ts) は usePushRegistration で使用。`listOpenRequests` は RLS 前提で引数なし。
- **RLS/競合**: 閲覧・作成は `is_approved_community_member`、成立は `accept_ride_request` の `where status='open'` で原子的（二重成立防止）。更新は rider/driver 本人限定。push_tokens は own-row。すべて SECURITY DEFINER ヘルパで再帰回避。
- **既知の前提/制約**: `set_updated_at()`・`gen_random_uuid()`・`pg_net` は Supabase 既存/有効化可能。プッシュはベストエフォート（pg_net 失敗でも作成は成功）。実機プッシュ受信は dev build 必須（Task 9 Step 3 は任意）。`getExpoPushTokenAsync` は EAS projectId 未設定時に失敗するが、フックが握りつぶすのでアプリは動作。

## 留意点（実装担当向け）
- Task 1 Step 2（SQL適用）と Task 9 Step 3（実機プッシュ）は人手。
- expo-notifications 導入時、npm キャッシュ root 所有問題が出たら `--cache /tmp/npm-cache-user` で回避し、SDK 56 互換版を入れる。
- 既存ファイル変更（communities/[id].tsx, profile.tsx, (app)/_layout.tsx）は必ず現物を読んでから差分を当てる。
