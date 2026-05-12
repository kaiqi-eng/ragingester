import { DEFAULT_TIMEZONE } from '@ragingester/shared';

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  genieRssBaseUrl: process.env.GENIE_RSS_BASE_URL || 'https://genie-rss-5i00.onrender.com',
  genieRssApiKey: process.env.GENIE_RSS_API_KEY || '',
  smartcursorBaseUrl: process.env.SMARTCURSOR_BASE_URL || '',
  smartcursorApiKey: process.env.SMARTCURSOR_API_KEY || '',
  bharagBaseUrl: process.env.BHARAG_BASE_URL || 'https://bharag.duckdns.org',
  bharagMasterApiKey: process.env.BHARAG_MASTER_API_KEY || '',
  bharagOwnerBuilderId: process.env.BHARAG_OWNER_BUILDER_ID || '',
  bharagOwnerName: process.env.BHARAG_OWNER_NAME || 'Ragingester RSS Owner',
  bharagOwnerEmail: process.env.BHARAG_OWNER_EMAIL || '',
  devUserId: process.env.DEV_USER_ID || 'dev-user-1',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || DEFAULT_TIMEZONE,
  schedulerPollMs: Number(process.env.SCHEDULER_POLL_MS || 15000),
  rssPrewarmWindowMs: Number(process.env.RSS_PREWARM_WINDOW_MS || 120000),
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS || 180000),
  runMaxRetries: Number(process.env.RUN_MAX_RETRIES || 1),
  alertsEnabled: String(process.env.ALERTS_ENABLED || 'false').toLowerCase() === 'true',
  alertsSlackPrimary: String(process.env.ALERTS_SLACK_PRIMARY || 'webhook').toLowerCase(),
  alertsSlackTimeoutMs: Number(process.env.ALERTS_SLACK_TIMEOUT_MS || 5000),
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  slackBotToken: process.env.SLACK_BOT_TOKEN || '',
  slackChannelId: process.env.SLACK_CHANNEL_ID || ''
};

export function hasSupabaseConfig() {
  return Boolean(config.supabaseUrl && (config.supabaseServiceRoleKey || config.supabaseAnonKey));
}
