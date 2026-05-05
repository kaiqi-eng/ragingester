import express from 'express';
import { getRepository } from '../repository/index.js';

export function createRunsRouter() {
  const router = express.Router();
  const repository = getRepository();

  router.get('/', async (req, res, next) => {
    try {
      const runs = await repository.listAllRuns(req.user.id);
      res.json(runs);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const run = await repository.getRunById(req.params.id, req.user.id);
      if (!run) return res.status(404).json({ error: 'run not found' });
      res.json(run);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
