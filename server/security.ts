import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEYLEN = 64

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(secret, salt, KEYLEN).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifySecret(secret: string, stored: string | undefined): boolean {
  if (!stored) return false
  const [algo, salt, hash] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !hash) return false
  const candidate = scryptSync(secret, salt, KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** Crockford Base32：去掉容易看错的 I / L / O / U，家长手抄恢复码时不容易错。 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_LENGTH = 16

/** 生成 16 位恢复码（80 bit 随机），返回不带分隔符的大写形式；显示时用 formatRecoveryCode。 */
export function newRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH)
  let code = ''
  for (let i = 0; i < RECOVERY_LENGTH; i += 1) code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length]
  return code
}

/** 家长输入时容错：忽略大小写、分隔符与空格，并把 I/L/O 归一到 1/0。 */
export function normalizeRecoveryCode(input: string): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

/** 显示成 XXXX-XXXX-XXXX-XXXX，便于抄写。 */
export function formatRecoveryCode(code: string): string {
  return normalizeRecoveryCode(code).replace(/(.{4})(?=.)/g, '$1-')
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}
