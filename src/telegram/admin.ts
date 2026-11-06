// The /admin screen for the administrators of the closed group: the bot's state, the result
// of the last daily form check, the button that switches the bot on or off, the buttons of
// the feedback and the statistics, which do nothing yet, the decisions on incoming addresses
// and the editing of the address directory.
import {
  approveAllWalk,
  decideIncoming,
  deleteAddress,
  disableBot,
  dublinDateTime,
  enableBot,
  getAddress,
  getSwitchStatus,
  movePoint,
  nearestAddresses,
  nextIncoming,
  renameAddress,
  sameTextDistance,
  shapeFromGeometry,
  shapeMiddle,
} from "../core";
import type { Decision, FormCheckOutcome } from "../core";
import type { Env } from "../env";
import { ADDRESS_MAX_LENGTH, ADDRESS_TOO_LONG, CHOOSE_ADDRESS } from "./address";
import { answerButton, callTelegram, deleteMessage, sendMessage } from "./api";
import { createDraft, deleteAdminDraft, deleteDraft, swapScreen } from "./draft";
import type { Draft, Step } from "./draft";
import { stopReport } from "./stop";

type AdminEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN">;

interface Button {
  text: string;
  callback_data: string;
}

// The part of a Telegram message that /admin reads.
interface AdminMessage {
  message_id: number;
  text?: string;
  location?: { latitude: number; longitude: number };
  photo?: unknown[];
}

const SWITCH_ON = "admin_on";
const SWITCH_OFF = "admin_off";
const FEEDBACK = "admin_feedback";
const STATISTICS = "admin_statistics";
const INCOMING = "admin_incoming";
const DIRECTORY = "admin_directory";
// With arguments: ":<decision>:<incoming id>:<pin message id>" for the incoming screen,
// ":<pin message id>" for Back and Approve all, ":<directory id>" for the screens of the directory;
// the pin is left out when there is none.
const DECIDE = "admin_in";
const ALL_WALK = "admin_all_walk";
const BACK = "admin_back";
const ADDRESS = "admin_addr";
const EDIT_TEXT = "admin_text";
const MOVE = "admin_move";
const DELETE = "admin_del";

// How many directory addresses the directory search offers.
const DIRECTORY_CHOICES = 5;

const SEND_ADDRESS_LOCATION = "Send the location of the address";
const NO_ADDRESSES = "No addresses within 30 m";
const WRITE_NEW_ADDRESS = "Write the new address";
const SEND_NEW_LOCATION = "Send the new location";
const SAVED = "Saved";
const NO_INCOMING = "No incoming addresses";

const CHECK_RESULT_TEXT: Record<FormCheckOutcome, string> = {
  ok: "OK",
  changed: "form changed",
  unloaded: "page not loaded",
};

const KIND_TEXT = { point: "Point", line: "Line", area: "Area" } as const;

// The decisions of the incoming screen and what they store.
const DECISIONS: Record<string, Decision> = { ok: "approved", no: "rejected", keep: "rejected", replace: "replace" };

export const isAdminCommand = (text: string | undefined): boolean =>
  text !== undefined && /^\/admin(@\S+)?(\s|$)/.test(text);

export const isAdminButton = (data: string | undefined): boolean => data?.startsWith("admin_") === true;

const backButton = (pinId: number | null = null): Button => ({
  text: "Back",
  callback_data: pinId === null ? BACK : `${BACK}:${pinId}`,
});

const send = (env: AdminEnv, chatId: number, text: string, buttons?: Button[][]) =>
  sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, buttons ? { reply_markup: { inline_keyboard: buttons } } : {});

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
  return send(env, chatId, text, [
    [button],
    [
      { text: "Feedback", callback_data: FEEDBACK },
      { text: "Statistics", callback_data: STATISTICS },
    ],
    [
      { text: "Incoming addresses", callback_data: INCOMING },
      { text: "Edit directory", callback_data: DIRECTORY },
    ],
  ]);
}

