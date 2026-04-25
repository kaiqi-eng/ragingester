import { createClient } from '@supabase/supabase-js';

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

    async createRun(payload) {
      return unwrap(await supabase.from(table.collectionRuns).insert(payload).select('*').single());
    },

    async updateRun(runId, updates) {
      return unwrap(await supabase.from(table.collectionRuns).update(updates).eq('id', runId).select('*').maybeSingle());
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
