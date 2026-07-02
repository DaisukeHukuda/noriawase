# STEP 3: 安全層（見守り・乗車記録・相互評価） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 家族への見守り通知（成立・到着を自動プッシュ）、乗車記録（改ざんしにくい監査ログ）、乗車後の相互評価／問題報告を実装し、本人と家族が安心して使える状態にする。

**Architecture:** `watchers`（見守り関係）・`ride_events`（状態遷移の監査ログ、SECURITY DEFINERトリガで自動記録・書込ポリシー無し＝アプリからは改変不可）・`reviews`（相互評価）を追加。見守り家族の登録はメールアドレス指定の SECURITY DEFINER RPC（auth.usersを検索）。通知は STEP 2 の pg_net 基盤を再利用し、`ride_requests` の **AFTER UPDATE トリガ**で「成立→利用者＋見守り家族」「完了→見守り家族」へプッシュ。профильの氏名可視は `is_watch_related` ヘルパで見守り関係にも開放。クライアントは従来どおりクライアント注入API＋モックTDD、画面はtsc検証。

**Tech Stack:** 既存スタック（Expo SDK 56 / Supabase / pg_net / Jest）。新規依存なし。

> 設計: [docs/superpowers/specs/2026-06-29-noriawase-design.md](../specs/2026-06-29-noriawase-design.md) §9
> 前提: STEP 0〜2 完了（main）。緊急ボタンは設計どおり将来対応（本STEPに含めない）。

---

## 設計上の決定（MVP）

- **見守り家族もアプリユーザー**: 家族がアプリを入れて登録し、利用者が家族の**メールアドレス**で見守り登録（`add_watcher_by_email` RPC）。プッシュは既存 `push_tokens` 基盤で届く。アプリ外（SMS等）への通知は将来対応。
- **乗車記録 = ride_events**: created / matched / completed / cancelled の遷移をトリガで自動記録。アプリからの insert/update/delete ポリシーを一切付けない＝**利用者にもドライバーにも改変不能**。閲覧は当事者＋コミュニティ主催者。
- **評価はシンプル2択**: `good`（無事着いた）/ `problem`（問題を報告）＋任意コメント。1乗車につき各参加者1回。問題報告はコミュニティ主催者も閲覧でき、「輪から外す」判断（STEP 1 の停止機能）につながる。
- **一覧UIはYAGNI**: 乗車履歴は既存「自分のリクエスト」一覧が兼ねる。ride_events の専用画面は作らない（監査用の土台）。

## ファイル構成

```
supabase/migrations/
  0004_safety.sql                 # watchers / ride_events / reviews + RPC + 通知トリガ + profiles可視化

src/features/watcher/
  watcherApi.ts                   # addWatcherByEmail / listMyWatchers / removeWatcher（TDD）
  watcherApi.test.ts
src/features/review/
  reviewApi.ts                    # submitReview / getMyReviewForRide（TDD）
  reviewApi.test.ts

app/(app)/
  watchers/index.tsx              # 見守り家族の一覧・追加・削除
  requests/[id].tsx               # 変更: 完了後の評価UI（無事着いた／問題を報告）
  profile.tsx                     # 変更: 「見守り家族」導線
```

---

## Task 1: DBマイグレーション（watchers / ride_events / reviews / 通知）

**Files:**
- Create: `supabase/migrations/0004_safety.sql`

> Step 2 のSQL適用は人手。実装者はファイル作成＋コミットのみ。DBへ接続しない。

- [ ] **Step 1: マイグレーションSQLを作成**

Create `supabase/migrations/0004_safety.sql` with EXACTLY:
```sql
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
```

- [ ] **Step 2: （人手）SQL Editor で適用**

Expected: `Success. No rows returned`。

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/0004_safety.sql
git commit -m "feat: add watchers, ride event log, reviews, safety notifications"
```

---

## Task 2: 見守りAPI（TDD）

**Files:**
- Test: `src/features/watcher/watcherApi.test.ts`
- Create: `src/features/watcher/watcherApi.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/watcher/watcherApi.test.ts`:
```ts
import { addWatcherByEmail, listMyWatchers, removeWatcher } from './watcherApi';

describe('addWatcherByEmail', () => {
  test('rpc add_watcher_by_email を呼ぶ', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const client = { rpc } as any;
    await addWatcherByEmail(client, 'family@example.com');
    expect(rpc).toHaveBeenCalledWith('add_watcher_by_email', { p_email: 'family@example.com' });
  });
  test('error は throw', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'user not found' } });
    const client = { rpc } as any;
    await expect(addWatcherByEmail(client, 'x@example.com')).rejects.toBeDefined();
  });
});

