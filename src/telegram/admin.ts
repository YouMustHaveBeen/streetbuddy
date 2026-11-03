// The /admin screen for the administrators of the closed group: the bot's state, the result
// of the last daily form check and the button that switches the bot on or off.
import { disableBot, dublinDateTime, enableBot, getSwitchStatus } from "../core";
import type { FormCheckOutcome } from "../core";
import { callTelegram } from "./api";

export interface AdminEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
}

const SWITCH_ON = "admin_on";
const SWITCH_OFF = "admin_off";

const CHECK_RESULT_TEXT: Record<FormCheckOutcome, string> = {
  ok: "OK",
  changed: "form changed",
  unloaded: "page not loaded",
};

export const isAdminCommand = (text: string | undefined): boolean =>
  text !== undefined && /^\/admin(@\S+)?(\s|$)/.test(text);

export const isAdminButton = (data: string | undefined): boolean =>
  data === SWITCH_ON || data === SWITCH_OFF;

async function sendScreen(env: AdminEnv, chatId: number): Promise<number | null> {
  const status = await getSwitchStatus(env.DB);
  let lastCheck = "none yet";
  if (status.lastCheck) {
    const moment = dublinDateTime(status.lastCheck.checkedAt);
    lastCheck = `${moment.date} ${moment.time} - ${CHECK_RESULT_TEXT[status.lastCheck.result]}`;
  }
  const button = status.enabled
    ? { text: "Switch off", callback_data: SWITCH_OFF }
    : { text: "Switch on", callback_data: SWITCH_ON };
  const sent = await callTelegram<{ message_id: number }>(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text: `Bot: ${status.enabled ? "on" : "off"}\nLast form check: ${lastCheck}`,
    reply_markup: { inline_keyboard: [[button]] },
  });
  return sent?.message_id ?? null;
}

// The caller has already checked that the sender is an administrator of the group.
export async function handleAdminCommand(env: AdminEnv, chatId: number): Promise<void> {
  await sendScreen(env, chatId);
}

// The button sets the state it names, so a button of an old screen cannot flip the bot the
// wrong way; the screen is sent again with the real state and the old one is removed.
export async function handleAdminButton(
  env: AdminEnv,
  chatId: number,
  query: { id: string; data?: string; messageId?: number },
): Promise<void> {
  await callTelegram(env.TELEGRAM_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: query.id });
  if (query.data === SWITCH_ON) {
    await enableBot(env.DB);
  } else {
    await disableBot(env.DB);
  }
  const messageId = await sendScreen(env, chatId);
  if (messageId !== null && query.messageId !== undefined) {
    await callTelegram(env.TELEGRAM_BOT_TOKEN, "deleteMessage", {
      chat_id: chatId,
      message_id: query.messageId,
    });
  }
}
