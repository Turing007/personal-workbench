import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const SCHEME = 'scrypt';

/** 生成 `scrypt:<salt hex>:<hash hex>` 格式的密码哈希。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH);
  return `${SCHEME}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** 校验密码；存储格式非法时一律返回 false，不抛出异常。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== SCHEME || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length !== SALT_BYTES || expected.length === 0) return false;
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
