// Stopping a report without a word, shared by /admin and by the commands of the menu.
import type { Env } from "../env";
import { deleteMessage } from "./api";
import { deleteDraftWithButtons } from "./draft";

type StopEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN">;

// Removes the draft and the screen with its buttons; "Report cancelled" is not written.
// A report on the step that gives the link is left alone.
export async function stopReport(env: StopEnv, userId: number, chatId: number): Promise<void> {
  const buttonsMessageId = await deleteDraftWithButtons(env.DB, userId);
  if (buttonsMessageId !== null) {
    await deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, buttonsMessageId);
  }
}
