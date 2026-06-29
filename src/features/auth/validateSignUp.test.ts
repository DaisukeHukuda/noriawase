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
