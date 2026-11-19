import crypto from 'node:crypto';

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
export const uuid = (): string => crypto.randomUUID();

/** Uniform random 5-digit code 10000-99999. */
export const fiveDigitCode = (): string => String(crypto.randomInt(10000, 100000));

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
