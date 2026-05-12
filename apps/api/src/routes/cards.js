import express from 'express';
import { TRIGGER_MODE } from '@ragingester/shared';
import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import { validateCardPayload, validateSchedulePreview } from '../lib/validation.js';
import { executeRun } from '../lib/run-engine.js';
import { cardsToCsv, csvToCardInputs } from '../lib/cards-csv.js';
import { validateRssSourceBeforeCardCreation, validateRssSourcesBeforeCardCreation } from '../lib/rss-source-check.js';
import { SourceCheckError } from '../lib/errors.js';

export function createCardsRouter() {
  const router = express.Router();
  const repository = getRepository();

  async function assertRssSourceCheck(payload) {
    if (payload.source_type !== 'rss_feed') return;

    try {
      await validateRssSourceBeforeCardCreation({
        sourceInput: payload.source_input,
        params: payload.params
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SourceCheckError(`RSS source check failed: ${message}`);
    }
  }

  router.get('/', async (req, res, next) => {
    try {
      const cards = await repository.listCards(req.user.id);
      res.json(cards);
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const payload = validateCardPayload(req.body, config.defaultTimezone);
      await assertRssSourceCheck(payload);
      const card = await repository.createCard({ ...payload, owner_id: req.user.id });
      res.status(201).json(card);
    } catch (error) {
      next(error);
    }
  });

  router.get('/export.csv', async (req, res, next) => {
    try {
      const cards = await repository.listCards(req.user.id);
      const csv = cardsToCsv(cards);
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="cards-export.csv"');
      res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  });

  router.post('/import.csv', express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), async (req, res, next) => {
    try {
      const rows = csvToCardInputs(req.body);
      let created = 0;
      let skippedDuplicates = 0;
      const errors = [];
      const pending = [];

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        try {
          const payload = validateCardPayload(row, config.defaultTimezone);
          const existing = await repository.findCardBySource(req.user.id, payload.source_type, payload.source_input);
          if (existing) {
            skippedDuplicates += 1;
            continue;
          }
          pending.push({ rowNumber: i + 2, payload });
        } catch (error) {
          errors.push({
            row: i + 2,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const rssChecks = await validateRssSourcesBeforeCardCreation({
        items: pending
          .filter((item) => item.payload.source_type === 'rss_feed')
          .map((item) => ({
            sourceInput: item.payload.source_input,
            params: item.payload.params,
            meta: { rowNumber: item.rowNumber }
          }))
      });
      const rssErrorsByRow = new Map(
        rssChecks
          .filter((result) => !result.ok)
          .map((result) => [result.meta.rowNumber, result.error])
      );

      for (const item of pending) {
        try {
          if (item.payload.source_type === 'rss_feed') {
            const rssError = rssErrorsByRow.get(item.rowNumber);
            if (rssError) {
              throw new SourceCheckError(`RSS source check failed: ${rssError}`);
            }
          }
          await repository.createCard({ ...item.payload, owner_id: req.user.id });
          created += 1;
        } catch (error) {
          errors.push({
            row: item.rowNumber,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      res.status(200).json({
        total_rows: rows.length,
        created,
        skipped_duplicates: skippedDuplicates,
        errors
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/stress-test/schedule', async (req, res, next) => {
    try {
      const cards = await repository.listCards(req.user.id);
      let enqueued = 0;
      let skipped = 0;

      for (const card of cards) {
        const result = await repository.enqueueScheduledRun(card);
        if (result?.enqueued) {
          enqueued += 1;
        } else {
          skipped += 1;
        }
      }

      res.status(202).json({
        total: cards.length,
        enqueued,
        skipped
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/bulk/deactivate', async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length === 0) {
        return res.status(400).json({ error: 'ids must be a non-empty array' });
      }

      let updated = 0;
      let skipped = 0;

      for (const id of ids) {
        const card = await repository.getCardById(id, req.user.id);
        if (!card) {
          skipped += 1;
          continue;
        }
        await repository.updateCard(id, { active: false });
        updated += 1;
      }

      res.status(200).json({ requested: ids.length, updated, skipped });
    } catch (error) {
      next(error);
    }
  });

  router.post('/bulk/delete', async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length === 0) {
        return res.status(400).json({ error: 'ids must be a non-empty array' });
      }

      let deleted = 0;
      let skipped = 0;

      for (const id of ids) {
        const didDelete = await repository.deleteCard(id, req.user.id);
        if (didDelete) {
          deleted += 1;
        } else {
          skipped += 1;
        }
      }

      res.status(200).json({ requested: ids.length, deleted, skipped });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const existing = await repository.getCardById(req.params.id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'card not found' });

      const payload = validateCardPayload({ ...existing, ...req.body }, config.defaultTimezone);
      const updated = await repository.updateCard(req.params.id, payload);
      if (!updated) return res.status(404).json({ error: 'card not found' });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const card = await repository.getCardById(req.params.id, req.user.id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      res.json(card);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const deleted = await repository.deleteCard(req.params.id, req.user.id);
      if (!deleted) return res.status(404).json({ error: 'card not found' });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/run', async (req, res, next) => {
    try {
      const card = await repository.getCardById(req.params.id, req.user.id);
      if (!card) return res.status(404).json({ error: 'card not found' });

      const activeRun = await repository.getActiveRunForCard(card.id);
      if (activeRun) {
        return res.status(409).json({ error: 'card already has an active run' });
      }

      const run = await executeRun({
        repository,
        card,
        triggerMode: TRIGGER_MODE.MANUAL,
        timeoutMs: config.runTimeoutMs,
        maxRetries: config.runMaxRetries
      });
      res.status(202).json(run);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/runs', async (req, res, next) => {
    try {
      const card = await repository.getCardById(req.params.id, req.user.id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      const runs = await repository.listRuns(req.params.id, req.user.id);
      res.json(runs);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id/runs', async (req, res, next) => {
    try {
      const card = await repository.getCardById(req.params.id, req.user.id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      const deleted = await repository.deleteRuns(req.params.id, req.user.id);
      res.status(200).json({ deleted });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/schedule/preview', async (req, res, next) => {
    try {
      const card = await repository.getCardById(req.params.id, req.user.id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      const runs = validateSchedulePreview(card.cron_expression, card.timezone);
      res.json({ next_runs: runs });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
