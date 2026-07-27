import { RUN_STATUS } from '@ragingester/shared';

/**
 * Classify a terminal (or success-with-partial-failures) run for daily ingest buckets.
 *
 * @param {{ status: string, failedCount?: number }} input
 * @returns {'ok' | 'degraded' | 'failed'}
 */
export function classifyRun({ status, failedCount = 0 }) {
  if (status === RUN_STATUS.FAILED) {
    return 'failed';
  }

  if (status === RUN_STATUS.SUCCESS) {
    return failedCount > 0 ? 'degraded' : 'ok';
  }

  throw new Error(`classifyRun expects terminal success/failed status, got: ${status}`);
}
