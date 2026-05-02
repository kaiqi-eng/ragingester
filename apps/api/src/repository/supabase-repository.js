import { createClient } from '@supabase/supabase-js';
import { RUN_STATUS, TRIGGER_MODE } from '@ragingester/shared';
import { RunOverlapError } from '../lib/errors.js';

const defaultTables = {
  cards: 'cards',
  collectionRuns: 'collection_runs',
  collectedData: 'collected_data'
};

export function createSupabaseRepository({ supabaseUrl, serviceRoleKey, tables = {} }) {
  const table = { ...defaultTables, ...tables };
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  function unwrap(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  function isMissingErrorPayloadColumn(error) {
    const message = String(error?.message || '');
    return message.includes('error_payload') && message.includes('schema cache');
  }

  return {
    async listCards(ownerId) {
      return unwrap(await supabase.from(table.cards).select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }));
    },

    async getCardById(cardId, ownerId) {
      return unwrap(await supabase.from(table.cards).select('*').eq('id', cardId).eq('owner_id', ownerId).maybeSingle());
    },

    async createCard(payload) {
      return unwrap(await supabase.from(table.cards).insert(payload).select('*').single());
    },

    async findCardBySource(ownerId, sourceType, sourceInput) {
      return unwrap(
        await supabase
          .from(table.cards)
          .select('*')
          .eq('owner_id', ownerId)
          .eq('source_type', sourceType)
          .eq('source_input', String(sourceInput || '').trim())
          .limit(1)
          .maybeSingle()
      );
    },

    async updateCard(cardId, updates) {
      return unwrap(await supabase.from(table.cards).update(updates).eq('id', cardId).select('*').maybeSingle());
    },

    async deleteCard(cardId, ownerId) {
      const data = unwrap(await supabase.from(table.cards).delete().eq('id', cardId).eq('owner_id', ownerId).select('id'));
      return data.length > 0;
    },

    async listRuns(cardId, ownerId) {
      return unwrap(
        await supabase
          .from(table.collectionRuns)
          .select('*')
          .eq('card_id', cardId)
          .eq('owner_id', ownerId)
          .order('created_at', { ascending: false })
      );
    },

    async deleteRuns(cardId, ownerId) {
      const data = unwrap(
        await supabase
          .from(table.collectionRuns)
          .delete()
          .eq('card_id', cardId)
          .eq('owner_id', ownerId)
          .select('id')
      );
      return data.length;
    },

    async createRun(payload) {
      const result = await supabase.from(table.collectionRuns).insert(payload).select('*').single();
      if (
        result.error &&
        result.error.code === '23505' &&
        String(result.error.message || '').includes('one_active_run_per_card')
      ) {
        throw new RunOverlapError();
      }
      return unwrap(result);
    },

    async enqueueScheduledRun(card) {
      const result = await supabase.from(table.collectionRuns).insert({
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
      }).select('*').single();

      if (
        result.error &&
        result.error.code === '23505' &&
        String(result.error.message || '').includes('one_active_run_per_card')
      ) {
        return { run: null, enqueued: false };
      }

      return { run: unwrap(result), enqueued: true };
    },

    async claimNextScheduledRun() {
      const claimed = unwrap(await supabase.rpc('claim_next_scheduled_run'));
      if (!claimed) return null;
      return claimed;
    },

    async updateRun(runId, updates) {
      const result = await supabase.from(table.collectionRuns).update(updates).eq('id', runId).select('*').maybeSingle();
      if (result.error && updates.error_payload !== undefined && isMissingErrorPayloadColumn(result.error)) {
        const { error_payload: _drop, ...fallbackUpdates } = updates;
        return unwrap(await supabase.from(table.collectionRuns).update(fallbackUpdates).eq('id', runId).select('*').maybeSingle());
      }
      return unwrap(result);
    },

    async getRunById(runId, ownerId) {
      return unwrap(await supabase.from(table.collectionRuns).select('*').eq('id', runId).eq('owner_id', ownerId).maybeSingle());
    },

    async getActiveRunForCard(cardId) {
      return unwrap(
        await supabase.from(table.collectionRuns).select('*').eq('card_id', cardId).eq('status', 'running').limit(1).maybeSingle()
      );
    },

    async listDueCards(atIso) {
      return unwrap(
        await supabase
          .from(table.cards)
          .select('*')
          .eq('active', true)
          .eq('schedule_enabled', true)
          .not('next_run_at', 'is', null)
          .lte('next_run_at', atIso)
      );
    },

    async listPrewarmCards(fromIso, toIso) {
      return unwrap(
        await supabase
          .from(table.cards)
          .select('*')
          .eq('active', true)
          .eq('schedule_enabled', true)
          .eq('source_type', 'rss_feed')
          .not('next_run_at', 'is', null)
          .gte('next_run_at', fromIso)
          .lte('next_run_at', toIso)
      );
    },

    async createCollectedData(payload) {
      return unwrap(await supabase.from(table.collectedData).insert(payload).select('*').single());
    }
  };
}