// The next incoming address without a decision after afterId, with a pin on the map above it.
// An address whose text is already in the directory gets Keep old and Replace old.
async function sendIncoming(env: AdminEnv, chatId: number, afterId: number): Promise<number | null> {
  const item = await nextIncoming(env.DB, afterId);
  if (!item) return send(env, chatId, NO_INCOMING, [[backButton()]]);
  const duplicateM = await sameTextDistance(env.DB, item.text, item.geometry);

  const shape = shapeFromGeometry(JSON.parse(item.geometry));
  const middle = shape ? shapeMiddle(shape) : null;
  const pin = middle
    ? await callTelegram<{ message_id: number }>(env.TELEGRAM_BOT_TOKEN, "sendLocation", {
        chat_id: chatId,
        latitude: middle.lat,
        longitude: middle.lon,
      })
    : null;
  const pinId = pin?.message_id ?? null;
  const tail = pinId === null ? "" : `:${pinId}`;
  const decide = (text: string, action: string): Button => ({
    text,
    callback_data: `${DECIDE}:${action}:${item.id}${tail}`,
  });

  const lines = [
    `Incoming address ${item.position} of ${item.total}`,
    item.text,
    `${KIND_TEXT[item.kind]}, ${item.source === "walk" ? "from the walk" : "written by a user"}`,
  ];
  if (duplicateM !== null) {
    lines.push(`Possible duplicate: the same address is in the directory ${Math.round(duplicateM)} m away`);
  }
  const decisions =
    duplicateM === null
      ? [decide("Approve", "ok"), decide("Reject", "no"), decide("Next", "next")]
      : [decide("Keep old", "keep"), decide("Replace old", "replace"), decide("Next", "next")];
  const sent = await send(env, chatId, lines.join("\n"), [
    decisions,
    [{ text: "Approve all from the walk", callback_data: `${ALL_WALK}${tail}` }, backButton(pinId)],
  ]);
  if (sent === null && pinId !== null) await deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, pinId);
  return sent;
}

async function sendAddress(env: AdminEnv, chatId: number, id: number): Promise<number | null> {
  const address = await getAddress(env.DB, id);
  if (!address) return sendScreen(env, chatId);
  const actions: Button[] = [{ text: "Edit text", callback_data: `${EDIT_TEXT}:${id}` }];
  if (address.kind === "point") actions.push({ text: "Move", callback_data: `${MOVE}:${id}` });
  actions.push({ text: "Delete", callback_data: `${DELETE}:${id}` });
  return send(env, chatId, `${address.text}\n${KIND_TEXT[address.kind]}`, [actions, [backButton()]]);
}

// Asks for a location or a text: a report in progress is stopped without a word, and the
// question is kept as a draft, with the directory address it is about.
async function askInput(
  env: AdminEnv,
  userId: number,
  chatId: number,
  step: Step,
  prompt: string,
  addressId: number | null,
): Promise<number | null> {
  await stopReport(env, userId, chatId);
  const messageId = await send(env, chatId, prompt, [[backButton()]]);
  if (messageId !== null) {
    await createDraft(env.DB, userId, messageId, prompt, { step, address_id: addressId }, []);
  }
  return messageId;
}

// The caller has already checked that the sender is an administrator of the group.
// A report in progress is stopped without a word (see stopReport).
export async function handleAdminCommand(env: AdminEnv, userId: number, chatId: number): Promise<void> {
  await stopReport(env, userId, chatId);
  await sendScreen(env, chatId);
}

