// The daily check of the Traffic Watch form, run by the scheduled handler.
import { checkForm, disableBot, recordFormCheck } from "./core";
import { notifyFormChanged } from "./telegram";

interface CheckEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
}

// When the form has changed, the bot is turned off and the owner and the group are told once;
// while it stays off, later checks say nothing. The bot is turned on again from /admin.
// The result is recorded last, so that it can never hold up turning the bot off.
export async function runFormCheck(env: CheckEnv): Promise<void> {
  const result = await checkForm();
  if (!result.ok) {
    // The reason names a field or a list, never personal data.
    console.error(`Form check failed: ${result.reason}`);
    if (await disableBot(env.DB)) await notifyFormChanged(env);
  }
  await recordFormCheck(env.DB, Date.now(), result.ok ? "ok" : result.unloaded ? "unloaded" : "changed");
}
