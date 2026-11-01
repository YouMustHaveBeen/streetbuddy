// StreetBuddy Worker entry point. Skeleton only: no bot logic yet.

export interface Env {
  AI: Ai;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
}

export default {
  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response("OK");
  },

  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Daily form check will go here.
  },
} satisfies ExportedHandler<Env>;
