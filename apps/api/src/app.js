import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authMiddleware } from './lib/auth.js';
import { createCardsRouter } from './routes/cards.js';
import { createRunsRouter } from './routes/runs.js';

export function createApp() {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  const hasWebBuild = fs.existsSync(path.join(webDistPath, 'index.html'));

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ragingester-api' });
  });

  app.use(authMiddleware);
  app.use('/cards', createCardsRouter());
  app.use('/runs', createRunsRouter());

  if (hasWebBuild) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/cards') || req.path.startsWith('/runs') || req.path === '/health') {
        return next();
      }
      return res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  app.use((error, _req, res, _next) => {
    const status = Number(error?.statusCode) || 400;
    res.status(status).json({ error: error.message || 'unexpected error' });
  });

  return app;
}
