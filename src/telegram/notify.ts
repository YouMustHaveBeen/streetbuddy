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

interface GroupMember {
  user: { first_name: string; last_name?: string; username?: string };
}

// Tells the owner who has just become inactive: the name and the @username in the closed group.
// A user that Telegram does not give is left out; their number is logged, without the ID.
export async function notifyInactiveUsers(env: InactiveEnv, now: number): Promise<void> {
  const ids = await listInactiveUsers(env.DB, now);
  const members = await Promise.all(
    ids.map((id) =>
      callTelegram<GroupMember>(env.TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: env.GROUP_ID, user_id: id }),
    ),
  );
  const lines = members.flatMap((member) => {
    if (!member) return [];
    const { first_name, last_name, username } = member.user;
    const name = [first_name, last_name].filter(Boolean).join(" ");
    return [username ? `${name} (@${username})` : name];
  });
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
