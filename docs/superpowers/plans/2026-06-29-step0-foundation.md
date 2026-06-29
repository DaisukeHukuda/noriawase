# STEP 0: 土台（Foundation）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「のりあわせ」アプリの土台を作る — Expo(React Native/TypeScript) + Supabase の雛形、基礎データ構造（profiles / driver_profiles）とRLS、実名サインアップ／サインイン、プロフィールの表示・編集。

**Architecture:** Expo Router によるファイルベースのルーティング。認証状態は `AuthProvider` (React Context) で保持し、未ログインなら `(auth)` グループへ、ログイン済みなら `(app)` グループへ振り分ける。データアクセスは「純粋なAPI関数 + Supabaseクライアントを引数注入」する形にして、クライアントをモックして単体テストできるようにする。バリデーションなどのロジックは純粋関数に切り出し TDD する。

**Tech Stack:** Expo SDK (latest), React Native, TypeScript, Expo Router, Supabase (`@supabase/supabase-js`), Jest + jest-expo + @testing-library/react-native。

> 設計の出典: [docs/superpowers/specs/2026-06-29-noriawase-design.md](../specs/2026-06-29-noriawase-design.md)
> STEP 0 の範囲は「土台」のみ。コミュニティ／マッチング／安全機能は STEP 1 以降で別計画として作成する。

---

## ファイル構成（このSTEPで作る／触るファイル）

```
noriawase-app/
  app/                          # Expo Router の画面（ファイル=ルート）
    _layout.tsx                 # ルートレイアウト。AuthProvider でラップ＋認証ゲート
    index.tsx                   # 起動時の振り分け（ローディング→auth or app）
    (auth)/
      _layout.tsx               # 認証グループのスタックレイアウト
      sign-in.tsx               # サインイン画面
      sign-up.tsx               # 実名サインアップ画面
    (app)/
      _layout.tsx               # ログイン後グループのレイアウト
      profile.tsx               # プロフィール表示・編集画面
  src/
    lib/
      supabase.ts               # Supabase クライアント生成
      env.ts                    # 環境変数の読み出し（型付き）
    features/
      auth/
        AuthProvider.tsx        # 認証状態の Context Provider
        useAuth.ts              # useAuth フック（Context 参照）
        validateSignUp.ts       # 入力バリデーション（純粋関数・TDD対象）
        validateSignUp.test.ts
      profile/
        types.ts                # Profile 型
        profileApi.ts           # getProfile / updateProfile（クライアント注入・TDD対象）
        profileApi.test.ts
  supabase/
    migrations/
      0001_init.sql             # profiles / driver_profiles + RLS + トリガ
  app.json                      # Expo 設定
  package.json
  tsconfig.json
  jest.config.js
  jest.setup.js
  .env                          # 実値（gitignore 済み）
  .env.example                  # 雛形（コミットする）
  babel.config.js
```

