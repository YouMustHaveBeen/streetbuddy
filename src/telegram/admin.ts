// The /admin screen for the administrators of the closed group: the bot's state, the result
// of the last daily form check, the button that switches the bot on or off, the buttons of
// the feedback and the statistics, which do nothing yet, the decisions on incoming addresses
// (a group of addresses with the same text is decided by keeping one of them), the editing of the
// address directory by a list and a text search, and the link to its map page.
import {
  CHOOSABLE_KINDS,
  approveAllFrom,
  district,
  isInArea,
  keepFromGroup,
  listDirectory,
  moveIncomingAddresses,
  withoutPostalDistrict,
  decideIncoming,
  deleteAddress,
  disableBot,
  dublinDateTime,
  enableBot,
  getAddress,
  getSwitchStatus,
  movePoint,
  nextIncoming,
  renameAddress,
  searchPattern,
  setAddressKind,
  shapeFromGeometry,
  shapeMiddle,
} from "../core";
import type { Decision, DuplicateGroup, FormCheckOutcome, IncomingScreen } from "../core";
import type { Env } from "../env";
import { directoryLink } from "../directoryLink";
import { ADDRESS_MAX_LENGTH, ADDRESS_TOO_LONG, OUT_OF_AREA } from "./address";
import { answerButton, callTelegram, deleteMessage, sendMessage } from "./api";
import {
  createDraft,
  deleteAdminDraft,
  deleteDraft,
  deleteSearchDraft,
  loadDraft,
  pointSearchDraft,
  swapScreen,
  takeAdminGroup,
} from "./draft";
import type { Draft, Step } from "./draft";
import { stopReport } from "./stop";

type AdminEnv = Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN" | "SITE_URL" | "DIRECTORY_LINK_SECRET">;

interface Button {
  text: string;
  callback_data?: string;
  url?: string;
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
// With arguments: ":<decision>:<incoming id>:<pin message id>" for the incoming screen (the
// decision "same" shows the same address again), ":<decision>:<incoming id>:<pin message id>" for
// the kind screen of an incoming address, ":<decision>:<kind>:<incoming id>:<pin message id>" for
// its answers, ":<pin message id>" for Back and Approve all, ":<directory id>:<page>" for the screens
// of the directory, ":<kind>:<directory id>" for the answers of its kind screen; the pin is left out
// when there is none. A group of duplicates has "g" in the place of the pin message ID: its pins are
// kept in its draft. KEEP has ":<place of the address in the group>", KEEP_KIND adds ":<first
// incoming ID of the group>", KEEP_SET has ":<place>:<kind>"; LIST has ":<page>".
const DECIDE = "admin_in";
const KIND = "admin_kind";
const SET_KIND = "admin_setkind";
const EDIT_KIND = "admin_editkind";
const DIR_KIND = "admin_dirkind";
const ALL_WALK = "admin_all_walk";
const ALL_OSM = "admin_all_osm";
const BACK = "admin_back";
const ADDRESS = "admin_addr";
const EDIT_TEXT = "admin_text";
const MOVE = "admin_move";
const DELETE = "admin_del";
const LIST = "admin_list";
const KEEP = "admin_keep";
const KEEP_KIND = "admin_keepkind";
const KEEP_SET = "admin_keepset";
const GROUP = "g";

// How many directory addresses a page of the directory screen has.
const DIRECTORY_PAGE_SIZE = 10;

const SEND_SEARCH_TEXT = "Send a text to search";
const NO_ADDRESSES_FOUND = "No addresses found";
const SEARCH_TOO_LONG = "The search text is too long";
const WRITE_NEW_ADDRESS = "Write the new address";
const SEND_NEW_LOCATION = "Send the new location";
const SAVED = "Saved";
const CHOOSE_KIND = "Choose the kind";
const NO_INCOMING = "No incoming addresses";

const CHECK_RESULT_TEXT: Record<FormCheckOutcome, string> = {
  ok: "OK",
  changed: "form changed",
  unloaded: "page not loaded",
};

const KIND_TEXT = { point: "Point", line: "Line", area: "Area" } as const;

// What the incoming screen says about where an address comes from.
const SOURCE_TEXT = { walk: "from the walk", osm: "from OSM" } as const;

// The decisions of the incoming screen and what they store.
const DECISIONS: Record<string, Decision> = { ok: "approved", no: "rejected" };

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
  const buttons: Button[][] = [
    [button],
    [
      { text: "Feedback", callback_data: FEEDBACK },
      { text: "Statistics", callback_data: STATISTICS },
    ],
    [
      { text: "Incoming addresses", callback_data: INCOMING },
      { text: "Edit directory", callback_data: DIRECTORY },
    ],
  ];
  if (env.DIRECTORY_LINK_SECRET) buttons.push([{ text: "Directory map", url: await directoryLink(env) }]);
  return send(env, chatId, text, buttons);
}

