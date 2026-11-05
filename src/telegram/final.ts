// Closing final messages that were left without Done or Cancel: the buttons and the steps go,
// the description stays.
import type { Env } from "../env";
import { callTelegram } from "./api";
import { deleteFinalMessages, FINAL_MESSAGE_TTL_MS, listExpiredFinalMessages } from "./draft";

type FinalEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN">;

// How many messages one run closes, to stay within the limit of requests of a Worker.
const CLOSE_BATCH = 30;

// A stored text is removed only after Telegram has changed its message.
export async function closeExpiredFinalMessages(env: FinalEnv, now: number = Date.now()): Promise<void> {
  const messages = await listExpiredFinalMessages(env.DB, now - FINAL_MESSAGE_TTL_MS, CLOSE_BATCH);
  const edited = await Promise.all(
    messages.map((message) =>
      callTelegram(env.TELEGRAM_BOT_TOKEN, "editMessageText", {
        chat_id: message.chat_id,
        message_id: message.message_id,
        text: message.text,
        reply_markup: { inline_keyboard: [] },
      }),
    ),
  );
  await deleteFinalMessages(
    env.DB,
    messages.filter((_, i) => edited[i] !== null),
  );
}
