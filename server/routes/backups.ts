import { Router } from 'express';
import { getAuth, logAudit } from '../auth.js';
import { asyncHandler, badRequest, notFound, str } from '../http.js';
import { backupCounts, collectUserBackup, restoreUserBackup, type BackupPayload } from '../backup.js';

export const backupsRouter = Router();

const MANUAL_KEEP = 20;
const AUTO_KEEP = 14;
const AUTO_MAX_AGE_DAYS = 30;

export async function createBackup(db: import('../db.js').Db, userId: string, kind: 'auto' | 'manual') {
  const payload = await collectUserBackup(db, userId);
  const counts = backupCounts(payload);
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const inserted = await db.query<{ id: string; created_at: string }>(
    `INSERT INTO backups (user_id, kind, payload, record_counts, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [userId, kind, JSON.stringify(payload), JSON.stringify(counts), size]
  );
  await pruneBackups(db, userId);
  return { id: inserted.rows[0].id, createdAt: inserted.rows[0].created_at, counts, sizeBytes: size, kind };
}

export async function pruneBackups(db: import('../db.js').Db, userId: string) {
  await db.query(
    `DELETE FROM backups WHERE user_id = $1 AND id IN (
       SELECT id FROM backups WHERE user_id = $1 AND kind = 'manual' ORDER BY created_at DESC OFFSET $2
     )`,
    [userId, MANUAL_KEEP]
  );
  await db.query(
    `DELETE FROM backups WHERE user_id = $1 AND kind = 'auto' AND (created_at < now() - ($2 || ' days')::interval OR id IN (
       SELECT id FROM backups WHERE user_id = $1 AND kind = 'auto' ORDER BY created_at DESC OFFSET $3
     ))`,
    [userId, String(AUTO_MAX_AGE_DAYS), AUTO_KEEP]
  );
}

/** Creates at most one automatic backup per 24h for a user (idempotent, safe on restart). */
export async function maybeAutoBackup(db: import('../db.js').Db, userId: string) {
  const last = await db.query<{ created_at: string }>(
    `SELECT created_at FROM backups WHERE user_id = $1 AND kind = 'auto' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const lastAt = last.rows[0] ? new Date(last.rows[0].created_at).getTime() : 0;
  if (Date.now() - lastAt < 24 * 60 * 60 * 1000) return null;
  return createBackup(db, userId, 'auto');
}

export async function runScheduledBackups(db: import('../db.js').Db) {
  const users = await db.query<{ id: string }>(`SELECT id FROM users`);
  for (const user of users.rows) {
    try {
      await maybeAutoBackup(db, user.id);
    } catch (error) {
      console.error('[backup] automatic backup failed for user', user.id, (error as Error).message);
    }
  }
}

backupsRouter.get(
  '/backups',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const rows = await db.query<{
      id: string;
      kind: string;
      record_counts: Record<string, number>;
      size_bytes: string;
      created_at: string;
    }>(`SELECT id, kind, record_counts, size_bytes, created_at FROM backups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [
      user.id
    ]);
    const latest = rows.rows[0];
    res.json({
      backups: rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        counts: r.record_counts,
        sizeKb: (Number(r.size_bytes) / 1024).toFixed(1),
        createdAt: r.created_at
      })),
      retention: {
        automatic: `Daily, kept for ${AUTO_MAX_AGE_DAYS} days (last ${AUTO_KEEP} copies)`,
        manual: `Last ${MANUAL_KEEP} manual backups are kept`
      },
      lastBackupAt: latest ? latest.created_at : null
    });
  })
);

backupsRouter.post(
  '/backups',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const backup = await createBackup(db, user.id, 'manual');
    await logAudit(db, user.id, 'backup', backup.id, 'backup.create', { counts: backup.counts });
    res.status(201).json({ backup });
  })
);

backupsRouter.get(
  '/backups/:id/download',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = str(req.params.id, 'Backup id', { max: 64 });
    const row = await db.query<{ payload: BackupPayload; created_at: string | Date }>(
      `SELECT payload, created_at FROM backups WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );
    if (!row.rows[0]) throw notFound('Backup not found.');
    const createdAt = row.rows[0].created_at;
    const stamp = (createdAt instanceof Date ? createdAt.toISOString() : String(createdAt)).slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finora-backup-${stamp}.json"`);
    res.end(JSON.stringify(row.rows[0].payload, null, 2));
  })
);

backupsRouter.delete(
  '/backups/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = str(req.params.id, 'Backup id', { max: 64 });
    const deleted = await db.query(`DELETE FROM backups WHERE id = $1 AND user_id = $2 RETURNING id`, [id, user.id]);
    if (!deleted.rows.length) throw notFound('Backup not found.');
    res.json({ ok: true });
  })
);

backupsRouter.post(
  '/backups/restore',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const body = req.body ?? {};
    if (body.confirm !== true) {
      throw badRequest('Restoring replaces all of your current records. Send confirm: true to proceed.');
    }

    let payload: BackupPayload;
    if (body.backupId) {
      const row = await db.query<{ payload: BackupPayload }>(`SELECT payload FROM backups WHERE id = $1 AND user_id = $2`, [
        str(body.backupId, 'Backup id', { max: 64 }),
        user.id
      ]);
      if (!row.rows[0]) throw notFound('Backup not found.');
      payload = row.rows[0].payload;
    } else if (body.payload && typeof body.payload === 'object') {
      payload = body.payload as BackupPayload;
    } else {
      throw badRequest('Provide a backupId or a backup payload.');
    }

    if (payload.app !== 'finora' || !Array.isArray(payload.accounts) || !Array.isArray(payload.transactions)) {
      throw badRequest('This file is not a valid Finora backup.');
    }

    // Always keep a safety copy of the current state before replacing it.
    await createBackup(db, user.id, 'manual');

    await db.tx(async (tx) => {
      const counts = await restoreUserBackup(tx, user.id, payload);
      await logAudit(tx, user.id, 'backup', null, 'backup.restore', counts);
    });

    const after = await db.query<{ accounts: string; transactions: string; loans: string }>(
      `SELECT (SELECT COUNT(*) FROM accounts WHERE user_id = $1) AS accounts,
              (SELECT COUNT(*) FROM transactions WHERE user_id = $1) AS transactions,
              (SELECT COUNT(*) FROM loans WHERE user_id = $1) AS loans`,
      [user.id]
    );
    res.json({
      ok: true,
      restored: {
        accounts: Number(after.rows[0]?.accounts ?? 0),
        transactions: Number(after.rows[0]?.transactions ?? 0),
        loans: Number(after.rows[0]?.loans ?? 0)
      }
    });
  })
);
