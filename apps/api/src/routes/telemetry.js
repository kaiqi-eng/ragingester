import express from 'express';
import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import {
  buildRssDailyStatus,
  flushRssDailyStatus,
  yesterdayUtcDate
} from '../telemetry/index.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createTelemetryRouter() {
  const router = express.Router();

  router.get('/rss-daily-status', async (req, res, next) => {
    try {
      const rawDate = req.query.date;
      const date = rawDate == null || rawDate === ''
        ? yesterdayUtcDate()
        : String(rawDate);

      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }

      const status = await buildRssDailyStatus({
        repository: getRepository(),
        date
      });
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  router.post('/rss-daily-status/emit', async (req, res, next) => {
    try {
      if (!config.telemetryDailyStatusEnabled) {
        return res.status(503).json({ error: 'telemetry daily status disabled' });
      }

      const rawDate = req.query.date;
      const date = rawDate == null || rawDate === ''
        ? yesterdayUtcDate()
        : String(rawDate);

      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }

      const result = await flushRssDailyStatus({
        repository: getRepository(),
        now: new Date(),
        forceDate: date
      });

      if (!result.posted) {
        const statusCode = result.skippedReason === 'not_configured' ? 503 : 502;
        return res.status(statusCode).json({
          posted: false,
          date: result.date,
          skippedReason: result.skippedReason || 'delivery_failed'
        });
      }

      res.json({
        posted: true,
        date: result.date,
        status: result.status
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
