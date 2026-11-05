// Messages the bot sends on its own, not as an answer to a user.
import type { Env } from "../env";
import { sendMessage } from "./api";

// Also the answer to a user who tries to start a report while the bot is off.
export const FORM_CHANGED_TEXT =
  "The Traffic Watch report form has changed, so the bot is temporarily not working. The developer has been notified";

type NotifyEnv = Pick<Env, "TELEGRAM_BOT_TOKEN" | "OWNER_TELEGRAM_ID" | "GROUP_ID">;

// Sends the same message to the closed group once and to the owner twice.
export async function notifyFormChanged(env: NotifyEnv): Promise<void> {
  const results = await Promise.all(
    [env.OWNER_TELEGRAM_ID, env.OWNER_TELEGRAM_ID, env.GROUP_ID].map((chatId) =>
      sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, FORM_CHANGED_TEXT),
    ),
  );
  // Logs the number of undelivered messages.
  const failed = results.filter((result) => result === null).length;
  if (failed > 0) console.error(`Form change alert: ${failed} of ${results.length} messages not delivered`);
}