describe('listMyWatchers', () => {
  test('watchers を user_id で引き watcher の氏名を埋め込む', async () => {
    const rows = [
      { id: 'w1', user_id: 'u1', watcher_user_id: 'u2', created_at: 't',
        watcher: { full_name: '家族花子' } },
    ];
    const eq = jest.fn().mockResolvedValue({ data: rows, error: null });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    const res = await listMyWatchers(client, 'u1');
    expect(from).toHaveBeenCalledWith('watchers');
    expect(res).toEqual(rows);
  });
});

describe('removeWatcher', () => {
  test('delete().eq() を呼ぶ', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ delete: del });
    const client = { from } as any;
    await removeWatcher(client, 'w1');
    expect(eq).toHaveBeenCalledWith('id', 'w1');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/watcher/watcherApi.test.ts` → FAIL（モジュール無し）

- [ ] **Step 3: 実装**

Create `src/features/watcher/watcherApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type Watcher = {
  id: string;
  user_id: string;
  watcher_user_id: string;
  created_at: string;
  watcher: { full_name: string } | null;
};

export async function addWatcherByEmail(
  client: SupabaseClient,
  email: string,
): Promise<void> {
  const { error } = await client.rpc('add_watcher_by_email', { p_email: email });
  if (error) throw error;
}

export async function listMyWatchers(
  client: SupabaseClient,
  userId: string,
): Promise<Watcher[]> {
  const { data, error } = await client
    .from('watchers')
    .select('*, watcher:profiles!watchers_watcher_user_id_fkey(full_name)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as Watcher[];
}

export async function removeWatcher(
  client: SupabaseClient,
  watcherId: string,
): Promise<void> {
  const { error } = await client.from('watchers').delete().eq('id', watcherId);
  if (error) throw error;
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/watcher/watcherApi.test.ts` → PASS（4 passed）
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: コミット**

```bash
git add src/features/watcher/watcherApi.ts src/features/watcher/watcherApi.test.ts
git commit -m "feat: add watcher API (add by email/list/remove)"
```

---

## Task 3: 評価API（TDD）

**Files:**
- Test: `src/features/review/reviewApi.test.ts`
- Create: `src/features/review/reviewApi.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/review/reviewApi.test.ts`:
```ts
import { submitReview, getMyReviewForRide } from './reviewApi';

describe('submitReview', () => {
  test('reviews に insert する', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const client = { from } as any;
    await submitReview(client, {
      rideRequestId: 'r1', reviewerId: 'u1', revieweeId: 'u2',
      rating: 'good', comment: 'ありがとうございました',
    });
    expect(from).toHaveBeenCalledWith('reviews');
    expect(insert).toHaveBeenCalledWith({
      ride_request_id: 'r1', reviewer_id: 'u1', reviewee_id: 'u2',
      rating: 'good', comment: 'ありがとうございました',
    });
  });
  test('error は throw', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { message: 'x' } });
    const from = jest.fn().mockReturnValue({ insert });
    const client = { from } as any;
    await expect(submitReview(client, {
      rideRequestId: 'r1', reviewerId: 'u1', revieweeId: 'u2', rating: 'problem',
    })).rejects.toBeDefined();
  });
});

