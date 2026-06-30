export type ParseResult = { ok: true; iso: string } | { ok: false; error: string };
export type TextValidation = { ok: true } | { ok: false; error: string };

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
