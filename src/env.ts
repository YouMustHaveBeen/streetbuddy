// Bindings, secrets and variables of the Worker; each module picks the ones it uses.
export interface Env {
  AI: Ai;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
  SITE_URL: string;
  MAPBOX_TOKEN: string;
}
