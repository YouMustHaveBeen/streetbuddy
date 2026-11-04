// Messages the bot sends on its own, not as an answer to a user.
import { callTelegram } from "./api";

// Also the answer to a user who tries to start a report while the bot is off.
export const FORM_CHANGED_TEXT =
  "The Traffic Watch report form has changed, so the bot is temporarily not working. The developer has been notified";

interface NotifyEnv {
  TELEGRAM_BOT_TOKEN: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
}

// The same message goes to the closed group once and to the owner twice: the bot is already
// off and no later check repeats the alert, so a single failed request must not leave the
// owner without it.
export async function notifyFormChanged(env: NotifyEnv): Promise<void> {
  const results = await Promise.all(
    [env.OWNER_TELEGRAM_ID, env.OWNER_TELEGRAM_ID, env.GROUP_ID].map((chatId) =>
      callTelegram(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: FORM_CHANGED_TEXT }),
    ),
  );
  // The bot is already off and later checks stay silent, so an undelivered alert has to show in the log.
  // Only the count is logged: the chat ids are Telegram ids.
  const failed = results.filter((result) => result === null).length;
  if (failed > 0) console.error(`Form change alert: ${failed} of ${results.length} messages not delivered`);
}
