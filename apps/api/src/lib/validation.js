import { z } from 'zod';
import { SOURCE_TYPES } from '@ragingester/shared';
import { computeNextRun, computeNextRuns } from './cron.js';

const timezoneSchema = z.string().min(3);
const optionalNullableInteger = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.number().int().nullable()
);

const cardInputSchema = z.object({
  source_type: z.enum([
    SOURCE_TYPES.HTTP_API,
    SOURCE_TYPES.WEBSITE_URL,
    SOURCE_TYPES.RSS_FEED,
    SOURCE_TYPES.IDENTIFIER_BASED,
    SOURCE_TYPES.YOUTUBE
  ]),
  source_input: z.string().min(1),
  params: z.record(z.any()).default({}),
  schedule_enabled: z.boolean().default(false),
  cron_expression: z.string().nullable().optional(),
  timezone: timezoneSchema.optional(),
  active: z.boolean().default(true),
  run_timeout_ms: optionalNullableInteger,
  run_max_retries: optionalNullableInteger
});

export function validateCardPayload(input, defaultTimezone) {
  const parsed = cardInputSchema.parse(input);

  const timezone = parsed.timezone || defaultTimezone;
  let nextRunAt = null;

  if (parsed.schedule_enabled) {
    if (!parsed.cron_expression) {
      throw new Error('cron_expression is required when schedule_enabled is true');
    }
    computeNextRuns(parsed.cron_expression, timezone, 1);
    nextRunAt = computeNextRun(parsed.cron_expression, timezone);
  }

  if (parsed.run_timeout_ms != null && (parsed.run_timeout_ms < 1000 || parsed.run_timeout_ms > 300000)) {
    throw new Error('run_timeout_ms must be between 1000 and 300000');
  }

  if (parsed.run_max_retries != null && (parsed.run_max_retries < 0 || parsed.run_max_retries > 5)) {
    throw new Error('run_max_retries must be between 0 and 5');
  }

  return {
    ...parsed,
    timezone,
    cron_expression: parsed.schedule_enabled ? parsed.cron_expression : null,
    next_run_at: parsed.schedule_enabled ? nextRunAt : null,
    run_timeout_ms: parsed.run_timeout_ms ?? null,
    run_max_retries: parsed.run_max_retries ?? null
  };
}

export function validateSchedulePreview(cronExpression, timezone) {
  if (!cronExpression) {
    throw new Error('cron_expression is required');
  }
  if (!timezone) {
    throw new Error('timezone is required');
  }
  return computeNextRuns(cronExpression, timezone, 5);
}
