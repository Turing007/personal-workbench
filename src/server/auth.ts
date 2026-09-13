import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// 会话凭据放在 httpOnly cookie 里，手机上登录一次长期有效。
export const SESSION_COOKIE_NAME = 'workbench_session';
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const TOKEN_SEPARATOR = '.';
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// 令牌 = 签发时间戳 + HMAC(会话密钥, 时间戳)。服务端无需存会话表，重启后仍有效；
// 修改访问密码时应轮换 auth_session_secret 使旧令牌全部失效。
export function createSessionToken(secret: string, issuedAt = Date.now()): string {
  const signature = createHmac('sha256', secret).update(String(issuedAt)).digest('hex');
  return `${issuedAt}${TOKEN_SEPARATOR}${signature}`;
}

export function verifySessionToken(secret: string, token: string, now = Date.now()): boolean {
  const separatorIndex = token.indexOf(TOKEN_SEPARATOR);
  if (separatorIndex <= 0) return false;
  const issuedAtText = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const issuedAt = Number(issuedAtText);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) return false;
  if (now - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return false;
  const expected = createHmac('sha256', secret).update(issuedAtText).digest();
  // Buffer.from 会静默忽略非法的十六进制尾部，必须先做严格格式校验。
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function parseSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    if (part.slice(0, separatorIndex).trim() === SESSION_COOKIE_NAME) {
      return part.slice(separatorIndex + 1).trim() || null;
    }
  }
  return null;
}
