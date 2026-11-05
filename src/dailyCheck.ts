// The daily check of the Traffic Watch form, run by the scheduled handler.
import { checkForm, disableBot, recordFormCheck } from "./core";
import type { Env } from "./env";
import { notifyFormChanged } from "./telegram";

type CheckEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN" | "OWNER_TELEGRAM_ID" | "GROUP_ID">;

// When the form has changed, turns the bot off and tells the owner and the group once.
// The result is recorded last.
export async function runFormCheck(env: CheckEnv): Promise<void> {
  const result = await checkForm();
  if (!result.ok) {
    console.error(`Form check failed: ${result.reason}`);
    if (await disableBot(env.DB)) await notifyFormChanged(env);
  }
  await recordFormCheck(env.DB, Date.now(), result.ok ? "ok" : result.unloaded ? "unloaded" : "changed");
}
