import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Db, Queryable } from './db.js';
import { unauthorized } from './http.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export const SESSION_COOKIE = 'finora_session';
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  email: string;
  name: string;
  base_currency: string;
  theme: string;
  created_at: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function cookieAttributes(maxAgeSeconds: number): string {
  const secure = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res: Response, token: string, maxAgeSeconds: number) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(maxAgeSeconds)}`);
}

export function clearSessionCookie(res: Response) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

export async function createSession(db: Db, userId: string, res: Response): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, sha256(token), expiresAt]
  );
  setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
}

export async function destroySession(db: Db, token: string | undefined, res: Response): Promise<void> {
  if (token) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  clearSessionCookie(res);
}

export interface AuthContext {
  db: Db;
  user: UserRow;
  token: string;
}

export async function resolveUser(db: Db, req: Request): Promise<{ user: UserRow; token: string } | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await db.query<UserRow & { expires_at: string; last_seen_at: string }>(
    `SELECT u.id, u.email, u.name, u.base_currency, u.theme, u.created_at, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [sha256(token)]
  );
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    return null;
  }
  // Sliding expiration: refresh at most once per hour.
  if (now - new Date(row.last_seen_at).getTime() > 60 * 60 * 1000) {
    await db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1`, [
      sha256(token),
      new Date(now + SESSION_TTL_MS).toISOString()
    ]);
  }
  const { expires_at: _expires, last_seen_at: _seen, ...user } = row;
  return { user, token };
}

export function authMiddleware(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = await resolveUser(db, req);
      if (!resolved) {
        res.status(401).json({ error: 'You must sign in to continue.' });
        return;
      }
      (req as Request & { auth: AuthContext }).auth = { db, user: resolved.user, token: resolved.token };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function getAuth(req: Request): AuthContext {
  const auth = (req as Request & { auth?: AuthContext }).auth;
  if (!auth) throw unauthorized();
  return auth;
}

export async function logAudit(
  q: Queryable,
  userId: string,
  entity: string,
  entityId: string | null,
  action: string,
  detail: Record<string, unknown> = {}
) {
  await q.query(`INSERT INTO audit_log (user_id, entity, entity_id, action, detail) VALUES ($1,$2,$3,$4,$5)`, [
    userId,
    entity,
    entityId,
    action,
    JSON.stringify(detail)
  ]);
}

export const DEFAULT_INCOME_CATEGORIES = [
  'Salary',
  'Business Income',
  'Freelance',
  'Investment Income',
  'Other Income'
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food',
  'Transportation',
  'Housing',
  'Education',
  'Health',
  'Shopping',
  'Entertainment',
  'Family',
  'Utilities',
  'Debt Repayment',
  'Other Expenses'
];

/** Creates the starter categories and a first cash account for a new user. */
export async function ensureUserDefaults(q: Queryable, userId: string, baseCurrency: string) {
  for (const name of DEFAULT_INCOME_CATEGORIES) {
    await q.query(
      `INSERT INTO categories (user_id, name, kind) VALUES ($1,$2,'income')
       ON CONFLICT DO NOTHING`,
      [userId, name]
    );
  }
  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    await q.query(
      `INSERT INTO categories (user_id, name, kind) VALUES ($1,$2,'expense')
       ON CONFLICT DO NOTHING`,
      [userId, name]
    );
  }
  const existing = await q.query(`SELECT 1 FROM accounts WHERE user_id = $1 LIMIT 1`, [userId]);
  if (existing.rows.length === 0) {
    await q.query(
      `INSERT INTO accounts (user_id, name, type, currency, opening_balance) VALUES ($1,'Cash','cash',$2,0)`,
      [userId, baseCurrency]
    );
  }
}
