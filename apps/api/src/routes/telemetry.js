import express from 'express';
import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import {
  TELEMETRY_SYSTEM,
  buildDailyStatus,
  emitPipelineError,
  flushDailyStatus,
  getTelemetryMetrics,
  isAllowedTelemetrySystem,
  isTelemetrySourceType,
  yesterdayUtcDate
} from '../telemetry/index.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {unknown} raw
 * @returns {string}
 */
function resolveDate(raw) {
  if (raw == null || raw === '') return yesterdayUtcDate();
  return String(raw);
}

/**
 * @param {unknown} raw
 * @param {string} [fallback]
 * @returns {string}
 */
function resolveSystem(raw, fallback = TELEMETRY_SYSTEM) {
  if (raw == null || raw === '') return fallback;
  return String(raw);
}

export function createTelemetryRouter() {
  const router = express.Router();

  router.get('/rss-daily-status', async (req, res, next) => {
    try {
      const date = resolveDate(req.query.date);
      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }

      const status = await buildDailyStatus({
        repository: getRepository(),
        date,
        system: TELEMETRY_SYSTEM
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

      const date = resolveDate(req.query.date);
      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }

      const result = await flushDailyStatus({
        repository: getRepository(),
        now: new Date(),
        forceDate: date,
        system: TELEMETRY_SYSTEM
      });

      if (!result.posted) {
        const statusCode = result.skippedReason === 'not_configured' ? 503 : 502;
        return res.status(statusCode).json({
          posted: false,
          date: result.date,
          system: result.system,
          skippedReason: result.skippedReason || 'delivery_failed'
        });
      }

      res.json({
        posted: true,
        date: result.date,
        system: result.system,
        status: result.status
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/daily-status', async (req, res, next) => {
    try {
      const date = resolveDate(req.query.date);
      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }

      const system = resolveSystem(req.query.system);
      if (!isAllowedTelemetrySystem(system)) {
        return res.status(400).json({
          error: 'system must be one of genie_rss, genie_youtube, genie_linkedin'
        });
      }

      const status = await buildDailyStatus({
        repository: getRepository(),
        date,
        system
      });
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  router.post('/daily-status/emit', async (req, res, next) => {
    try {
      if (!config.telemetryDailyStatusEnabled) {
        return res.status(503).json({ error: 'telemetry daily status disabled' });
      }

      const date = resolveDate(req.query.date);
      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }

      const system = resolveSystem(req.query.system);
      if (!isAllowedTelemetrySystem(system)) {
        return res.status(400).json({
          error: 'system must be one of genie_rss, genie_youtube, genie_linkedin'
        });
      }

      const result = await flushDailyStatus({
        repository: getRepository(),
        now: new Date(),
        forceDate: date,
        system
      });

      if (!result.posted) {
        const statusCode = result.skippedReason === 'not_configured' ? 503 : 502;
        return res.status(statusCode).json({
          posted: false,
          date: result.date,
          system: result.system,
          skippedReason: result.skippedReason || 'delivery_failed'
        });
      }

      res.json({
        posted: true,
        date: result.date,
        system: result.system,
        status: result.status
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/pipeline-error/emit', async (req, res, next) => {
    try {
      if (!config.telemetryPipelineErrorsEnabled) {
        return res.status(503).json({ error: 'telemetry pipeline errors disabled' });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const failedNode = body.failedNode;
      const errorMessage = body.error;
      if (typeof failedNode !== 'string' || failedNode.length === 0) {
        return res.status(400).json({ error: 'failedNode is required' });
      }
      if (typeof errorMessage !== 'string' || errorMessage.length === 0) {
        return res.status(400).json({ error: 'error is required' });
      }

      const sourceType = body.sourceType == null || body.sourceType === ''
        ? 'rss_feed'
        : String(body.sourceType);
      if (!isTelemetrySourceType(sourceType)) {
        return res.status(400).json({
          error: 'sourceType must be one of rss_feed, youtube, linkedin'
        });
      }

      const result = await emitPipelineError({
        failedNode,
        sourceType,
        error: {
          message: errorMessage,
          errorClass: typeof body.errorClass === 'string' ? body.errorClass : undefined
        },
        errorClass: typeof body.errorClass === 'string' ? body.errorClass : undefined,
        timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined
      });

      if (!result.posted) {
        const statusCode = result.skippedReason === 'not_configured' ? 503 : 502;
        return res.status(statusCode).json({
          posted: false,
          skippedReason: result.skippedReason || 'delivery_failed',
          payload: result.payload
        });
      }

      res.json({
        posted: true,
        payload: result.payload
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/metrics', (_req, res) => {
    res.json(getTelemetryMetrics());
  });

  return router;
}
