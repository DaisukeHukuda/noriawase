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
