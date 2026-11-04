// StreetBuddy Worker entry point.
import { cleanupExpired } from "./cleanup";
import { dublinDateTime, runNightlyStats } from "./core";
import { runFormCheck } from "./dailyCheck";
import { INSTALL_PATH, SCRIPT_PATH, installPage, userscriptFile } from "./install";
import { MANUAL_PATH, manualPage } from "./manual";
import { handleWebhook } from "./telegram";

export interface Env {
  AI: Ai;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
  SITE_URL: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env, ctx);
    }
    // HEAD is answered like GET: link checkers and previews ask for the headers only.
    const reads = request.method === "GET" || request.method === "HEAD";
    if (reads && url.pathname === INSTALL_PATH) return installPage();
    if (reads && url.pathname === MANUAL_PATH) return manualPage();
    if (reads && url.pathname === SCRIPT_PATH) return userscriptFile();
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
    // The cron runs at 2:00, 3:00, 5:00 and 6:00 UTC (Cloudflare cron is UTC only); the
    // statistics are counted in the one of the first two that is 3:00 in Dublin and the form
    // check in the one of the last two that is 6:00 in Dublin, whatever the season.
    const dublinTime = dublinDateTime(event.scheduledTime).time;
    if (dublinTime.startsWith("03:")) {
      try {
        await runNightlyStats(env.DB, event.scheduledTime);
      } catch (error) {
        console.error("scheduled: statistics failed", error);
      }
    }
    if (dublinTime.startsWith("06:")) {
      try {
        await runFormCheck(env);
      } catch (error) {
        console.error("scheduled: form check failed", error);
      }
    }
  },
} satisfies ExportedHandler<Env>;
