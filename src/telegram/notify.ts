// Messages the bot sends on its own, not as an answer to a user.
import type { Env } from "../env";
import { callTelegram, sendMessage } from "./api";
import { INACTIVE_DAYS, listInactiveUsers } from "./phone";

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

const INACTIVE_HEADER = `Inactive for ${INACTIVE_DAYS} days, their Telegram ID is deleted in a week`;
// Telegram takes a message of up to 4096 characters.
const MESSAGE_MAX_LENGTH = 4096;

type InactiveEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN" | "OWNER_TELEGRAM_ID" | "GROUP_ID">;

export interface TelegramUser {
  first_name: string;
  last_name?: string;
  username?: string;
}

export const fullName = (user: TelegramUser): string => [user.first_name, user.last_name].filter(Boolean).join(" ");

// Shown where Telegram does not give the user.
export const UNKNOWN_USER = "unknown user";

// The name and the @username without brackets, or only the name when there is no @username.
export const userTag = (user: TelegramUser): string =>
  user.username ? `${fullName(user)} @${user.username}` : fullName(user);

// The user as Telegram gives it for a member of the closed group; null when Telegram does not give the user.
export async function groupMemberUser(
  env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "GROUP_ID">,
  userId: number,
): Promise<TelegramUser | null> {
  const member = await callTelegram<{ user: TelegramUser }>(env.TELEGRAM_BOT_TOKEN, "getChatMember", {
    chat_id: env.GROUP_ID,
    user_id: userId,
  });
  return member?.user ?? null;
}

// The name and the @username of a member of the closed group as Telegram gives them, or only the name
// when there is no @username; null when Telegram does not give the user.
export async function groupMemberLabel(
  env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "GROUP_ID">,
  userId: number,
): Promise<string | null> {
  const user = await groupMemberUser(env, userId);
  if (!user) return null;
  const name = fullName(user);
  return user.username ? `${name} (@${user.username})` : name;
}

// Tells the owner who has just become inactive: the name and the @username in the closed group.
// A user that Telegram does not give is left out; their number is logged, without the ID.
export async function notifyInactiveUsers(env: InactiveEnv, now: number): Promise<void> {
  const ids = await listInactiveUsers(env.DB, now);
  const labels = await Promise.all(ids.map((id) => groupMemberLabel(env, id)));
  const lines = labels.filter((label): label is string => label !== null);
  if (lines.length < ids.length) console.error(`Inactive users: ${ids.length - lines.length} of ${ids.length} not found`);
  if (lines.length === 0) return;

  // A list that does not fit in one message goes in several, each with the header.
  const messages: string[] = [];
  let text = INACTIVE_HEADER;
  for (const line of lines) {
    if (text.length + 1 + line.length > MESSAGE_MAX_LENGTH) {
      messages.push(text);
      text = INACTIVE_HEADER;
    }
    text += `\n${line}`;
  }
  messages.push(text);
  for (const message of messages) await sendMessage(env.TELEGRAM_BOT_TOKEN, env.OWNER_TELEGRAM_ID, message);
}