describe('getMyReviewForRide', () => {
  test('自分のレビューを1件取得（無ければ null）', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = jest.fn().mockReturnValue({ maybeSingle });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    const select = jest.fn().mockReturnValue({ eq: eq1 });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    await expect(getMyReviewForRide(client, 'r1', 'u1')).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('reviews');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- src/features/review/reviewApi.test.ts` → FAIL（モジュール無し）

- [ ] **Step 3: 実装**

Create `src/features/review/reviewApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReviewRating = 'good' | 'problem';

export type Review = {
  id: string;
  ride_request_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: ReviewRating;
  comment: string | null;
  created_at: string;
};

export type SubmitReviewInput = {
  rideRequestId: string;
  reviewerId: string;
  revieweeId: string;
  rating: ReviewRating;
  comment?: string;
};

export async function submitReview(
  client: SupabaseClient,
  input: SubmitReviewInput,
): Promise<void> {
  const { error } = await client.from('reviews').insert({
    ride_request_id: input.rideRequestId,
    reviewer_id: input.reviewerId,
    reviewee_id: input.revieweeId,
    rating: input.rating,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
  });
  if (error) throw error;
}

export async function getMyReviewForRide(
  client: SupabaseClient,
  rideRequestId: string,
  userId: string,
): Promise<Review | null> {
  const { data, error } = await client
    .from('reviews')
    .select('*')
    .eq('ride_request_id', rideRequestId)
    .eq('reviewer_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Review) ?? null;
}
```

注意: submitReview のテストは comment ありのケースで `comment` キーを期待している。comment 未指定時はキー自体を送らない実装（上記スプレッド）で、テスト（comment無しのerrorケース）も通る。

- [ ] **Step 4: 成功を確認**

Run: `npm test -- src/features/review/reviewApi.test.ts` → PASS（3 passed）
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: コミット**

```bash
git add src/features/review/reviewApi.ts src/features/review/reviewApi.test.ts
git commit -m "feat: add review API (submit/get mine)"
```

---

## Task 4: 見守り家族 画面 + プロフィール導線

**Files:**
- Create: `app/(app)/watchers/index.tsx`
- Modify: `app/(app)/profile.tsx`

- [ ] **Step 1: 見守り家族画面**

Create `app/(app)/watchers/index.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import {
  addWatcherByEmail, listMyWatchers, removeWatcher, type Watcher,
} from '../../../src/features/watcher/watcherApi';

export default function Watchers() {
  const { session } = useAuth();
  const [items, setItems] = useState<Watcher[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setItems(await listMyWatchers(supabase, session.user.id));
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onAdd() {
    if (email.trim().length < 3) { Alert.alert('入力エラー', 'メールアドレスを入力してください'); return; }
    setBusy(true);
    try {
      await addWatcherByEmail(supabase, email.trim());
      setEmail('');
      Alert.alert('登録しました', '乗合の成立・到着をこの家族に通知します。');
      await load();
    } catch (e) {
      Alert.alert('登録できませんでした', 'このメールアドレスのアプリ利用者が見つかりません。家族が先にアプリで登録している必要があります。');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    try {
      await removeWatcher(supabase, id);
      await load();
    } catch (e) {
      Alert.alert('削除エラー', (e as Error).message);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>見守り家族</Text>
      <Text style={{ color: '#86868b' }}>
        登録した家族に、乗合の成立と到着を自動で通知します。家族もこのアプリの登録が必要です。
      </Text>
      <Text>家族のメールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="family@example.com"
        style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 }}
      />
      <Button title={busy ? '登録中…' : '見守り家族に追加'} onPress={onAdd} disabled={busy} />
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(w) => w.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>まだ登録がありません</Text>}
          renderItem={({ item }) => (
            <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, fontSize: 16 }}>{item.watcher?.full_name ?? '（氏名未取得）'}</Text>
              <Button title="解除" color="#ff3b30" onPress={() => onRemove(item.id)} />
            </View>
          )}
        />
      )}
    </View>
  );
}
```

- [ ] **Step 2: プロフィールに導線を追加**

Modify `app/(app)/profile.tsx`. READ it first. Find（STEP 2 時点のブロック）:
```tsx
      <View style={{ height: 8 }} />
      <Button title="自分のリクエスト" onPress={() => router.push('/(app)/requests/mine')} />
```
REPLACE with:
```tsx
      <View style={{ height: 8 }} />
      <Button title="自分のリクエスト" onPress={() => router.push('/(app)/requests/mine')} />
      <View style={{ height: 8 }} />
      <Button title="見守り家族" onPress={() => router.push('/(app)/watchers')} />
```

- [ ] **Step 3: 検証**

Run: `npx tsc --noEmit` → exit 0. Run `npm test` → 全緑。

- [ ] **Step 4: コミット**

```bash
git add "app/(app)/watchers/index.tsx" "app/(app)/profile.tsx"
git commit -m "feat: add watchers management screen and profile link"
```

---

## Task 5: リクエスト詳細に評価UI（完了後）

**Files:**
- Modify: `app/(app)/requests/[id].tsx`（全置換）

- [ ] **Step 1: 詳細画面を評価UI付きで全置換**

REPLACE the entire contents of `app/(app)/requests/[id].tsx` with:
```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import {
  getRequest, acceptRequest, cancelRequest, completeRequest,
} from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';
import {
  getMyReviewForRide, submitReview, type Review, type ReviewRating,
} from '../../../src/features/review/reviewApi';

