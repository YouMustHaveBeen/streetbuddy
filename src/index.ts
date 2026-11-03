// StreetBuddy Worker entry point.
import { cleanupExpired } from "./cleanup";
import { dublinDateTime } from "./core";
import { runFormCheck } from "./dailyCheck";
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

  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Runs on both cron triggers; repeating it is harmless. A failure is only logged, so
    // that the form check below is not blocked by it.
    try {
      await cleanupExpired(env.DB);
    } catch (error) {
      console.error("scheduled: cleanup failed", error);
    }
    // The cron runs at 5:00 and 6:00 UTC (Cloudflare cron is UTC only); the form check
    // runs in the one of them that is 6:00 in Dublin, whatever the season.
    if (dublinDateTime(event.scheduledTime).time.startsWith("06:")) {
      try {
        await runFormCheck(env);
      } catch (error) {
        console.error("scheduled: form check failed", error);
      }
    }
  },
} satisfies ExportedHandler<Env>;
