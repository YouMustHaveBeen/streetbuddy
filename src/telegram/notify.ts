// Messages the bot sends on its own, not as an answer to a user.
import { callTelegram } from "./api";

// Also the answer to a user who tries to start a report while the bot is off.
export const FORM_CHANGED_TEXT =
  "The Traffic Watch report form has changed, so the bot is temporarily not working. The developer has been notified.";

interface NotifyEnv {
  TELEGRAM_BOT_TOKEN: string;
  OWNER_TELEGRAM_ID: string;
  GROUP_ID: string;
}

// The same message goes to the owner and to the closed group.
export async function notifyFormChanged(env: NotifyEnv): Promise<void> {
  await Promise.all(
    [env.OWNER_TELEGRAM_ID, env.GROUP_ID].map((chatId) =>
      callTelegram(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: FORM_CHANGED_TEXT }),
    ),
  );
}
