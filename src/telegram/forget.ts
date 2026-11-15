// /forget_me: the data the bot keeps about a user is deleted, and the user is removed from the group.
import type { Env } from "../env";
import { callTelegram } from "./api";

type ForgetEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN" | "GROUP_ID">;

export const FORGET_CONFIRM = "Delete your data and remove you from the group? You can join again by invitation.";
export const FORGET_DELETE = "forget_delete";
export const FORGOTTEN = "Your data is deleted. You have been removed from the group.";
export const FORGOTTEN_ADMIN = "Your data is deleted. You are an admin, so the bot cannot remove you from the group.";

// The ID of the bot is the number before the colon in its token.
export const botId = (token: string): number => Number(token.split(":")[0]);

// Deletes the rows of the user and puts the ID of the bot in place of the user where the row stays.
// One batch.
export async function forgetUser(env: ForgetEnv, userId: number, chatId: number): Promise<void> {
  const db = env.DB;
  const bot = botId(env.TELEGRAM_BOT_TOKEN);
  await db.batch([
    db.prepare("DELETE FROM drafts WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM final_messages WHERE chat_id = ?1").bind(chatId),
    db.prepare("DELETE FROM user_phones WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM feedback WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM member_cache WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM invite_links WHERE user_id = ?1").bind(userId),
    db.prepare("UPDATE incoming_addresses SET user_id = ?2 WHERE user_id = ?1").bind(userId, bot),
    db.prepare("UPDATE invites SET invited_id = ?2 WHERE invited_id = ?1").bind(userId, bot),
    db.prepare("UPDATE invites SET inviter_id = ?2 WHERE inviter_id = ?1").bind(userId, bot),
    db.prepare("UPDATE invite_notices SET invited_id = ?2 WHERE invited_id = ?1").bind(userId, bot),
  ]);
}

// Removes the user from the group without a ban: banned, then unbanned at once. A failure is only logged.
export async function removeFromGroup(env: ForgetEnv, userId: number): Promise<void> {
  const banned = await callTelegram(env.TELEGRAM_BOT_TOKEN, "banChatMember", { chat_id: env.GROUP_ID, user_id: userId });
  if (banned === null) return;
  await callTelegram(env.TELEGRAM_BOT_TOKEN, "unbanChatMember", {
    chat_id: env.GROUP_ID,
    user_id: userId,
    only_if_banned: true,
  });
}
