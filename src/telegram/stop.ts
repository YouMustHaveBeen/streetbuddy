// Stopping a report without a word, shared by /admin and by the commands of the menu.
import { callTelegram } from "./api";
import { deleteDraftWithButtons } from "./draft";

interface StopEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
}

// The draft and the screen with its buttons are removed and "Report cancelled" is not written,
// so that no report buttons stay in the middle of the conversation. While the link is being
// given the report is left alone: that step has no buttons and finishes by itself.
export async function stopReport(env: StopEnv, userId: number, chatId: number): Promise<void> {
  const buttonsMessageId = await deleteDraftWithButtons(env.DB, userId);
  if (buttonsMessageId !== null) {
    await callTelegram(env.TELEGRAM_BOT_TOKEN, "deleteMessage", {
      chat_id: chatId,
      message_id: buttonsMessageId,
    });
  }
}
