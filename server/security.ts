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

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}