// The next incoming screen after afterId. One address is shown with a pin on the map above it;
// addresses with the same text, among themselves and in the directory, are shown together as a group.
async function sendIncoming(env: AdminEnv, userId: number, chatId: number, afterId: number): Promise<number | null> {
  const item = await nextIncoming(env.DB, afterId);
  if (!item) return send(env, chatId, NO_INCOMING, [[backButton()]]);
  if (item.incoming.length + item.old.length > 1) return sendGroup(env, userId, chatId, item);
  const [address] = item.incoming;

  const shape = shapeFromGeometry(JSON.parse(address.geometry));
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
  // The address of a user has no kind yet: its Approve asks for it.
  const decide = (text: string, action: string): Button => ({
    text,
    callback_data: `${address.kind === "temp" && action === "ok" ? KIND : DECIDE}:${action}:${address.id}${tail}`,
  });

  const form = shape ? KIND_TEXT[shape.kind] : "Unknown";
  const lines = [
    `Incoming address ${item.position} of ${item.total}`,
    address.text,
    address.source === "user" ? `${form}, written by a user` : `${form} (${address.kind}), ${SOURCE_TEXT[address.source]}`,
  ];
  const sent = await send(env, chatId, lines.join("\n"), [
    [decide("Approve", "ok"), decide("Reject", "no"), decide("Next", "next")],
    [{ text: "Approve all from the walk", callback_data: `${ALL_WALK}${tail}` }, backButton(pinId)],
    [{ text: "Approve all from OSM", callback_data: `${ALL_OSM}${tail}` }],
  ]);
  if (sent === null && pinId !== null) await deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, pinId);
  return sent;
}

// The addresses with the same text as one screen: a pin with a title for each of them above it, and
// a Keep button for each. The pins and the addresses shown are kept in a draft, because the buttons
// are too short to carry them.
async function sendGroup(env: AdminEnv, userId: number, chatId: number, item: IncomingScreen): Promise<number | null> {
  const [first] = item.incoming;
  const formOf = (geometry: string) => {
    const shape = shapeFromGeometry(JSON.parse(geometry));
    return { shape, form: shape ? KIND_TEXT[shape.kind] : "Unknown" };
  };
  const members = [
    ...item.old.map((address, i) => ({
      from: "old" as const,
      id: address.id,
      label: item.old.length > 1 ? `old${i + 1}` : "old",
      geometry: address.geometry,
      needsKind: false,
      description: `${formOf(address.geometry).form} (${address.kind}), in the directory`,
    })),
    ...item.incoming.map((address, i) => ({
      from: "incoming" as const,
      id: address.id,
      label: `new${i + 1}`,
      geometry: address.geometry,
      needsKind: address.kind === "temp",
      description:
        address.source === "user"
          ? `${formOf(address.geometry).form}, written by a user`
          : `${formOf(address.geometry).form} (${address.kind}), ${SOURCE_TEXT[address.source]}`,
    })),
  ];
  const pins = await Promise.all(
    members.map((member) => {
      const shape = formOf(member.geometry).shape;
      const middle = shape ? shapeMiddle(shape) : null;
      return middle
        ? callTelegram<{ message_id: number }>(env.TELEGRAM_BOT_TOKEN, "sendVenue", {
            chat_id: chatId,
            latitude: middle.lat,
            longitude: middle.lon,
            title: member.label,
            address: first.text,
          })
        : null;
    }),
  );
  const pinIds = pins.flatMap((pin) => (pin ? [pin.message_id] : []));

  const text = [
    `Incoming address ${item.position} of ${item.total}`,
    first.text,
    `Same address, ${members.length} objects`,
    ...members.map((member) => `${member.label}: ${member.description}`),
  ].join("\n");
  const sent = await send(env, chatId, text, [
    ...members.map((member, i): Button[] => [
      {
        text: `Keep ${member.label}`,
        callback_data: member.needsKind ? `${KEEP_KIND}:${i}:${first.id}` : `${KEEP}:${i}`,
      },
    ]),
    [{ text: "Next", callback_data: `${DECIDE}:next:${first.id}:${GROUP}` }],
    [{ text: "Approve all from the walk", callback_data: `${ALL_WALK}:${GROUP}` }, { text: "Back", callback_data: `${BACK}:${GROUP}` }],
    [{ text: "Approve all from OSM", callback_data: `${ALL_OSM}:${GROUP}` }],
  ]);
  if (sent === null) {
    await Promise.all(pinIds.map((id) => deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, id)));
    return null;
  }
  const shown: DuplicateGroupScreen = {
    old: item.old.map((address) => address.id),
    incoming: item.incoming.map((address) => address.id),
    first: first.id,
  };
  await createDraft(env.DB, userId, sent, text, { step: "admin_group", address_options: JSON.stringify(shown) }, pinIds);
  return sent;
}

