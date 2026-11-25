import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from './db.js';
import { authMiddleware } from './auth.js';
import { HttpError } from './http.js';
import { authRouter } from './routes/auth-routes.js';
import { coreRouter } from './routes/core.js';
import { loansRouter } from './routes/loans.js';
import { reportsRouter } from './routes/reports.js';
import { backupsRouter, runScheduledBackups } from './routes/backups.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../client');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = '0.0.0.0';

export async function createApp() {
  const db = await getDb();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'"
    );
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, database: db.kind, durable: db.durable, time: new Date().toISOString() });
    } catch (error) {
      res.status(503).json({ ok: false, error: (error as Error).message });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api', authMiddleware(db), coreRouter, loansRouter, reportsRouter, backupsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
  });

  if (fs.existsSync(clientDir)) {
    app.use(
      express.static(clientDir, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        }
      })
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.use((_req, res) => res.status(503).send('Client build not found. Run "npm run build".'));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const err = error as { type?: string; message?: string };
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That file is too large. Backups must be under 25 MB.' });
      return;
    }
    console.error('[server] unhandled error:', (error as Error)?.stack ?? err?.message ?? error);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return { app, db };
}

async function main() {
  const { app, db } = await createApp();
  const server = app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT} (db=${db.kind})`);
  });

  const runBackups = () => {
    runScheduledBackups(db).catch((error) => console.error('[backup] scheduler error:', (error as Error).message));
  };
  const firstBackup = setTimeout(runBackups, 20_000);
  const interval = setInterval(runBackups, 6 * 60 * 60 * 1000);

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    clearTimeout(firstBackup);
    clearInterval(interval);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[server] failed to start:', error);
    process.exit(1);
  });
}
