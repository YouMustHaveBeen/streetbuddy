// The /admin screen for the administrators of the closed group: the bot's state, the result
// of the last daily form check, the button that switches the bot on or off and the buttons of
// the feedback and the statistics, which do nothing yet.
import { disableBot, dublinDateTime, enableBot, getSwitchStatus } from "../core";
import type { FormCheckOutcome } from "../core";
import type { Env } from "../env";
import { answerButton, deleteMessage, sendMessage } from "./api";
import { stopReport } from "./stop";

type AdminEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN">;

const SWITCH_ON = "admin_on";
const SWITCH_OFF = "admin_off";
const FEEDBACK = "admin_feedback";
const STATISTICS = "admin_statistics";

const CHECK_RESULT_TEXT: Record<FormCheckOutcome, string> = {
  ok: "OK",
  changed: "form changed",
  unloaded: "page not loaded",
};

export const isAdminCommand = (text: string | undefined): boolean =>
  text !== undefined && /^\/admin(@\S+)?(\s|$)/.test(text);

export const isAdminButton = (data: string | undefined): boolean =>
  data === SWITCH_ON || data === SWITCH_OFF || data === FEEDBACK || data === STATISTICS;

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
  const text = `Admin console\nBot: ${status.enabled ? "on" : "off"}\nLast form check: ${lastCheck}`;
  return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [button],
        [
          { text: "Feedback", callback_data: FEEDBACK },
          { text: "Statistics", callback_data: STATISTICS },
        ],
      ],
    },
  });
}

// The caller has already checked that the sender is an administrator of the group.
// A report in progress is stopped without a word (see stopReport).
export async function handleAdminCommand(env: AdminEnv, userId: number, chatId: number): Promise<void> {
  await stopReport(env, userId, chatId);
  await sendScreen(env, chatId);
}

// Sets the state the button names, sends the screen again and removes the old one.
export async function handleAdminButton(
  env: AdminEnv,
  chatId: number,
  query: { id: string; data?: string; messageId?: number },
): Promise<void> {
  const answered = answerButton(env.TELEGRAM_BOT_TOKEN, query.id);
  // These two buttons only get their answer for now.
  if (query.data === FEEDBACK || query.data === STATISTICS) {
    await answered;
    return;
  }
  await (query.data === SWITCH_ON ? enableBot(env.DB) : disableBot(env.DB));
  const [messageId] = await Promise.all([sendScreen(env, chatId), answered]);
  if (messageId !== null && query.messageId !== undefined) {
    await deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, query.messageId);
  }
}
