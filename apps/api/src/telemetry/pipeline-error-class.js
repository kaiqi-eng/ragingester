export const PIPELINE_ERROR_CLASSES = {
  BILLING_QUOTA: 'BILLING/QUOTA',
  NETWORK_TIMEOUT: 'NETWORK/TIMEOUT',
  SCHEMA_VALIDATION: 'SCHEMA/VALIDATION',
  CONFIG_AUTH: 'CONFIG/AUTH',
  UNKNOWN: 'UNKNOWN'
};

const AUTO_ACTIONS = {
  [PIPELINE_ERROR_CLASSES.BILLING_QUOTA]:
    'No auto-retry. Check Genie-RSS / upstream billing or quota limits, then re-run the feed card.',
  [PIPELINE_ERROR_CLASSES.NETWORK_TIMEOUT]:
    'No auto-retry. Check Genie-RSS reachability and run timeout settings, then re-run the feed card.',
  [PIPELINE_ERROR_CLASSES.SCHEMA_VALIDATION]:
    'No auto-retry. Inspect feed payload / params validation, fix the card config, then re-run.',
  [PIPELINE_ERROR_CLASSES.CONFIG_AUTH]:
    'No auto-retry. Check GENIE_RSS_API_KEY / Bharag credentials and card params — token may be missing or revoked.',
  [PIPELINE_ERROR_CLASSES.UNKNOWN]:
    'No auto-retry. Inspect the error text and run logs for the feed card, then re-run after fixing the root cause.'
};

/**
 * @param {{ name?: string, message?: string, code?: string }} input
 * @returns {string}
 */
export function classifyErrorClass({ name, message, code } = {}) {
  const haystack = [name, message, code]
    .filter((part) => part != null && String(part).length > 0)
    .join(' ')
    .toLowerCase();

  if (!haystack) return PIPELINE_ERROR_CLASSES.UNKNOWN;

  if (
    /quota|billing|payment required|402\b|rate limit|too many requests|429\b/.test(haystack)
  ) {
    return PIPELINE_ERROR_CLASSES.BILLING_QUOTA;
  }

  if (
    /timed?\s*out|timeout|etimedout|econnreset|econnrefused|enotfound|network|socket hang up|fetch failed|502\b|503\b|504\b/.test(haystack)
  ) {
    return PIPELINE_ERROR_CLASSES.NETWORK_TIMEOUT;
  }

  if (
    /401\b|403\b|unauthorized|forbidden|api[_ ]?key|authentication|credential|not configured|is required/.test(haystack)
  ) {
    return PIPELINE_ERROR_CLASSES.CONFIG_AUTH;
  }

  if (
    /schema|validation|zod|invalid (json|payload|body|params)|must be/.test(haystack)
  ) {
    return PIPELINE_ERROR_CLASSES.SCHEMA_VALIDATION;
  }

  return PIPELINE_ERROR_CLASSES.UNKNOWN;
}

/**
 * @param {string} errorClass
 * @returns {string}
 */
export function autoActionForClass(errorClass) {
  return AUTO_ACTIONS[errorClass] || AUTO_ACTIONS[PIPELINE_ERROR_CLASSES.UNKNOWN];
}
