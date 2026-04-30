import { randomUUID } from 'node:crypto';
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

    async createRun(payload) {
      const isActiveStatus = payload.status === 'pending' || payload.status === 'running';
      if (isActiveStatus) {
        const existingActiveRun = [...store.runs.values()].find(
          (run) => run.card_id === payload.card_id && (run.status === 'pending' || run.status === 'running')
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
