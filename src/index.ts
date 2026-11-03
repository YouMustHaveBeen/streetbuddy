// StreetBuddy Worker entry point.
import { cleanupExpired } from "./cleanup";
import { handleWebhook } from "./telegram";

export interface Env {
  AI: Ai;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env, ctx);
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Runs on both cron triggers; repeating it is harmless. A failure is only logged, so
    // that other scheduled work (the form check, later) is not blocked by it.
    try {
      await cleanupExpired(env.DB);
    } catch {
      console.error("scheduled: cleanup failed");
    }
    // Daily form check will go here.
  },
} satisfies ExportedHandler<Env>;
