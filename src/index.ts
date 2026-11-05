// StreetBuddy Worker entry point.
import { cleanupExpired } from "./cleanup";
import { dublinDateTime, runNightlyStats } from "./core";
import { runFormCheck } from "./dailyCheck";
import { INSTALL_PATH, SCRIPT_PATH, installPage, userscriptFile } from "./install";
import { MANUAL_PATH, manualPage } from "./manual";
import { closeExpiredFinalMessages, handleWebhook } from "./telegram";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env, ctx);
    }
    // HEAD is answered like GET.
    const reads = request.method === "GET" || request.method === "HEAD";
    if (reads && url.pathname === INSTALL_PATH) return installPage();
    if (reads && url.pathname === MANUAL_PATH) return manualPage();
    if (reads && url.pathname === SCRIPT_PATH) return userscriptFile();
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Runs on every cron trigger. A failure of any job here is only logged and the next job still runs.
    try {
      await closeExpiredFinalMessages(env);
    } catch (error) {
      console.error("scheduled: closing final messages failed", error);
    }
    try {
      await cleanupExpired(env.DB);
    } catch (error) {
      console.error("scheduled: cleanup failed", error);
    }
    // The statistics run in the trigger that is 3:00 in Dublin, the form check in the one that is 6:00.
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