// The addresses of a group as shown, and the ID that places the group in the queue.
type DuplicateGroupScreen = DuplicateGroup & { first: number };

// The screen with a button for each kind an administrator can give an address, and Back.
const sendKindScreen = (env: AdminEnv, chatId: number, answer: (kind: string) => string, back: Button) =>
  send(env, chatId, CHOOSE_KIND, [...CHOOSABLE_KINDS.map((kind) => [{ text: kind, callback_data: answer(kind) }]), [back]]);

// A page of the directory, alphabetically, or of the addresses that have the text in them. The
// search text is kept in the draft, which also receives the next text as a new search.
async function sendList(
  env: AdminEnv,
  userId: number,
  chatId: number,
  search: string | null,
  page: number,
): Promise<number | null> {
  const found = await listDirectory(env.DB, search === null ? null : searchPattern(search), page, DIRECTORY_PAGE_SIZE);
  const pages = found.pages > 1 ? ` (page ${found.page + 1} of ${found.pages})` : "";
  let text = `Directory${pages}\n${SEND_SEARCH_TEXT}`;
  if (search !== null) {
    text = found.total === 0 ? NO_ADDRESSES_FOUND : `Found ${found.total} ${found.total === 1 ? "address" : "addresses"}${pages}`;
  }
  const buttons: Button[][] = found.rows.map((address) => [
    { text: address.text, callback_data: `${ADDRESS}:${address.id}:${found.page}` },
  ]);
  const paging: Button[] = [];
  if (found.page > 0) paging.push({ text: "Previous", callback_data: `${LIST}:${found.page - 1}` });
  if (found.page < found.pages - 1) paging.push({ text: "Next", callback_data: `${LIST}:${found.page + 1}` });
  if (paging.length > 0) buttons.push(paging);
  buttons.push([backButton()]);
  const messageId = await send(env, chatId, text, buttons);
  if (messageId !== null) {
    await createDraft(env.DB, userId, messageId, text, { step: "admin_search", address: search }, []);
  }
  return messageId;
}

// The address screen from page `page` of the directory screen; its Back returns to that page.
async function sendAddress(env: AdminEnv, chatId: number, id: number, page: number): Promise<number | null> {
  const address = await getAddress(env.DB, id);
  if (!address) return sendScreen(env, chatId);
  const shape = shapeFromGeometry(JSON.parse(address.geometry));
  const actions: Button[] = [{ text: "Edit text", callback_data: `${EDIT_TEXT}:${id}` }];
  if (address.kind !== "area") actions.push({ text: "Edit kind", callback_data: `${EDIT_KIND}:${id}:${page}` });
  if (shape?.kind === "point") actions.push({ text: "Move", callback_data: `${MOVE}:${id}` });
  actions.push({ text: "Delete", callback_data: `${DELETE}:${id}` });
  const form = shape ? KIND_TEXT[shape.kind] : "Unknown";
  return send(env, chatId, `${address.text}\n${form} (${address.kind})`, [
    actions,
    [{ text: "Back", callback_data: `${LIST}:${page}` }],
  ]);
}

