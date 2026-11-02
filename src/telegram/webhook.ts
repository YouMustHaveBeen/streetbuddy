// Bot entry point: webhook secret check, repeat filter, group membership check.
import { callTelegram } from "./api";
import { handleButton, handleMessage } from "./dialog";
import type { Message } from "./dialog";

export interface WebhookEnv {
  AI: Ai;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  GROUP_ID: string;
}

const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const NOT_MEMBER_TEXT = "This bot is only for members of the group.";
const MEMBER_STATUSES = ["creator", "administrator", "member"];

interface Chat {
  id?: number;
  type?: string;
}

interface Update {
  update_id?: number;
  message?: Partial<Message> & { chat?: Chat; from?: { id?: number } };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number };
    message?: { message_id?: number; chat?: Chat };
  };
}

interface ChatMember {
  status: string;
  is_member?: boolean;
}

interface Incoming {
  updateId: number;
  userId: number;
  chatId: number;
  callbackQueryId?: string;
}

// Compares in constant time so the secret cannot be guessed from response timing.
function secretMatches(received: string | null, expected: string): boolean {
  if (!received || !expected || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// Keeps only messages and button presses from private chats; the bot also receives
// everything written in the group it is an administrator of, and ignores all of it.
function parseUpdate(update: Update): Incoming | null {
  if (!Number.isSafeInteger(update.update_id)) return null;
  const updateId = update.update_id as number;
  const query = update.callback_query;
  const chat = query ? query.message?.chat : update.message?.chat;
  const userId = query ? query.from?.id : update.message?.from?.id;
  if (chat?.type !== "private" || typeof chat.id !== "number" || typeof userId !== "number") {
    return null;
  }
  return { updateId, userId, chatId: chat.id, callbackQueryId: query?.id };
}

// "restricted" is still a member of the group unless the user has left it.
// Returns null when Telegram does not answer, so a failed check is not taken for "not a member".
async function isGroupMember(env: WebhookEnv, userId: number): Promise<boolean | null> {
  const member = await callTelegram<ChatMember>(env.TELEGRAM_BOT_TOKEN, "getChatMember", {
    chat_id: env.GROUP_ID,
    user_id: userId,
  });
  if (!member) return null;
  return MEMBER_STATUSES.includes(member.status) || (member.status === "restricted" && member.is_member === true);
}

// Runs after the response has gone out, so nobody is waiting for it: a failure is only
// logged, with the update_id and the step, instead of surfacing as a bare runtime error.
async function processUpdate(env: WebhookEnv, update: Update): Promise<void> {
  let step = "parse";
  try {
    const incoming = parseUpdate(update);
    if (!incoming) return;

    // A repeat is recognized by the row already being there.
    step = "repeat filter";
    const stored = await env.DB.prepare(
      "INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?1, ?2)",
    )
      .bind(incoming.updateId, Date.now())
      .run();
    if (stored.meta.changes === 0) return;

    step = "membership check";
    const member = await isGroupMember(env, incoming.userId);
    if (member === null) return; // No answer from Telegram: not let in, and nothing is said.
    if (member) {
      step = "dialog";
      if (incoming.callbackQueryId) {
        await handleButton(env, incoming.userId, incoming.chatId, {
          id: incoming.callbackQueryId,
          data: update.callback_query?.data,
          messageId: update.callback_query?.message?.message_id,
        });
      } else {
        await handleMessage(env, incoming.userId, incoming.chatId, update.message as Message);
      }
      return;
    }

    step = "not-member reply";
    if (incoming.callbackQueryId) {
      await callTelegram(env.TELEGRAM_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: incoming.callbackQueryId,
        text: NOT_MEMBER_TEXT,
      });
    } else {
      await callTelegram(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: incoming.chatId,
        text: NOT_MEMBER_TEXT,
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`Update ${update.update_id} failed at ${step}: ${reason}`);
  }
}

// Answers Telegram at once; the work runs in the background so a slow step never makes
// Telegram resend the update.
export async function handleWebhook(
  request: Request,
  env: WebhookEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!secretMatches(request.headers.get(SECRET_HEADER), env.WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let update: Update;
  try {
    const body: unknown = await request.json();
    // Valid JSON is not always an object (null, a number, a list).
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return new Response("Bad Request", { status: 400 });
    }
    update = body as Update;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  ctx.waitUntil(processUpdate(env, update));
  return new Response("OK");
}