// Every button sends its next screen and removes the one it was pressed on, and the pin above it.
export async function handleAdminButton(
  env: AdminEnv,
  userId: number,
  chatId: number,
  query: { id: string; data?: string; messageId?: number },
): Promise<void> {
  const answered = answerButton(env.TELEGRAM_BOT_TOKEN, query.id);
  // These two buttons only get their answer for now.
  if (query.data === FEEDBACK || query.data === STATISTICS) {
    await answered;
    return;
  }
  const [name, first, second, third] = (query.data ?? "").split(":");
  let pinId: number | null = null;
  let next: Promise<number | null>;
  if (name === SWITCH_ON || name === SWITCH_OFF) {
    await (name === SWITCH_ON ? enableBot(env.DB) : disableBot(env.DB));
    next = sendScreen(env, chatId);
  } else if (name === INCOMING) {
    next = sendIncoming(env, chatId, 0);
  } else if (name === DECIDE) {
    const id = Number(second);
    pinId = third ? Number(third) : null;
    const decision = DECISIONS[first];
    if (decision) await decideIncoming(env.DB, id, decision);
    next = sendIncoming(env, chatId, id);
  } else if (name === ALL_WALK) {
    pinId = first ? Number(first) : null;
    await approveAllWalk(env.DB);
    next = sendIncoming(env, chatId, 0);
  } else if (name === BACK) {
    pinId = first ? Number(first) : null;
    await deleteAdminDraft(env.DB, userId);
    next = sendScreen(env, chatId);
  } else if (name === DIRECTORY) {
    next = askInput(env, userId, chatId, "admin_location", SEND_ADDRESS_LOCATION, null);
  } else if (name === ADDRESS) {
    next = sendAddress(env, chatId, Number(first));
  } else if (name === EDIT_TEXT) {
    next = askInput(env, userId, chatId, "admin_text", WRITE_NEW_ADDRESS, Number(first));
  } else if (name === MOVE) {
    next = askInput(env, userId, chatId, "admin_move", SEND_NEW_LOCATION, Number(first));
  } else if (name === DELETE) {
    await deleteAddress(env.DB, Number(first));
    next = send(env, chatId, SAVED).then(() => sendScreen(env, chatId));
  } else {
    await answered;
    return;
  }
  const [messageId] = await Promise.all([next, answered]);
  if (messageId === null) return;
  const old = [query.messageId, pinId].filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  await Promise.all(old.map((id) => deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, id)));
}

// The answer to a question of /admin. Anything else sends the question again below it.
// QUERY BUDGET EXCEPTION: draft read, address change, draft removal, switch state for the /admin screen.
export async function handleAdminInput(
  env: AdminEnv,
  userId: number,
  chatId: number,
  draft: Draft,
  message: AdminMessage,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const location = message.location;
  const text = message.text;
  const finish = async () => {
    await deleteDraft(env.DB, userId, draft.draft_id);
    await Promise.all([
      deleteMessage(token, chatId, draft.buttons_message_id),
      deleteMessage(token, chatId, message.message_id),
    ]);
  };

  if (draft.step === "admin_location" && location) {
    const found = await nearestAddresses(env.DB, location.latitude, location.longitude, DIRECTORY_CHOICES);
    await finish();
    if (found.length === 0) {
      await send(env, chatId, NO_ADDRESSES, [[backButton()]]);
    } else {
      await send(env, chatId, CHOOSE_ADDRESS, [
        ...found.map((address) => [{ text: address.text, callback_data: `${ADDRESS}:${address.id}` }]),
        [backButton()],
      ]);
    }
    return;
  }
  if (draft.step === "admin_text" && text !== undefined && text.length <= ADDRESS_MAX_LENGTH) {
    await renameAddress(env.DB, draft.address_id as number, text);
  } else if (draft.step === "admin_move" && location) {
    await movePoint(env.DB, draft.address_id as number, location.latitude, location.longitude);
  } else {
    const prompt = draft.step === "admin_text" && text !== undefined ? ADDRESS_TOO_LONG : draft.prompt;
    const messageId = await send(env, chatId, prompt, [[backButton()]]);
    if (messageId === null) return;
    const previous = await swapScreen(env.DB, userId, draft.draft_id, draft.step, messageId, prompt, {}, []);
    await Promise.all([
      deleteMessage(token, chatId, previous ?? messageId),
      message.photo ? Promise.resolve() : deleteMessage(token, chatId, message.message_id),
    ]);
    return;
  }
  await finish();
  await send(env, chatId, SAVED);
  await sendScreen(env, chatId);
}
