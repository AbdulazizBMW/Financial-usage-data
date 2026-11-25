import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { getDb } from '../db.js';
import { asyncHandler, badRequest, body, str, HttpError } from '../http.js';
import {
  createSession,
  destroySession,
  ensureUserDefaults,
  hashPassword,
  logAudit,
  parseCookies,
  resolveUser,
  SESSION_COOKIE,
  sha256,
  verifyPassword,
  type UserRow
} from '../auth.js';
import { isCurrency } from '../money.js';
import { rateLimit, resetLimit } from '../ratelimit.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value: unknown): string {
  const email = str(value, 'Email', { max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest('Enter a valid email address.');
  return email;
}

function password(value: unknown, field = 'Password'): string {
  const pass = str(value, field, { max: 200, trim: false });
  if (pass.length < 8) throw badRequest(`${field} must be at least 8 characters.`);
  if (pass.length > 200) throw badRequest(`${field} is too long.`);
  return pass;
}

function recoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[raw[i] % alphabet.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

async function sendResetEmail(to: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Reset your Finora password',
        html: `<p>Use the link below to choose a new password. It expires in one hour.</p><p><a href="${link}">${link}</a></p>`
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    if (!rateLimit(`register:${req.ip}`, 10, 60 * 60 * 1000)) {
      throw new HttpError(429, 'Too many sign-up attempts. Please try again later.');
    }
    const payload = body<{ email?: string; name?: string; password?: string; baseCurrency?: string }>(req);
    const email = normalizeEmail(payload.email);
    const name = str(payload.name, 'Full name', { min: 2, max: 80 });
    const pass = password(payload.password);
    const baseCurrency = isCurrency(payload.baseCurrency) ? payload.baseCurrency : 'UZS';

    const db = await getDb();
    const existing = await db.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email]);
    if (existing.rows.length) throw new HttpError(409, 'An account with this email already exists.');

    const code = recoveryCode();
    const created = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, base_currency, recovery_hash)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [email, name, await hashPassword(pass), baseCurrency, sha256(code)]
      );
      const user = rows[0];
      await ensureUserDefaults(q, user.id, baseCurrency);
      await q.query(
        `INSERT INTO fx_rates (user_id, currency, rate, as_of)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (user_id, currency, as_of) DO NOTHING`,
        [user.id, baseCurrency === 'USD' ? 'UZS' : 'USD', baseCurrency === 'USD' ? 1 / 12800 : 12800]
      );
      await logAudit(q, user.id, 'user', user.id, 'registered', { email });
      return user;
    });

    await createSession(db, created.id, res);
    const { rows } = await db.query<UserRow>(
      `SELECT id, email, name, base_currency, theme, created_at FROM users WHERE id = $1`,
      [created.id]
    );
    res.status(201).json({ user: rows[0], recoveryCode: code });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const payload = body<{ email?: string; password?: string }>(req);
    const email = normalizeEmail(payload.email);
    const pass = str(payload.password, 'Password', { max: 200, trim: false });
    const key = `login:${req.ip}:${email}`;
    if (!rateLimit(key, 8, 15 * 60 * 1000)) {
      throw new HttpError(429, 'Too many failed sign-in attempts. Please wait 15 minutes.');
    }

    const db = await getDb();
    const { rows } = await db.query<UserRow & { password_hash: string }>(
      `SELECT id, email, name, base_currency, theme, created_at, password_hash
         FROM users WHERE lower(email) = $1`,
      [email]
    );
    const user = rows[0];
    const ok = user ? await verifyPassword(pass, user.password_hash) : false;
    if (!user || !ok) throw new HttpError(401, 'Incorrect email or password.');
    resetLimit(key);

    await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
    await createSession(db, user.id, res);
    await logAudit(db, user.id, 'user', user.id, 'login', { ip: req.ip });
    const { password_hash: _hash, ...safe } = user;
    res.json({ user: safe });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const resolved = await resolveUser(db, req);
    if (resolved) await logAudit(db, resolved.user.id, 'user', resolved.user.id, 'logout', {});
    await destroySession(db, token, res);
    res.json({ ok: true });
  })
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const resolved = await resolveUser(db, req);
    if (!resolved) throw new HttpError(401, 'Not signed in.');
    res.json({ user: resolved.user });
  })
);

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const payload = body<{ email?: string }>(req);
    const email = normalizeEmail(payload.email);
    if (!rateLimit(`forgot:${req.ip}`, 6, 60 * 60 * 1000)) {
      throw new HttpError(429, 'Too many reset requests. Please try again later.');
    }
    const db = await getDb();
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
    const mailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
    let debugToken: string | undefined;
    if (rows[0]) {
      const token = randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1,$2, now() + interval '1 hour')`,
        [rows[0].id, sha256(token)]
      );
      const host = (req.headers.origin as string) || `https://${req.headers.host}`;
      const link = `${host}/reset-password?token=${token}`;
      const sent = await sendResetEmail(email, link);
      if (!sent && process.env.PASSWORD_RESET_DEBUG === '1') debugToken = link;
      await logAudit(db, rows[0].id, 'user', rows[0].id, 'password_reset_requested', { emailed: sent });
    }
    res.json({
      ok: true,
      mailConfigured,
      message: mailConfigured
        ? 'If that email is registered, a reset link is on its way.'
        : 'Email delivery is not configured on this deployment. Use your recovery code to reset the password, or change it from Settings while signed in.',
      resetLink: debugToken
    });
  })
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const payload = body<{ token?: string; password?: string }>(req);
    const token = str(payload.token, 'Reset token', { max: 200 });
    const pass = password(payload.password, 'New password');
    const db = await getDb();
    const { rows } = await db.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_resets
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256(token)]
    );
    const reset = rows[0];
    if (!reset) throw badRequest('This reset link is invalid or has expired.');
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
        reset.user_id,
        await hashPassword(pass)
      ]);
      await q.query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [reset.id]);
      await q.query(`DELETE FROM sessions WHERE user_id = $1`, [reset.user_id]);
      await logAudit(q, reset.user_id, 'user', reset.user_id, 'password_reset_completed', {});
    });
    res.json({ ok: true });
  })
);

authRouter.post(
  '/recover',
  asyncHandler(async (req, res) => {
    const payload = body<{ email?: string; recoveryCode?: string; password?: string }>(req);
    const email = normalizeEmail(payload.email);
    const code = str(payload.recoveryCode, 'Recovery code', { max: 40 }).toUpperCase().replace(/\s/g, '');
    const pass = password(payload.password, 'New password');
    if (!rateLimit(`recover:${req.ip}`, 8, 60 * 60 * 1000)) {
      throw new HttpError(429, 'Too many recovery attempts. Please try again later.');
    }
    const db = await getDb();
    const { rows } = await db.query<{ id: string; recovery_hash: string | null }>(
      `SELECT id, recovery_hash FROM users WHERE lower(email) = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.recovery_hash || user.recovery_hash !== sha256(code)) {
      throw badRequest('Email and recovery code do not match.');
    }
    const nextCode = recoveryCode();
    await db.tx(async (q) => {
      await q.query(
        `UPDATE users SET password_hash = $2, recovery_hash = $3, updated_at = now() WHERE id = $1`,
        [user.id, await hashPassword(pass), sha256(nextCode)]
      );
      await q.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
      await logAudit(q, user.id, 'user', user.id, 'password_recovered', {});
    });
    res.json({ ok: true, recoveryCode: nextCode });
  })
);
