import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { projectRoot } from './db.js';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const randomToken = (): string => randomBytes(32).toString('base64url');
export const ticketToken = (secret: string, activityId: string, key: string): string =>
  createHmac('sha256', secret).update(`ticket:${activityId}:${key}`).digest('base64url');
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, value] = stored.split(':');
  if (!salt || !value) return false;
  const expected = Buffer.from(value, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function getSecret(dataDir?: string): Promise<string> {
  if (process.env.TICKET_SECRET) {
    if (process.env.TICKET_SECRET.length < 32)
      throw new Error('TICKET_SECRET must contain at least 32 characters');
    return process.env.TICKET_SECRET;
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('TICKET_SECRET is required in production');
  if (dataDir === 'memory://') return randomToken();
  const path = resolve(dataDir ?? resolve(projectRoot, '.data/postgres'), '../ticket-secret');
  await mkdir(dirname(path), { recursive: true });
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    const secret = randomToken();
    try {
      await writeFile(path, secret, { flag: 'wx', mode: 0o600 });
      return secret;
    } catch {
      return (await readFile(path, 'utf8')).trim();
    }
  }
}
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, code, message);
}
