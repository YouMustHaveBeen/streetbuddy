// Bot entry point: webhook secret check, repeat filter, group membership check.
import type { Env } from "../env";
import { handleAdminButton, handleAdminCommand, isAdminButton, isAdminCommand } from "./admin";
import { answerButton, callTelegram, sendMessage } from "./api";
import { givesLink, handleButton, handleMessage } from "./dialog";
import type { Message } from "./dialog";

export type WebhookEnv = Pick<Env, "AI" | "DB" | "TELEGRAM_BOT_TOKEN" | "WEBHOOK_SECRET" | "GROUP_ID" | "SITE_URL">;

const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const NOT_MEMBER_TEXT = "This bot is only for members of the group";
const MEMBER_STATUSES = ["creator", "administrator", "member"];
const ADMIN_STATUSES = ["creator", "administrator"];

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

interface GroupAccess {
  member: boolean;
  admin: boolean;
}

interface Incoming {
  updateId: number;
  userId: number;
  chatId: number;
  callbackQueryId?: string;
}

// Compares in constant time.
function secretMatches(received: string | null, expected: string): boolean {
  if (!received || !expected || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// Keeps only messages and button presses from private chats.
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

// "restricted" counts as a member while is_member is true. Returns null when Telegram does not answer.
async function groupAccess(env: WebhookEnv, userId: number): Promise<GroupAccess | null> {
  const member = await callTelegram<ChatMember>(env.TELEGRAM_BOT_TOKEN, "getChatMember", {
    chat_id: env.GROUP_ID,
    user_id: userId,
  });
  if (!member) return null;
  return {
    member: MEMBER_STATUSES.includes(member.status) || (member.status === "restricted" && member.is_member === true),
    admin: ADMIN_STATUSES.includes(member.status),
  };
}

// Runs after the response has gone out; a failure is logged with the update_id and the step.
// Membership is checked for messages, the buttons of /admin and the button that gives the link.
async function processUpdate(env: WebhookEnv, update: Update, ctx: ExecutionContext): Promise<void> {
  let step = "parse";
  try {
    const incoming = parseUpdate(update);
    if (!incoming) return;

    const data = update.callback_query?.data;
    const messageId = update.callback_query?.message?.message_id;
    const checked = !incoming.callbackQueryId || isAdminButton(data) || givesLink(data);

    // A repeat is recognized by the row already being there.
    step = "repeat filter and membership check";
    const [stored, access] = await Promise.all([
      env.DB.prepare("INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?1, ?2)")
        .bind(incoming.updateId, Date.now())
        .run(),
      checked ? groupAccess(env, incoming.userId) : null,
    ]);
    if (stored.meta.changes === 0) return;
    if (checked && access === null) return; // No answer from Telegram: not let in, and nothing is said.

    // /admin and its buttons: only administrators get an answer of any kind.
    if (isAdminCommand(update.message?.text) || isAdminButton(data)) {
      step = "admin";
      if (!access?.admin) return;
      if (incoming.callbackQueryId) {
        await handleAdminButton(env, incoming.chatId, { id: incoming.callbackQueryId, data, messageId });
      } else {
        await handleAdminCommand(env, incoming.userId, incoming.chatId);
      }
      return;
    }
    if (access && !access.member) {
      step = "not-member reply";
      if (incoming.callbackQueryId) {
        await answerButton(env.TELEGRAM_BOT_TOKEN, incoming.callbackQueryId, NOT_MEMBER_TEXT);
      } else {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, incoming.chatId, NOT_MEMBER_TEXT);
      }
      return;
    }

    step = "dialog";
    if (incoming.callbackQueryId) {
      await handleButton(env, incoming.userId, incoming.chatId, {
        id: incoming.callbackQueryId,
        data,
        messageId,
      });
    } else {
      await handleMessage(env, incoming.userId, incoming.chatId, update.message as Message, (work) => ctx.waitUntil(work));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`Update ${update.update_id} failed at ${step}: ${reason}`);
  }
}

// Answers Telegram at once; the work runs in the background.
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
    // The body must be a JSON object.
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return new Response("Bad Request", { status: 400 });
    }
    update = body as Update;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  ctx.waitUntil(processUpdate(env, update, ctx));
  return new Response("OK");
}
