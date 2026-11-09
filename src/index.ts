// StreetBuddy Worker entry point.
import { cleanupExpired } from "./cleanup";
import { runNightlyStats } from "./core";
import { runFormCheck } from "./dailyCheck";
import { LINK_EXPIRED_TEXT, isDirectoryLinkValid } from "./directoryLink";
import { INSTALL_PATH, SCRIPT_PATH, installPage, userscriptFile } from "./install";
import { MANUAL_PATH, manualPage } from "./manual";
import { DIRECTORY_PATH, REPORT_MAP_PATH, directoryPage, reportMapPage } from "./maps";
import { closeExpiredFinalMessages, handleWebhook, notifyInactiveUsers } from "./telegram";
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
    if (reads && url.pathname === REPORT_MAP_PATH) return reportMapPage(env, url.searchParams.get("period"));
    if (reads && url.pathname === DIRECTORY_PATH) {
      if (!(await isDirectoryLinkValid(env, url.searchParams))) return new Response(LINK_EXPIRED_TEXT, { status: 403 });
      return directoryPage(env);
    }
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
    // The statistics run in the trigger of 3:00 UTC, the form check and the notice of inactive users in the one of 6:00 UTC.
    const utcHour = new Date(event.scheduledTime).getUTCHours();
    if (utcHour === 3) {
      try {
        await runNightlyStats(env.DB, event.scheduledTime);
      } catch (error) {
        console.error("scheduled: statistics failed", error);
      }
    }
    if (utcHour === 6) {
      try {
        await runFormCheck(env);
      } catch (error) {
        console.error("scheduled: form check failed", error);
      }
      try {
        await notifyInactiveUsers(env, event.scheduledTime);
      } catch (error) {
        console.error("scheduled: inactive users notice failed", error);
      }
    }
  },
} satisfies ExportedHandler<Env>;
