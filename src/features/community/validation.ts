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