責務の分離方針:
- **画面（app/）** は表示と入力収集に専念。ロジックは呼ばない（src/features の関数を呼ぶだけ）。
- **features/** はドメインごと（auth / profile）にまとめる。技術レイヤーではなく責務で分割。
- **API関数** は Supabase クライアントを第1引数で受け取り、テスト時にモックを差し込める。

---

## Task 0: 前提条件（人手・コーディング不要）

> このタスクは実装者（サブエージェント）ではなく、福田さん本人が一度だけ行う準備です。完了をもって次タスクへ。

- [ ] **Step 1: Node.js LTS を用意**

ターミナルで確認:
```bash
node -v
```
Expected: `v20.x` 以上（無ければ Node LTS を導入）。

- [ ] **Step 2: Supabase プロジェクトを作成**

https://supabase.com で無料プロジェクトを1つ作成（リージョンは Tokyo 推奨）。

- [ ] **Step 3: 接続情報を控える**

Supabase ダッシュボード → Project Settings → API から以下を控える:
- `Project URL`（例: `https://xxxx.supabase.co`）
- `anon public` key

この2つは Task 4 の `.env` に入れる。

---

## Task 1: Expo プロジェクト初期化とフォルダ構成

**Files:**
- Create: プロジェクト雛形一式（`package.json`, `app.json`, `tsconfig.json`, `babel.config.js`, `app/` など）
- Create: `src/lib/`, `src/features/auth/`, `src/features/profile/`, `supabase/migrations/`（空ディレクトリ）

- [ ] **Step 1: Expo + TypeScript 雛形を作成**

カレントが空のプロジェクトルート（`noriawase-app/`）である前提。既存の `docs/` や `.git` を壊さないよう、テンプレートをカレントに展開する:
```bash
npx create-expo-app@latest . --template blank-typescript
```
Expected: `package.json`, `app.json`, `App.tsx`, `tsconfig.json` などが生成される。プロンプトが出たら既存ファイルを保持する形で進める。

- [ ] **Step 2: Expo Router と Supabase 関連の依存を追加**

```bash
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
npm install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
```
Expected: いずれもエラーなく追加される。

- [ ] **Step 3: Expo Router を有効化（エントリポイントとスキーム設定）**

`package.json` の `main` を Expo Router 用に変更:
```json
{
  "main": "expo-router/entry"
}
```

`app.json` の `expo` に `scheme` と `plugins` を追加（既存の値は残す）:
```json
{
  "expo": {
    "scheme": "noriawase",
    "plugins": ["expo-router"]
  }
}
```

- [ ] **Step 4: テンプレ生成の `App.tsx` を削除（Router に置き換えるため）**

```bash
rm -f App.tsx
```

- [ ] **Step 5: 仮のルート画面を作成して起動確認**

Create `app/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `app/index.tsx`:
```tsx
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>のりあわせ — 起動OK</Text>
    </View>
  );
}
```

- [ ] **Step 6: 起動して画面が出ることを確認**

Run:
```bash
npx expo start
```
Expected: Metro が起動し、Expo Go もしくは Web（`w` キー）で「のりあわせ — 起動OK」が表示される。確認後 `Ctrl+C` で停止。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "chore: scaffold Expo + expo-router project"
```

---

## Task 2: Jest テスト環境のセットアップ

**Files:**
- Create: `jest.config.js`, `jest.setup.js`
- Modify: `package.json`（test スクリプトと devDependencies）

- [ ] **Step 1: テスト用依存を追加**

```bash
npm install --save-dev jest jest-expo @testing-library/react-native @types/jest react-test-renderer
```
Expected: devDependencies に追加される。

- [ ] **Step 2: jest 設定を作成**

Create `jest.config.js`:
```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*|expo-router))',
  ],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
```

Create `jest.setup.js`:
```js
// テスト共通のセットアップ（必要に応じて追記）
```

- [ ] **Step 3: test スクリプトを追加**

`package.json` の `scripts` に追加:
```json
{
  "scripts": {
    "test": "jest"
  }
}
```

- [ ] **Step 4: ダミーテストで環境が動くことを確認**

Create `src/sanity.test.ts`:
```ts
test('jest is wired up', () => {
  expect(1 + 1).toBe(2);
});
```

Run:
```bash
npm test -- src/sanity.test.ts
```
Expected: PASS（1 passed）。

- [ ] **Step 5: ダミーテストを削除してコミット**

```bash
rm -f src/sanity.test.ts
git add -A
git commit -m "test: set up jest with jest-expo preset"
```

---

## Task 3: サインアップ入力バリデーション（純粋関数・TDD）

**Files:**
- Test: `src/features/auth/validateSignUp.test.ts`
- Create: `src/features/auth/validateSignUp.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/auth/validateSignUp.test.ts`:
```ts
import { validateSignUp } from './validateSignUp';

describe('validateSignUp', () => {
  const valid = { fullName: '田中花子', email: 'hanako@example.com', password: 'pass1234' };

  test('全項目が妥当なら ok=true', () => {
    expect(validateSignUp(valid)).toEqual({ ok: true });
  });

  test('実名が1文字以下なら fullName エラー', () => {
    const r = validateSignUp({ ...valid, fullName: ' ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fullName).toBeDefined();
  });

  test('メール形式が不正なら email エラー', () => {
    const r = validateSignUp({ ...valid, email: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.email).toBeDefined();
  });

  test('パスワードが8文字未満なら password エラー', () => {
    const r = validateSignUp({ ...valid, password: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.password).toBeDefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run:
```bash
npm test -- src/features/auth/validateSignUp.test.ts
```
Expected: FAIL（`Cannot find module './validateSignUp'`）。

- [ ] **Step 3: 最小実装を書く**

Create `src/features/auth/validateSignUp.ts`:
```ts
export type SignUpInput = {
  fullName: string;
  email: string;
  password: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateSignUp(input: SignUpInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (input.fullName.trim().length < 2) {
    errors.fullName = '実名（2文字以上）を入力してください';
  }
  if (!EMAIL_RE.test(input.email)) {
    errors.email = 'メールアドレスの形式が正しくありません';
  }
  if (input.password.length < 8) {
    errors.password = 'パスワードは8文字以上にしてください';
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run:
```bash
npm test -- src/features/auth/validateSignUp.test.ts
```
Expected: PASS（4 passed）。

- [ ] **Step 5: コミット**

```bash
git add src/features/auth/validateSignUp.ts src/features/auth/validateSignUp.test.ts
git commit -m "feat: add sign-up input validation"
```

---

## Task 4: 環境変数と Supabase クライアント

**Files:**
- Create: `.env.example`, `.env`
- Create: `src/lib/env.ts`
- Create: `src/lib/supabase.ts`

- [ ] **Step 1: .env 雛形と実値を作成**

Create `.env.example`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Create `.env`（Task 0 で控えた実値を入れる。`.env` は .gitignore 済みなのでコミットされない）:
```
EXPO_PUBLIC_SUPABASE_URL=（Project URL を貼る）
EXPO_PUBLIC_SUPABASE_ANON_KEY=（anon public key を貼る）
```

> `EXPO_PUBLIC_` 接頭辞の環境変数は Expo がクライアントに埋め込む。anon key は公開前提のキーなので埋め込んでよい（RLS で保護する）。

- [ ] **Step 2: 型付きの env 読み出しを作成**

Create `src/lib/env.ts`:
```ts
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY を .env に設定してください',
  );
}

export const ENV = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
} as const;
```

- [ ] **Step 3: Supabase クライアントを作成**

Create `src/lib/supabase.ts`:
```ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { ENV } from './env';

export const supabase = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 4: 型チェックが通ることを確認**

Run:
```bash
npx tsc --noEmit
```
Expected: エラーなし（exit 0）。

- [ ] **Step 5: コミット**

```bash
git add .env.example src/lib/env.ts src/lib/supabase.ts
git commit -m "feat: add env config and supabase client"
```

---

## Task 5: データベーススキーマと RLS（マイグレーション）

**Files:**
- Create: `supabase/migrations/0001_init.sql`

> STEP 0 の RLS 方針: 各ユーザーは「自分の profile / driver_profile」だけ参照・編集できる。コミュニティ単位の可視化は STEP 1 で追加する。

- [ ] **Step 1: マイグレーション SQL を作成**

Create `supabase/migrations/0001_init.sql`:
```sql
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
```

- [ ] **Step 2: マイグレーションを Supabase に適用**

Supabase ダッシュボード → SQL Editor に `0001_init.sql` の内容を貼り付けて Run する。
（CLI 派は `supabase db push`。ただし STEP 0 では SQL Editor 適用で十分。）
Expected: `Success. No rows returned`。

- [ ] **Step 3: 適用結果を確認**

SQL Editor で:
```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
```
Expected: `driver_profiles` と `profiles` が含まれる。

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add profiles/driver_profiles schema with RLS"
```

---

## Task 6: Profile API（クライアント注入・TDD）

**Files:**
- Create: `src/features/profile/types.ts`
- Test: `src/features/profile/profileApi.test.ts`
- Create: `src/features/profile/profileApi.ts`

- [ ] **Step 1: Profile 型を作る**

Create `src/features/profile/types.ts`:
```ts
export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_driver: boolean;
};

export type ProfilePatch = Partial<Pick<Profile, 'full_name' | 'phone'>>;
```

- [ ] **Step 2: 失敗するテストを書く（Supabaseクライアントをモック）**

Create `src/features/profile/profileApi.test.ts`:
```ts
import { getProfile, updateProfile } from './profileApi';
import type { Profile } from './types';

const sample: Profile = {
  id: 'u1',
  full_name: '田中花子',
  phone: null,
  avatar_url: null,
  is_driver: false,
};

// Supabase のクエリビルダ（.from().select().eq().single() 等）を最小限モック
function makeClient(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const eqSelect = { select: jest.fn().mockReturnValue({ single }) };
  const eq = jest.fn().mockReturnValue({ single, ...eqSelect });
  const builder = {
    select: jest.fn().mockReturnValue({ eq }),
    update: jest.fn().mockReturnValue({ eq }),
  };
  const from = jest.fn().mockReturnValue(builder);
  return { from } as any;
}

describe('getProfile', () => {
  test('成功時に Profile を返す', async () => {
    const client = makeClient({ data: sample, error: null });
    await expect(getProfile(client, 'u1')).resolves.toEqual(sample);
    expect(client.from).toHaveBeenCalledWith('profiles');
  });

  test('error があれば throw する', async () => {
    const client = makeClient({ data: null, error: { message: 'boom' } });
    await expect(getProfile(client, 'u1')).rejects.toBeDefined();
  });
});

describe('updateProfile', () => {
  test('成功時に更新後の Profile を返す', async () => {
    const updated = { ...sample, full_name: '田中はな' };
    const client = makeClient({ data: updated, error: null });
    await expect(
      updateProfile(client, 'u1', { full_name: '田中はな' }),
    ).resolves.toEqual(updated);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run:
```bash
npm test -- src/features/profile/profileApi.test.ts
```
Expected: FAIL（`Cannot find module './profileApi'`）。

- [ ] **Step 4: 最小実装を書く**

Create `src/features/profile/profileApi.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, ProfilePatch } from './types';

export async function getProfile(
  client: SupabaseClient,
  userId: string,
): Promise<Profile> {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(
  client: SupabaseClient,
  userId: string,
  patch: ProfilePatch,
): Promise<Profile> {
  const { data, error } = await client
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run:
```bash
npm test -- src/features/profile/profileApi.test.ts
```
Expected: PASS（3 passed）。

- [ ] **Step 6: コミット**

```bash
git add src/features/profile/types.ts src/features/profile/profileApi.ts src/features/profile/profileApi.test.ts
git commit -m "feat: add profile get/update API"
```

---

## Task 7: AuthProvider と useAuth

**Files:**
- Create: `src/features/auth/AuthProvider.tsx`
- Create: `src/features/auth/useAuth.ts`

- [ ] **Step 1: AuthProvider を作成**

Create `src/features/auth/AuthProvider.tsx`:
```tsx
import { createContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { validateSignUp, type SignUpInput } from './validateSignUp';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signUp: (input: SignUpInput) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signUp(input: SignUpInput) {
    const result = validateSignUp(input);
    if (!result.ok) {
      throw new Error(Object.values(result.errors)[0]);
    }
    const { error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.fullName.trim() } },
    });
    if (error) throw error;
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider value={{ session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 2: useAuth フックを作成**

Create `src/features/auth/useAuth.ts`:
```ts
import { useContext } from 'react';
import { AuthContext } from './AuthProvider';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth は AuthProvider の内側で使ってください');
  }
  return ctx;
}
```

- [ ] **Step 3: 型チェックを確認**

Run:
```bash
npx tsc --noEmit
```
Expected: エラーなし（exit 0）。

- [ ] **Step 4: コミット**

```bash
git add src/features/auth/AuthProvider.tsx src/features/auth/useAuth.ts
git commit -m "feat: add auth provider and useAuth hook"
```

---

## Task 8: 認証ゲート付きルートレイアウト

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `app/index.tsx`
- Create: `app/(auth)/_layout.tsx`
- Create: `app/(app)/_layout.tsx`

- [ ] **Step 1: ルートレイアウトを AuthProvider でラップ**

Replace `app/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';
import { AuthProvider } from '../src/features/auth/AuthProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </AuthProvider>
  );
}
```

- [ ] **Step 2: index で認証状態に応じてリダイレクト**

Replace `app/index.tsx`:
```tsx
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/features/auth/useAuth';

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={session ? '/(app)/profile' : '/(auth)/sign-in'} />;
}
```

- [ ] **Step 3: 認証グループのレイアウト**

Create `app/(auth)/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```

- [ ] **Step 4: ログイン後グループのレイアウト**

Create `app/(app)/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```

- [ ] **Step 5: 型チェックを確認**

Run:
```bash
npx tsc --noEmit
```
Expected: エラーなし（画面ファイル `sign-in` / `profile` は次タスクで作る。この時点ではルート文字列の型エラーが出る場合があるが、Task 9・10 で解消する。型エラーが出たら次タスクへ進んでよい）。

- [ ] **Step 6: コミット**

```bash
git add app/_layout.tsx app/index.tsx "app/(auth)/_layout.tsx" "app/(app)/_layout.tsx"
git commit -m "feat: add auth-gated routing layout"
```

---

## Task 9: サインアップ／サインイン画面

**Files:**
- Create: `app/(auth)/sign-up.tsx`
- Create: `app/(auth)/sign-in.tsx`

- [ ] **Step 1: サインアップ画面（実名必須）**

Create `app/(auth)/sign-up.tsx`:
```tsx
import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/features/auth/useAuth';

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await signUp({ fullName, email, password });
      router.replace('/(app)/profile');
    } catch (e) {
      Alert.alert('登録できませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>新規登録</Text>
      <Text>実名（本人確認のため必須）</Text>
      <TextInput
        value={fullName}
        onChangeText={setFullName}
        placeholder="例: 田中 花子"
        style={inputStyle}
      />
      <Text>メールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="hanako@example.com"
        style={inputStyle}
      />
      <Text>パスワード（8文字以上）</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={inputStyle}
      />
      <Button title={busy ? '登録中…' : '登録する'} onPress={onSubmit} disabled={busy} />
      <Link href="/(auth)/sign-in" style={{ marginTop: 12, color: '#0071e3' }}>
        すでに登録済みの方はこちら
      </Link>
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

- [ ] **Step 2: サインイン画面**

Create `app/(auth)/sign-in.tsx`:
```tsx
import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/features/auth/useAuth';

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace('/(app)/profile');
    } catch (e) {
      Alert.alert('ログインできませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>ログイン</Text>
      <Text>メールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={inputStyle}
      />
      <Text>パスワード</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry style={inputStyle} />
      <Button title={busy ? 'ログイン中…' : 'ログイン'} onPress={onSubmit} disabled={busy} />
      <Link href="/(auth)/sign-up" style={{ marginTop: 12, color: '#0071e3' }}>
        新規登録はこちら
      </Link>
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

- [ ] **Step 3: 型チェックを確認**

Run:
```bash
npx tsc --noEmit
```
Expected: エラーなし（`/(app)/profile` への参照は次タスクで profile.tsx を作ると解消。残る場合は Task 10 完了時に再確認）。

- [ ] **Step 4: コミット**

```bash
git add "app/(auth)/sign-up.tsx" "app/(auth)/sign-in.tsx"
git commit -m "feat: add sign-up and sign-in screens"
```

---

## Task 10: プロフィール画面（表示・編集）と総合動作確認

**Files:**
- Create: `app/(app)/profile.tsx`

- [ ] **Step 1: プロフィール画面を作成**

Create `app/(app)/profile.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../src/features/auth/useAuth';
import { supabase } from '../../src/lib/supabase';
import { getProfile, updateProfile } from '../../src/features/profile/profileApi';
import type { Profile } from '../../src/features/profile/types';

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    getProfile(supabase, session.user.id)
      .then((p) => {
        setProfile(p);
        setFullName(p.full_name);
        setPhone(p.phone ?? '');
      })
      .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
      .finally(() => setLoading(false));
  }, [session]);

  async function onSave() {
    if (!session) return;
    setSaving(true);
    try {
      const updated = await updateProfile(supabase, session.user.id, {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
      });
      setProfile(updated);
      Alert.alert('保存しました');
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
      <Text style={{ fontSize: 22, fontWeight: '600' }}>プロフィール</Text>
      <Text>氏名（実名）</Text>
      <TextInput value={fullName} onChangeText={setFullName} style={inputStyle} />
      <Text>電話番号（任意）</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        style={inputStyle}
      />
      <Text style={{ color: '#86868b' }}>
        ドライバー登録: {profile?.is_driver ? '済み' : '未（STEP 1 で対応）'}
      </Text>
      <Button title={saving ? '保存中…' : '保存'} onPress={onSave} disabled={saving} />
      <View style={{ height: 12 }} />
      <Button title="ログアウト" color="#ff3b30" onPress={signOut} />
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

- [ ] **Step 2: 全テストと型チェックを実行**

Run:
```bash
npm test && npx tsc --noEmit
```
Expected: 全テスト PASS、型エラーなし。

- [ ] **Step 3: 実機/エミュレータで一気通貫スモークテスト**

Run:
```bash
npx expo start
```
手順で確認:
1. 起動 → サインイン画面が表示される。
2. 「新規登録」→ 実名・メール・パスワードを入力し登録。
3. プロフィール画面に遷移し、登録した実名が表示される。
4. 電話番号を入力して「保存」→「保存しました」。
5. 「ログアウト」→ サインイン画面に戻る。
6. 同じメール／パスワードで「ログイン」→ プロフィールに電話番号が保持されている。

Expected: 上記が全て成功。Supabase ダッシュボード → Table Editor → `profiles` に1行でき、`full_name` と `phone` が入っていること。

- [ ] **Step 4: 最終コミット**

```bash
git add "app/(app)/profile.tsx"
git commit -m "feat: add profile view/edit screen and wire up STEP 0"
```

---

## Self-Review（この計画作成者によるチェック結果）

- **Spec カバレッジ**: STEP 0 の範囲（Expo+Supabase 雛形=Task1/4、データ構造+RLS=Task5、実名サインアップ=Task3/7/9、プロフィール表示編集=Task6/10）をすべてタスク化済み。コミュニティ／マッチング／安全機能は STEP 0 の範囲外（後続計画）で正しく除外。
- **プレースホルダ**: 各コード手順に実コードを記載。「適切に」「TODO」等の曖昧表現なし。
- **型整合**: `Profile`/`ProfilePatch`（types.ts）→ `getProfile`/`updateProfile`（profileApi.ts）→ profile 画面、`SignUpInput`/`ValidationResult`（validateSignUp.ts）→ AuthProvider の `signUp`、`useAuth` の戻り値（session/loading/signUp/signIn/signOut）→ 各画面、で名称・シグネチャ一致を確認済み。
- **既知の許容事項**: Task 8〜9 の途中段階では未作成画面ルートへの参照で一時的な型エラーが出うる。Task 10 完了時点で解消することを明記済み。

## 留意点（実装担当サブエージェント向け）

- 実装は Sonnet/Haiku サブエージェントが担当し、各タスク完了ごとに Opus がレビューする前提。
- Supabase の操作（プロジェクト作成・SQL適用）は人手（Task 0 / Task 5 Step 2）。サブエージェントはここで一旦停止し、人手完了を待つ。
- メール確認（Email confirmation）が ON の Supabase プロジェクトでは、サインアップ直後にセッションが張られない場合がある。スモークテストで詰まったら、Supabase の Authentication → Providers → Email で「Confirm email」を一時 OFF にして検証する（本番方針は STEP 4 で決める）。
