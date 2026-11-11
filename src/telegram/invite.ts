// Invite links: the link a member gives to a person, the request of that person to join the group,
// the message about the request that the administrators get, and the decision of an administrator.
import { DAY_MS } from "../core/shared";
import type { Env } from "../env";
import { callTelegram, sendMessage } from "./api";
import { groupMemberUser, UNKNOWN_USER, userTag } from "./notify";
import type { TelegramUser } from "./notify";

type InviteEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN" | "GROUP_ID">;

export const INVITE_LINK_TTL_MS = 7 * DAY_MS;

export const INVITE_TEXT = (link: string) =>
  `Your invite link works for 7 days. The person you send it to joins the group after an administrator approves the request\n\n${link}`;
export const INVITE_FAILED = "Could not create the link. Please try again in a minute";

const JOIN_REQUEST = "Join request";
// The buttons of the message about a request: ":ok:<ID>" and ":no:<ID>" with the ID of the person.
export const JOIN = "admin_join";

// The link of the member: the one still valid, or a new one that asks an administrator to approve each
// person who joins by it. Null when Telegram does not create the link.
export async function inviteLink(env: InviteEnv, userId: number, now: number = Date.now()): Promise<string | null> {
  const found = await env.DB.prepare("SELECT link FROM invite_links WHERE user_id = ?1 AND created_at > ?2")
    .bind(userId, now - INVITE_LINK_TTL_MS)
    .first<{ link: string }>();
  if (found) return found.link;
  const created = await callTelegram<{ invite_link: string }>(env.TELEGRAM_BOT_TOKEN, "createChatInviteLink", {
    chat_id: env.GROUP_ID,
    expire_date: Math.floor((now + INVITE_LINK_TTL_MS) / 1000),
    creates_join_request: true,
  });
  if (!created) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO invite_links (user_id, link, created_at) VALUES (?1, ?2, ?3)")
    .bind(userId, created.invite_link, now)
    .run();
  return created.invite_link;
}

interface JoinRequest {
  chat?: { id?: number };
  from?: Partial<TelegramUser> & { id?: number };
  invite_link?: { invite_link?: string };
}

// A person asked to join by a link of a member: the request is recorded as pending and every administrator
// of the group, except bots, gets a message with the buttons. A request by a link that is not
// in the table is left to Telegram.
// QUERY BUDGET EXCEPTION: the repeat filter with the link lookup (one batch), the request, the messages sent.
export async function handleJoinRequest(env: InviteEnv, updateId: number, request: JoinRequest): Promise<void> {
  const requester = request.from;
  const link = request.invite_link?.invite_link;
  if (
    String(request.chat?.id) !== env.GROUP_ID ||
    typeof requester?.id !== "number" ||
    typeof requester.first_name !== "string" ||
    typeof link !== "string"
  ) {
    return;
  }
  const now = Date.now();
  const [stored, found] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?1, ?2)").bind(updateId, now),
    env.DB.prepare("SELECT user_id AS inviterId FROM invite_links WHERE link = ?1").bind(link),
  ]);
  if (stored.meta.changes === 0) return;
  const inviterId = (found.results[0] as { inviterId: number } | undefined)?.inviterId;
  if (inviterId === undefined) return;

  await env.DB.prepare(
    "INSERT OR REPLACE INTO invites (invited_id, inviter_id, status, created_at) VALUES (?1, ?2, 'pending', ?3)",
  )
    .bind(requester.id, inviterId, now)
    .run();
  const [inviter, admins] = await Promise.all([
    groupMemberUser(env, inviterId),
    callTelegram<{ user: { id: number; is_bot?: boolean } }[]>(env.TELEGRAM_BOT_TOKEN, "getChatAdministrators", {
      chat_id: env.GROUP_ID,
    }),
  ]);
  const text = [
    JOIN_REQUEST,
    `${userTag({ first_name: requester.first_name, last_name: requester.last_name, username: requester.username })} wants to join the group`,
    `Invited by ${inviter ? userTag(inviter) : UNKNOWN_USER}`,
  ].join("\n");
  const buttons = [
    [
      { text: "Approve", callback_data: `${JOIN}:ok:${requester.id}` },
      { text: "Reject", callback_data: `${JOIN}:no:${requester.id}` },
    ],
  ];
  const recipients = (admins ?? []).filter((admin) => !admin.user.is_bot).map((admin) => admin.user.id);
  const sent = await Promise.all(
    recipients.map(async (chatId) => ({
      chatId,
      messageId: await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, { reply_markup: { inline_keyboard: buttons } }),
    })),
  );
  const notices = sent.filter((notice): notice is { chatId: number; messageId: number } => notice.messageId !== null);
  if (notices.length === 0) return;
  await env.DB.batch(
    notices.map((notice) =>
      env.DB.prepare("INSERT OR IGNORE INTO invite_notices (chat_id, message_id, invited_id) VALUES (?1, ?2, ?3)").bind(
        notice.chatId,
        notice.messageId,
        requester.id,
      ),
    ),
  );
}

// An administrator pressed Approve or Reject: the first decision on a pending request is stored and given to
// Telegram, and the message about it changes for every administrator who was sent it, the one who pressed included.
// A button of a request that is already decided does nothing.
// QUERY BUDGET EXCEPTION: the decision, the removal of the notices.
export async function decideJoin(
  env: InviteEnv,
  invitedId: number,
  approve: boolean,
  pressed: { chatId: number; messageId?: number; text?: string },
): Promise<void> {
  const claimed = await env.DB.prepare("UPDATE invites SET status = ?2 WHERE invited_id = ?1 AND status = 'pending'")
    .bind(invitedId, approve ? "approved" : "rejected")
    .run();
  if (claimed.meta.changes === 0) return;
  const decided = callTelegram(env.TELEGRAM_BOT_TOKEN, approve ? "approveChatJoinRequest" : "declineChatJoinRequest", {
    chat_id: env.GROUP_ID,
    user_id: invitedId,
  });
  const { results } = await env.DB.prepare(
    "DELETE FROM invite_notices WHERE invited_id = ?1 RETURNING chat_id, message_id",
  )
    .bind(invitedId)
    .all<{ chat_id: number; message_id: number }>();
  const targets = new Map(results.map((notice) => [`${notice.chat_id}:${notice.message_id}`, notice]));
  if (pressed.messageId !== undefined) {
    targets.set(`${pressed.chatId}:${pressed.messageId}`, { chat_id: pressed.chatId, message_id: pressed.messageId });
  }
  const edits =
    pressed.text === undefined
      ? []
      : [...targets.values()].map((notice) =>
          callTelegram(env.TELEGRAM_BOT_TOKEN, "editMessageText", {
            chat_id: notice.chat_id,
            message_id: notice.message_id,
            text: `${pressed.text}\n${approve ? "Approved" : "Rejected"}`,
            reply_markup: { inline_keyboard: [] },
          }),
        );
  await Promise.all([decided, ...edits]);
}

export interface ApprovedInvite {
  invitedId: number;
  inviterId: number;
}

// The approved invitations, oldest first.
export async function listApprovedInvites(db: D1Database): Promise<ApprovedInvite[]> {
  const { results } = await db
    .prepare(
      "SELECT invited_id AS invitedId, inviter_id AS inviterId FROM invites WHERE status = 'approved' ORDER BY created_at, invited_id",
    )
    .all<ApprovedInvite>();
  return results;
}