const STATUS_LABEL: Record<string, string> = {
  open: '募集中', matched: '成立', completed: '完了', cancelled: 'キャンセル',
};

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [req, setReq] = useState<RideRequest | null>(null);
  const [myReview, setMyReview] = useState<Review | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await getRequest(supabase, id);
      setReq(r);
      if (session && r.status === 'completed'
          && (r.rider_id === session.user.id || r.driver_id === session.user.id)) {
        setMyReview(await getMyReviewForRide(supabase, r.id, session.user.id));
      }
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, session]);

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

  async function onReview(rating: ReviewRating) {
    if (!req || !session) return;
    const revieweeId = session.user.id === req.rider_id ? req.driver_id : req.rider_id;
    if (!revieweeId) return;
    await act(
      () => submitReview(supabase, {
        rideRequestId: req.id,
        reviewerId: session.user.id,
        revieweeId,
        rating,
        comment: comment.trim() || undefined,
      }),
      rating === 'good' ? 'ありがとうございました' : '報告しました。主催者が確認します',
    );
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
  const isParticipant = isRider || isDriver;

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
      {req.status === 'matched' && isParticipant && (
        <Button title={busy ? '処理中…' : '完了にする'} disabled={busy}
          onPress={() => act(() => completeRequest(supabase, req.id), '完了しました')} />
      )}
      {isRider && (req.status === 'open' || req.status === 'matched') && (
        <Button title={busy ? '処理中…' : 'キャンセル'} color="#ff3b30" disabled={busy}
          onPress={() => act(() => cancelRequest(supabase, req.id), 'キャンセルしました')} />
      )}

      {req.status === 'completed' && isParticipant && (
        myReview ? (
          <View style={{ marginTop: 12, gap: 4 }}>
            <Text style={{ fontWeight: '600' }}>評価済み</Text>
            <Text>{myReview.rating === 'good' ? '無事着きました' : '問題を報告しました'}</Text>
            {myReview.comment ? <Text style={{ color: '#86868b' }}>{myReview.comment}</Text> : null}
          </View>
        ) : (
          <View style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ fontWeight: '600' }}>今回の乗合はいかがでしたか？</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="コメント（任意）"
              style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 }}
            />
            <Button title={busy ? '送信中…' : '無事着きました'} disabled={busy}
              onPress={() => onReview('good')} />
            <Button title={busy ? '送信中…' : '問題を報告する'} color="#ff3b30" disabled={busy}
              onPress={() => onReview('problem')} />
          </View>
        )
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
git commit -m "feat: add post-ride review UI (arrived safely / report problem)"
```

---

## Task 6: 総合検証 + main マージ

- [ ] **Step 1: 全テスト + 型チェック**

Run: `npm test` → 全緑 / `npx tsc --noEmit` → exit 0

- [ ] **Step 2: （コントローラ=Opus）バックエンド一気通貫のヘッドレス検証**

`0004` 適用後、使い捨てユーザーで:
1. rider・driver・family・stranger を作成、コミュニティ＋成立フローの下準備（STEP 2 検証と同様）。
2. rider が `add_watcher_by_email(familyのメール)` → watchers に行、家族側から `listMyWatchers` 相当の閲覧OK。
3. 未登録メールで `add_watcher_by_email` → 'user not found' エラー。
4. リクエスト作成→accept→complete の各遷移で `ride_events` に created/matched/completed が自動記録され、当事者から見える。stranger からは見えない。
5. ride_events への直接 insert/update が**拒否**される（改変不可）。
6. complete 後、rider が `submitReview(good)` → 成功。同じ ride に2回目 → unique違反で失敗。完了前のrideへの投稿 → RLSで失敗。
7. 問題報告（problem）がコミュニティ主催者から閲覧できる。
8. watcher（family）が rider の氏名を読める（is_watch_related 経由）。

- [ ] **Step 3: ブランチ完了**

finishing-a-development-branch で `step-3-safety` → `main` マージ＆push。

---

## Self-Review

- **Spec §9 カバレッジ**: 見守り通知=Task1(トリガ)+Task2(API)+Task4(画面)、乗車記録=Task1(ride_events・改変不可RLS)、相互評価/報告=Task1(reviews)+Task3(API)+Task5(UI)。緊急ボタンは設計どおり除外。
- **型整合**: `Watcher`(watcherApi) → watchers画面、`Review`/`ReviewRating`/`SubmitReviewInput`(reviewApi) → [id].tsx、RPC引数 `p_email` はSQLとAPIで一致。FK埋め込み名 `watchers_watcher_user_id_fkey` はデフォルト制約名。
- **安全設計**: ride_events は書込ポリシー無し＋SECURITY DEFINERトリガのみ＝当事者にも改変不可。reviews は完了済み当事者のみ投稿・主催者閲覧で「輪から外す」運用に接続。profiles可視は見守り関係に限定して開放。
- **既知の制約**: 見守り家族はアプリ登録必須（MVP）。通知はベストエフォート。`auth.users` のメール検索は SECURITY DEFINER RPC内のみ（クライアントから直接は不可）。
