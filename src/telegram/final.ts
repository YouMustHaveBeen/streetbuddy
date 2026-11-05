// Closing final messages that were left without Done or Cancel: the buttons and the steps go,
// the description stays.
import type { Env } from "../env";
import { callTelegram } from "./api";
import { FINAL_MESSAGE_TTL_MS, takeChatFinalMessages, takeExpiredFinalMessages } from "./draft";
import type { OpenFinalMessage } from "./draft";

type FinalEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN">;

async function closeMessages(env: FinalEnv, messages: OpenFinalMessage[]): Promise<void> {
  await Promise.all(
    messages.map((message) =>
      callTelegram(env.TELEGRAM_BOT_TOKEN, "editMessageText", {
        chat_id: message.chat_id,
        message_id: message.message_id,
        text: message.text,
        reply_markup: { inline_keyboard: [] },
      }),
    ),
  );
}

export async function closeChatFinalMessages(env: FinalEnv, chatId: number): Promise<void> {
  await closeMessages(env, await takeChatFinalMessages(env.DB, chatId));
}

export async function closeExpiredFinalMessages(env: FinalEnv, now: number = Date.now()): Promise<void> {
  await closeMessages(env, await takeExpiredFinalMessages(env.DB, now - FINAL_MESSAGE_TTL_MS));
}
