import { randomUUID } from 'node:crypto';
import { RUN_STATUS, TRIGGER_MODE } from '@ragingester/shared';
import { RunOverlapError } from '../lib/errors.js';

function sortDescByDate(items, key) {
  return [...items].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
}

export function createMemoryRepository() {
  const store = {
    cards: new Map(),
    runs: new Map(),
    collectedData: new Map()
  };

  return {
    async listCards(ownerId) {
      return [...store.cards.values()].filter((c) => c.owner_id === ownerId);
    },

    async getCardById(cardId, ownerId) {
      const card = store.cards.get(cardId);
      if (!card || card.owner_id !== ownerId) return null;
      return card;
    },

    async createCard(payload) {
      const now = new Date().toISOString();
      const card = {
        id: randomUUID(),
        created_at: now,
        updated_at: now,
        ...payload,
        params: payload.params || {}
      };
      store.cards.set(card.id, card);
      return card;
    },

    async findCardBySource(ownerId, sourceType, sourceInput) {
      const normalizedSourceInput = String(sourceInput || '').trim();
      return [...store.cards.values()].find((card) => (
        card.owner_id === ownerId
        && card.source_type === sourceType
        && String(card.source_input || '').trim() === normalizedSourceInput
      )) || null;
    },

    async updateCard(cardId, updates) {
      const existing = store.cards.get(cardId);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString()
      };
      store.cards.set(cardId, updated);
      return updated;
    },

    async deleteCard(cardId, ownerId) {
      const card = store.cards.get(cardId);
      if (!card || card.owner_id !== ownerId) return false;
      store.cards.delete(cardId);
      return true;
    },

    async listRuns(cardId, ownerId) {
      const runs = [...store.runs.values()].filter((run) => run.card_id === cardId && run.owner_id === ownerId);
      return sortDescByDate(runs, 'created_at');
    },

    async listAllRuns(ownerId) {
      const runs = [...store.runs.values()].filter((run) => run.owner_id === ownerId);
      return sortDescByDate(runs, 'created_at');
    },

    async deleteRuns(cardId, ownerId) {
      let deleted = 0;
      for (const [runId, run] of store.runs.entries()) {
        if (run.card_id === cardId && run.owner_id === ownerId) {
          store.runs.delete(runId);
          deleted += 1;
        }
      }
      return deleted;
    },

    async createRun(payload) {
      const isActiveStatus = payload.status === RUN_STATUS.PENDING || payload.status === RUN_STATUS.RUNNING;
      if (isActiveStatus) {
        const existingActiveRun = [...store.runs.values()].find(
          (run) => run.card_id === payload.card_id && (run.status === RUN_STATUS.PENDING || run.status === RUN_STATUS.RUNNING)
        );
        if (existingActiveRun) {
          throw new RunOverlapError();
        }
      }

      const run = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        ...payload
      };
      store.runs.set(run.id, run);
      return run;
    },

    async enqueueScheduledRun(card) {
      const existingActiveRun = [...store.runs.values()].find(
        (run) => run.card_id === card.id && (run.status === RUN_STATUS.PENDING || run.status === RUN_STATUS.RUNNING)
      );
      if (existingActiveRun) {
        return { run: existingActiveRun, enqueued: false };
      }

      const run = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        card_id: card.id,
        owner_id: card.owner_id,
        status: RUN_STATUS.PENDING,
        trigger_mode: TRIGGER_MODE.SCHEDULED,
        attempts: 0,
        started_at: null,
        ended_at: null,
        error: null,
        error_payload: null,
        logs: []
      };
      store.runs.set(run.id, run);
      return { run, enqueued: true };
    },

    async claimNextScheduledRun() {
      const runningScheduledRun = [...store.runs.values()].find(
        (run) => run.status === RUN_STATUS.RUNNING && run.trigger_mode === TRIGGER_MODE.SCHEDULED
      );
      if (runningScheduledRun) return null;

      const pendingScheduledRuns = [...store.runs.values()]
        .filter((run) => run.status === RUN_STATUS.PENDING && run.trigger_mode === TRIGGER_MODE.SCHEDULED)
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      const run = pendingScheduledRuns[0];
      if (!run) return null;

      const card = store.cards.get(run.card_id);
      if (!card) return null;

      const claimedRun = {
        ...run,
        status: RUN_STATUS.RUNNING
      };
      store.runs.set(run.id, claimedRun);
      return { run: claimedRun, card };
    },

    async updateRun(runId, updates) {
      const existing = store.runs.get(runId);
      if (!existing) return null;
      const run = { ...existing, ...updates };
      store.runs.set(runId, run);
      return run;
    },

    async getRunById(runId, ownerId) {
      const run = store.runs.get(runId);
      if (!run || run.owner_id !== ownerId) return null;
      return run;
    },

    async getActiveRunForCard(cardId) {
      return [...store.runs.values()].find((run) => run.card_id === cardId && run.status === 'running') || null;
    },

    async listDueCards(atIso) {
      const now = new Date(atIso || new Date().toISOString()).getTime();
      return [...store.cards.values()].filter((card) => {
        if (!card.active || !card.schedule_enabled || !card.next_run_at) return false;
        return new Date(card.next_run_at).getTime() <= now;
      });
    },

    async listPrewarmCards(fromIso, toIso) {
      const from = new Date(fromIso || new Date().toISOString()).getTime();
      const to = new Date(toIso || new Date().toISOString()).getTime();

      return [...store.cards.values()].filter((card) => {
        if (!card.active || !card.schedule_enabled || card.source_type !== 'rss_feed' || !card.next_run_at) return false;
        const nextRunTs = new Date(card.next_run_at).getTime();
        return nextRunTs >= from && nextRunTs <= to;
      });
    },

    async createCollectedData(payload) {
      const row = { id: randomUUID(), created_at: new Date().toISOString(), ...payload };
      store.collectedData.set(row.id, row);
      return row;
    }
  };
}