// Makes the directory screen draft point to the screen that has just been sent.
const pointDraft = (
  env: AdminEnv,
  userId: number,
  fromMessageId: number,
  screen: Promise<number | null>,
): Promise<number | null> =>
  screen.then(async (messageId) => {
    if (messageId !== null) await pointSearchDraft(env.DB, userId, fromMessageId, messageId);
    return messageId;
  });

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
// A decision on an incoming address is followed at once by the move into the directory.
// QUERY BUDGET EXCEPTION: the decision, the move (a read batch and a write batch), the next incoming screen (two reads), its draft.
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
  const [name, first, second, third, fourth] = (query.data ?? "").split(":");
  let pinId: number | null = null;
  // The pins above a group of duplicates; they are in its draft, which is taken once.
  let groupPins: number[] = [];
  const pinOf = (value: string | undefined) => (value && value !== GROUP ? Number(value) : null);
  const takePins = async (value: string | undefined) =>
    value === GROUP ? ((await takeAdminGroup(env.DB, userId))?.pins ?? []) : [];
  let next: Promise<number | null>;
  if (name === SWITCH_ON || name === SWITCH_OFF) {
    await (name === SWITCH_ON ? enableBot(env.DB) : disableBot(env.DB));
    next = sendScreen(env, chatId);
  } else if (name === INCOMING) {
    next = sendIncoming(env, userId, chatId, 0);
  } else if (name === DECIDE) {
    const id = Number(second);
    pinId = pinOf(third);
    groupPins = await takePins(third);
    const decision = DECISIONS[first];
    if (decision) {
      await decideIncoming(env.DB, id, decision);
      await moveIncomingAddresses(env.DB);
    }
    next = sendIncoming(env, userId, chatId, first === "same" ? id - 1 : id);
  } else if (name === KEEP || name === KEEP_SET) {
    const taken = await takeAdminGroup(env.DB, userId);
    if (taken) {
      groupPins = taken.pins;
      const shown = JSON.parse(taken.options) as DuplicateGroupScreen;
      const place = Number(first);
      const keepId = place < shown.old.length ? shown.old[place] : shown.incoming[place - shown.old.length];
      const kind = name === KEEP_SET ? CHOOSABLE_KINDS.find((chosen) => chosen === second) : undefined;
      if (keepId !== undefined && (name === KEEP || kind)) {
        await keepFromGroup(env.DB, shown, { from: place < shown.old.length ? "old" : "incoming", id: keepId }, kind ?? null);
        await moveIncomingAddresses(env.DB);
      }
      next = sendIncoming(env, userId, chatId, shown.first - 1);
    } else {
      next = sendIncoming(env, userId, chatId, 0);
    }
  } else if (name === KEEP_KIND) {
    next = sendKindScreen(env, chatId, (kind) => `${KEEP_SET}:${first}:${kind}`, {
      text: "Back",
      callback_data: `${DECIDE}:same:${second}:${GROUP}`,
    });
  } else if (name === KIND) {
    const id = Number(second);
    const tail = third ? `:${third}` : "";
    next = sendKindScreen(env, chatId, (kind) => `${SET_KIND}:${first}:${kind}:${id}${tail}`, {
      text: "Back",
      callback_data: `${DECIDE}:same:${id}${tail}`,
    });
  } else if (name === SET_KIND) {
    const id = Number(third);
    pinId = fourth ? Number(fourth) : null;
    const decision = DECISIONS[first];
    const kind = CHOOSABLE_KINDS.find((chosen) => chosen === second);
    if (decision && kind) {
      await decideIncoming(env.DB, id, decision, kind);
      await moveIncomingAddresses(env.DB);
    }
    next = sendIncoming(env, userId, chatId, id);
  } else if (name === ALL_WALK || name === ALL_OSM) {
    pinId = pinOf(first);
    groupPins = await takePins(first);
    await approveAllFrom(env.DB, name === ALL_WALK ? "walk" : "osm");
    await moveIncomingAddresses(env.DB);
    next = sendIncoming(env, userId, chatId, 0);
  } else if (name === BACK) {
    pinId = pinOf(first);
    groupPins = await takePins(first);
    if (query.messageId !== undefined) await deleteAdminDraft(env.DB, userId, query.messageId);
    next = sendScreen(env, chatId);
  } else if (name === DIRECTORY) {
    await stopReport(env, userId, chatId);
    next = sendList(env, userId, chatId, null, 0);
  } else if (name === LIST) {
    const draft = await loadDraft(env.DB, userId);
    next = sendList(env, userId, chatId, draft?.step === "admin_search" ? draft.address : null, Number(first) || 0);
  } else if (name === ADDRESS) {
    next = pointDraft(env, userId, query.messageId ?? 0, sendAddress(env, chatId, Number(first), Number(second) || 0));
  } else if (name === EDIT_KIND) {
    const id = Number(first);
    const page = Number(second) || 0;
    next = pointDraft(
      env,
      userId,
      query.messageId ?? 0,
      sendKindScreen(env, chatId, (kind) => `${DIR_KIND}:${kind}:${id}`, { text: "Back", callback_data: `${ADDRESS}:${id}:${page}` }),
    );
  } else if (name === DIR_KIND) {
    const kind = CHOOSABLE_KINDS.find((chosen) => chosen === first);
    if (kind) await setAddressKind(env.DB, Number(second), kind);
    await deleteSearchDraft(env.DB, userId);
    next = send(env, chatId, SAVED).then(() => sendScreen(env, chatId));
  } else if (name === EDIT_TEXT) {
    next = askInput(env, userId, chatId, "admin_text", WRITE_NEW_ADDRESS, Number(first));
  } else if (name === MOVE) {
    next = askInput(env, userId, chatId, "admin_move", SEND_NEW_LOCATION, Number(first));
  } else if (name === DELETE) {
    await deleteAddress(env.DB, Number(first));
    await deleteSearchDraft(env.DB, userId);
    next = send(env, chatId, SAVED).then(() => sendScreen(env, chatId));
  } else {
    await answered;
    return;
  }
  let messageId: number | null;
  try {
    [messageId] = await Promise.all([next, answered]);
  } catch (error) {
    // The group draft is already taken, so its pins are removed even when the next screen is not sent.
    await Promise.all(groupPins.map((id) => deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, id)));
    throw error;
  }
  if (messageId === null) return;
  const old = [query.messageId, pinId, ...groupPins].filter((id): id is number => typeof id === "number" && Number.isFinite(id));
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

  // A question of a former version (the location for the directory) shows the directory screen.
  if (!["admin_group", "admin_search", "admin_text", "admin_move"].includes(draft.step)) {
    await deleteDraft(env.DB, userId, draft.draft_id);
    const shown = await sendList(env, userId, chatId, null, 0);
    if (shown !== null) {
      await Promise.all([
        deleteMessage(token, chatId, draft.buttons_message_id),
        deleteMessage(token, chatId, message.message_id),
      ]);
    }
    return;
  }
  // Anything sent while a group of duplicates is on screen is removed: the buttons are the answer.
  if (draft.step === "admin_group") {
    await deleteMessage(token, chatId, message.message_id);
    return;
  }
  // A text is a new search; anything else shows the directory screen again.
  if (draft.step === "admin_search") {
    const searched = text?.trim() ?? "";
    let shown: number | null;
    if (searched !== "" && searchPattern(searched) === null) {
      shown = await send(env, chatId, SEARCH_TOO_LONG, [[backButton()]]);
      if (shown !== null) {
        await createDraft(env.DB, userId, shown, SEARCH_TOO_LONG, { step: "admin_search", address: draft.address }, []);
      }
    } else {
      shown = await sendList(env, userId, chatId, searched === "" ? null : searched, 0);
    }
    if (shown !== null) {
      await Promise.all([
        deleteMessage(token, chatId, draft.buttons_message_id),
        message.photo ? Promise.resolve() : deleteMessage(token, chatId, message.message_id),
      ]);
    }
    return;
  }
  const trimmed = text?.trim() ?? "";
  const inArea = location !== undefined && isInArea(district, location.latitude, location.longitude);
  if (draft.step === "admin_text" && trimmed !== "" && trimmed.length <= ADDRESS_MAX_LENGTH) {
    await renameAddress(env.DB, draft.address_id as number, withoutPostalDistrict(trimmed, district));
  } else if (draft.step === "admin_move" && location && inArea) {
    await movePoint(env.DB, draft.address_id as number, location.latitude, location.longitude);
  } else {
    let prompt = draft.prompt;
    if (draft.step === "admin_text" && trimmed.length > ADDRESS_MAX_LENGTH) prompt = ADDRESS_TOO_LONG;
    else if (draft.step === "admin_text") prompt = WRITE_NEW_ADDRESS;
    if (draft.step === "admin_move" && location) await send(env, chatId, OUT_OF_AREA);
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
