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
