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
