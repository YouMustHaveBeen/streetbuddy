// The report dialog: location, photos, plate and time, parking options, "Were you a", final message.
import {
  buildDescription,
  buildLocation,
  buildReportLink,
  district,
  dublinDateTime,
  isBotEnabled,
  isInArea,
  PARKING_OPTIONS,
  PLATE_MAX_LENGTH,
  recognizePlates,
  ROAD_USER_TYPES,
  reverseGeocode,
  searchAddress,
} from "../core";
import { INSTALL_PATH } from "../install";
import { MANUAL_PATH } from "../manual";
import { callTelegram, downloadFile } from "./api";
import {
  addCleanup,
  cachedPlates,
  cachePlates,
  createDraft,
  deleteDraft,
  deleteFinishedDraft,
  loadDraft,
  moveStep,
  recordPhoto,
  saveFinalMessage,
  setPlates,
  startFinishing,
  swapScreen,
  deleteFinalMessage,
  readFinalMessage,
  toggleParking,
} from "./draft";
import type { Draft, DraftChanges, Step } from "./draft";
import { FORM_CHANGED_TEXT } from "./notify";

export interface DialogEnv {
  AI: Ai;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  SITE_URL: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
}

export interface Message {
  message_id: number;
  date: number;
  text?: string;
  location?: { latitude: number; longitude: number };
  photo?: PhotoSize[];
  media_group_id?: string;
}

interface Button {
  text: string;
  callback_data?: string;
  url?: string;
}

interface Context {
  env: DialogEnv;
  userId: number;
  chatId: number;
}

// Sent as HTML so that the words "manual" and "Installation guide" are the links; the text has no
// characters that HTML treats specially.
const startText = (siteUrl: string) => `StreetBuddy turns a photo of an illegally parked car into a pre-filled Garda Traffic Watch report form. You tick the two boxes, pass the captcha and press Submit yourself.
Please note: a report may require you to give a statement in court.
***
First, read the <a href="${siteUrl}${MANUAL_PATH}">manual</a>.
Second, set up your phone: <a href="${siteUrl}${INSTALL_PATH}">Installation guide</a>.
Third, to start a report, send location to the bot.
***
This bot is not affiliated with An Garda Síochána.
(A link to the Privacy Policy will be here.)
© OpenStreetMap contributors`;

const OUT_OF_AREA = "Sorry, this bot doesn't work in this area";
const TRY_AGAIN = "Could not get the address. Please try again in a minute.";
const WRITE_ADDRESS = "Could not get the address. Please write it.";
const SEND_LOCATION = "Please send the location.";
const EDIT_ADDRESS = "Write the correct address.";
const ADDRESS_TOO_LONG = "The address must be 100 characters or less.";
const SEND_PHOTOS = "Now send photos, the first one with the number plate.";
const PHOTO_RECEIVED = "Photo received. Send more photos or press Create report";
const SEVERAL_PLATES = "Several plates found. Choose one.";
const WRITE_PLATE = "Write the plate number.";
const NO_PLATE = "Could not read the plate. Please write it.";
const PLATE_TOO_LONG = "The plate number is too long. Please write it again.";
const WRITE_TIME = "Write the time as hh:mm.";
const WRONG_TIME = "Wrong time. Please write it again.";
const CHOOSE_PARKING = "Choose one or more options, then press Done.";
const CHOOSE_ONE = "Choose at least one option.";
const CHOOSE_ROAD_USER = "Were you a:";
const CANCELLED = "Report cancelled";
const OPEN_EXTERNALLY = "Open the link in an external browser.";
const REPORT_SENT = "Report sent";

// The buttons of the final message live on after the draft is gone, so they have their own names.
const FINAL_CANCEL = "final_cancel";
const FINAL_DONE = "final_done";

const ADDRESS_MAX_LENGTH = 100;
// A plate must stay readable, but a smaller download uses less CPU time on the free plan.
const MIN_PHOTO_SIDE = 1280;
// Telegram does not mark the last photo of an album.
const ALBUM_WAIT_MS = 2000;
const PLATES_POLL_MS = 1000;
const PLATES_POLL_LIMIT = 20;
const DELETE_BATCH = 100;

const CANCEL: Button = { text: "Cancel", callback_data: "cancel" };
const LOCATION_KEYBOARD = {
  keyboard: [[{ text: "Location", request_location: true }]],
  resize_keyboard: true,
  is_persistent: true,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parsePlateList(draft: Pick<Draft, "plates">): string[] {
  return draft.plates ? (JSON.parse(draft.plates) as string[]) : [];
}

// Buttons of a step. Everything but the Location button is inline, and Cancel is everywhere.
function buttonsFor(
  step: Step,
  draft: Pick<Draft, "photo_count" | "plates" | "parking">,
): Button[][] {
  switch (step) {
    case "address":
      return [
        [
          { text: "Confirm", callback_data: "address_ok" },
          { text: "Edit", callback_data: "address_edit" },
        ],
        [CANCEL],
      ];
    case "photos":
      return draft.photo_count > 0
        ? [[{ text: "Create report", callback_data: "create" }], [CANCEL]]
        : [[CANCEL]];
    case "plate_choice":
      return [
        ...parsePlateList(draft).map((plate, i) => [{ text: plate, callback_data: `pick:${i}` }]),
        [{ text: "Add", callback_data: "plate_add" }],
        [CANCEL],
      ];
    case "plate_time":
      return [
        [{ text: "Confirm", callback_data: "plate_ok" }],
        [
          { text: "Edit plate", callback_data: "plate_edit" },
          { text: "Change time", callback_data: "time_edit" },
        ],
        [CANCEL],
      ];
    case "parking":
      return [
        ...PARKING_OPTIONS.map((option, i) => [
          {
            text: draft.parking & (1 << i) ? `✅ ${option}` : option,
            callback_data: `opt:${i}`,
          },
        ]),
        [{ text: "Done", callback_data: "done" }],
        [CANCEL],
      ];
    case "road_user":
      return [...ROAD_USER_TYPES.map((type, i) => [{ text: type, callback_data: `road:${i}` }]), [CANCEL]];
    default:
      return [[CANCEL]];
  }
}

async function send(
  c: Context,
  text: string,
  replyMarkup?: unknown,
  html = false,
): Promise<number | null> {
  const sent = await callTelegram<{ message_id: number }>(c.env.TELEGRAM_BOT_TOKEN, "sendMessage", {
    chat_id: c.chatId,
    text,
    // Two links in one message would otherwise open a preview of the first page.
    ...(html ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  return sent?.message_id ?? null;
}

async function deleteMessage(c: Context, messageId: number): Promise<void> {
  await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "deleteMessage", {
    chat_id: c.chatId,
    message_id: messageId,
  });
}

// Sends the new screen and removes the previous one: buttons never stay behind in the middle
// of the conversation. With no draft yet, this creates it.
async function show(
  c: Context,
  draft: Draft | null,
  text: string,
  changes: DraftChanges,
  cleanupIds: number[] = [],
): Promise<void> {
  const step = changes.step ?? (draft as Draft).step;
  const view = {
    photo_count: draft?.photo_count ?? 0,
    plates: draft?.plates ?? null,
    parking: draft?.parking ?? 0,
  };
  const messageId = await send(c, text, { inline_keyboard: buttonsFor(step, view) });
  if (messageId === null) return;
  if (!draft) {
    await createDraft(c.env.DB, c.userId, messageId, text, changes, cleanupIds);
    return;
  }
  const previous = await swapScreen(
    c.env.DB,
    c.userId,
    draft.step,
    messageId,
    text,
    changes,
    cleanupIds,
  );
  await deleteMessage(c, previous ?? messageId);
}

// Shows the current screen again below whatever the user has just sent. A photo stays
// in the chat, any other message is removed along with the dialog.
async function redraw(c: Context, draft: Draft, message: Message): Promise<void> {
  const cleanupIds = message.photo ? [] : [message.message_id];
  // While the link is being given the list of messages to delete is already read, so a
  // new screen would stay behind.
  if (draft.step === "finishing") {
    if (cleanupIds.length > 0) await addCleanup(c.env.DB, c.userId, cleanupIds);
    return;
  }
  await show(c, draft, draft.prompt, {}, cleanupIds);
}

async function handleStart(c: Context, draft: Draft | null, message: Message): Promise<void> {
  const startId = await send(c, startText(c.env.SITE_URL), LOCATION_KEYBOARD, true);
  if (!draft) return;
  // The report is left as it was: its screen only moves below the /start text.
  const cleanupIds = [message.message_id, ...(startId === null ? [] : [startId])];
  if (draft.step === "finishing") {
    await addCleanup(c.env.DB, c.userId, cleanupIds);
  } else {
    await show(c, draft, draft.prompt, {}, cleanupIds);
  }
}

async function refuseArea(c: Context, draft: Draft | null): Promise<void> {
  if (draft) {
    await deleteDraft(c.env.DB, c.userId);
    await deleteMessage(c, draft.buttons_message_id);
  }
  await send(c, OUT_OF_AREA);
}

async function handleLocation(
  c: Context,
  draft: Draft | null,
  message: Message,
  lat: number,
  lon: number,
): Promise<void> {
  if (!isInArea(district, lat, lon)) {
    await refuseArea(c, draft);
    return;
  }
  const cleanupIds = [message.message_id];
  let address: string | null;
  try {
    address = await reverseGeocode(c.env.DB, district, lat, lon);
  } catch {
    console.error("Nominatim failed on coordinates");
    const failures = (draft?.failures ?? 0) + 1;
    if (failures === 1) {
      await show(c, draft, TRY_AGAIN, { step: "location", failures }, cleanupIds);
    } else {
      // The area has already been checked by the coordinates, so the text is taken as it is.
      await show(c, draft, WRITE_ADDRESS, { step: "address_text", failures, lat, lon }, cleanupIds);
    }
    return;
  }
  if (address === null) {
    await refuseArea(c, draft);
    return;
  }
  await show(c, draft, address, { step: "address", failures: 0, address, lat, lon }, cleanupIds);
}

async function handleAddressText(
  c: Context,
  draft: Draft | null,
  message: Message,
  text: string,
): Promise<void> {
  const cleanupIds = [message.message_id];
  let place;
  try {
    place = await searchAddress(c.env.DB, district, text);
  } catch {
    console.error("Nominatim failed on a typed address");
    const failures = (draft?.failures ?? 0) + 1;
    const prompt = failures === 1 ? TRY_AGAIN : SEND_LOCATION;
    await show(c, draft, prompt, { step: "location", failures }, cleanupIds);
    return;
  }
  if (!place || !isInArea(district, place.lat, place.lon)) {
    await refuseArea(c, draft);
    return;
  }
  await show(
    c,
    draft,
    place.address,
    { step: "address", failures: 0, address: place.address, lat: place.lat, lon: place.lon },
    cleanupIds,
  );
}

// An address written by hand is kept as it is, with the coordinates already in the draft.
async function handleManualAddress(
  c: Context,
  draft: Draft,
  message: Message,
  text: string,
): Promise<void> {
  const cleanupIds = [message.message_id];
  if (text.length > ADDRESS_MAX_LENGTH) {
    await show(c, draft, ADDRESS_TOO_LONG, {}, cleanupIds);
    return;
  }
  await show(c, draft, text, { step: "address", address: text }, cleanupIds);
}

// The smallest size that still shows the plate, or the largest one if all are smaller.
function pickPhoto(sizes: PhotoSize[]): PhotoSize {
  const sorted = [...sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  return (
    sorted.find((size) => Math.max(size.width, size.height) >= MIN_PHOTO_SIDE) ??
    sorted[sorted.length - 1]
  );
}

// Runs next to the dialog. Any failure ends in an empty list: the bot then asks for the
// plate by hand, which also covers the used-up daily Workers AI limit.
// QUERY BUDGET EXCEPTION: up to three statements (cache read, cache write, result write):
// the recognition runs next to the dialog and shares only D1 with it.
async function recognize(c: Context, photo: PhotoSize): Promise<void> {
  let plates: string[] = [];
  try {
    const cached = await cachedPlates(c.env.DB, photo.file_unique_id);
    if (cached) {
      plates = cached;
    } else {
      const image = await downloadFile(c.env.TELEGRAM_BOT_TOKEN, photo.file_id);
      const startedAt = Date.now();
      plates = await recognizePlates(c.env.AI, image);
      // Only the duration: plates and photos never go to the logs.
      console.log(`Plate recognition took ${Date.now() - startedAt} ms`);
      await cachePlates(c.env.DB, photo.file_unique_id, plates);
    }
  } catch {
    console.error("Plate recognition failed");
  }
  await setPlates(c.env.DB, c.userId, photo.file_unique_id, plates);
}

async function answerPhoto(c: Context, draft: Draft, message: Message, count: number): Promise<void> {
  let photoCount = count;
  if (message.media_group_id) {
    await sleep(ALBUM_WAIT_MS);
    const latest = await loadDraft(c.env.DB, c.userId);
    // Another photo has arrived since: its own wait will answer for the whole album.
    if (latest?.step !== "photos" || latest.photo_count !== count) return;
    photoCount = latest.photo_count;
  }
  await show(c, { ...draft, photo_count: photoCount }, PHOTO_RECEIVED, {});
}

// QUERY BUDGET EXCEPTION: a photo costs the draft read, the photo record and the screen swap;
// an album adds one more read so that only one reply is sent, and the first photo adds the
// statements of the recognition (see recognize).
async function handlePhoto(c: Context, draft: Draft, message: Message): Promise<void> {
  const photo = pickPhoto(message.photo as PhotoSize[]);
  const recorded = await recordPhoto(c.env.DB, c.userId, {
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id,
    sentAt: message.date * 1000,
    messageId: message.message_id,
  });
  if (recorded === null) return;
  await Promise.all([
    answerPhoto(c, draft, message, recorded.photoCount),
    recorded.isFirst ? recognize(c, photo) : Promise.resolve(),
  ]);
}

function plateTimeChanges(draft: Draft, changes: DraftChanges): { text: string; changes: DraftChanges } {
  const moment = dublinDateTime(draft.first_photo_at as number);
  const plate = changes.plate ?? draft.plate;
  const time = changes.time ?? draft.time ?? moment.time;
  return {
    text: `Plate: ${plate}\nTime: ${moment.date} ${time}`,
    changes: { ...changes, step: "plate_time" },
  };
}

async function showPlateTime(
  c: Context,
  draft: Draft,
  changes: DraftChanges,
  cleanupIds: number[] = [],
): Promise<void> {
  const screen = plateTimeChanges(draft, changes);
  await show(c, draft, screen.text, screen.changes, cleanupIds);
}

async function handlePlateInput(
  c: Context,
  draft: Draft,
  message: Message,
  text: string,
): Promise<void> {
  const cleanupIds = [message.message_id];
  const plate = text.trim().replace(/\s+/g, " ").toUpperCase();
  if (plate === "") {
    await show(c, draft, WRITE_PLATE, {}, cleanupIds);
    return;
  }
  if (plate.length > PLATE_MAX_LENGTH) {
    await show(c, draft, PLATE_TOO_LONG, {}, cleanupIds);
    return;
  }
  await showPlateTime(c, draft, { plate }, cleanupIds);
}

async function handleTimeInput(
  c: Context,
  draft: Draft,
  message: Message,
  text: string,
): Promise<void> {
  const cleanupIds = [message.message_id];
  const time = text.trim();
  const now = dublinDateTime(Date.now());
  const reportDate = dublinDateTime(draft.first_photo_at as number).date;
  // hh:mm strings compare as times. A report begun yesterday has no future times.
  const inFuture = reportDate === now.date && time > now.time;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || inFuture) {
    await show(c, draft, WRONG_TIME, {}, cleanupIds);
    return;
  }
  await showPlateTime(c, draft, { time }, cleanupIds);
}

export async function handleMessage(env: DialogEnv, userId: number, chatId: number, message: Message): Promise<void> {
  const c: Context = { env, userId, chatId };
  const draft = await loadDraft(env.DB, userId);
  const text = message.text;

  if (text !== undefined && /^\/start(@\S+)?(\s|$)/.test(text)) {
    await handleStart(c, draft, message);
    return;
  }

  if (!draft || draft.step === "location") {
    // A report is started only while the bot is on; one already begun is carried on, and the
    // script on the form page tells the user if the form really has changed.
    if (!draft && (message.location || text !== undefined) && !(await isBotEnabled(env.DB))) {
      await send(c, FORM_CHANGED_TEXT);
      return;
    }
    if (message.location) {
      await handleLocation(c, draft, message, message.location.latitude, message.location.longitude);
    } else if (text !== undefined) {
      await handleAddressText(c, draft, message, text);
    } else if (draft) {
      await redraw(c, draft, message);
    }
    return; // With no draft, a photo or anything else is ignored silently.
  }

  if (draft.step === "photos" && message.photo?.length) {
    await handlePhoto(c, draft, message);
  } else if (text !== undefined && (draft.step === "address_text" || draft.step === "address_edit")) {
    await handleManualAddress(c, draft, message, text);
  } else if (text !== undefined && draft.step === "plate_input") {
    await handlePlateInput(c, draft, message, text);
  } else if (text !== undefined && draft.step === "time_input") {
    await handleTimeInput(c, draft, message, text);
  } else {
    await redraw(c, draft, message);
  }
}

async function cancel(c: Context, draft: Draft): Promise<void> {
  await deleteDraft(c.env.DB, c.userId);
  await deleteMessage(c, draft.buttons_message_id);
  await send(c, CANCELLED);
}

// Waits for the recognition started by the first photo.
// QUERY BUDGET EXCEPTION: one read per second until the background recognition writes its
// result; the two steps share only D1. Returns null when the user has cancelled meanwhile.
async function waitForPlates(c: Context, draft: Draft): Promise<string[] | null> {
  if (draft.plates !== null) return parsePlateList(draft);
  for (let i = 0; i < PLATES_POLL_LIMIT; i++) {
    await sleep(PLATES_POLL_MS);
    const latest = await loadDraft(c.env.DB, c.userId);
    if (latest?.step !== "recognizing") return null;
    if (latest.plates !== null) return parsePlateList(latest);
  }
  return [];
}

async function createReport(c: Context, draft: Draft): Promise<void> {
  if (!(await moveStep(c.env.DB, c.userId, "photos", "recognizing"))) return;
  const claimed: Draft = { ...draft, step: "recognizing" };
  const plates = await waitForPlates(c, claimed);
  if (plates === null) return;
  const current: Draft = { ...claimed, plates: JSON.stringify(plates) };
  if (plates.length > 1) {
    await show(c, current, SEVERAL_PLATES, { step: "plate_choice" });
  } else if (plates.length === 1) {
    await showPlateTime(c, current, { plate: plates[0] });
  } else {
    await show(c, current, NO_PLATE, { step: "plate_input" });
  }
}

// QUERY BUDGET EXCEPTION: the step is moved first so that a second tap cannot give a second
// link, and is moved back if Telegram fails, so the report is not lost; the text of the final
// message is saved once the link is out.
async function finish(c: Context, draft: Draft, roadUser: (typeof ROAD_USER_TYPES)[number]): Promise<void> {
  const chosen = await startFinishing(c.env.DB, c.userId);
  if (chosen === null) return;
  if (chosen === 0) {
    // The last option was switched off after Done had loaded the draft; a report needs one.
    // The button has already been answered, so a pop-up is out of reach: the options are drawn again.
    if (await moveStep(c.env.DB, c.userId, "finishing", "parking")) {
      await show(c, { ...draft, step: "parking", parking: 0 }, CHOOSE_PARKING, {});
    }
    return;
  }

  const parking =PARKING_OPTIONS.filter((_, i) => chosen & (1 << i));
  const moment = dublinDateTime(draft.first_photo_at as number);
  const time = draft.time ?? moment.time;
  const address = draft.address as string;
  const plate = draft.plate as string;
  const description = buildDescription({ plate, parking, address, date: moment.date, time });
  const link = buildReportLink({
    location: buildLocation(address, draft.lat as number, draft.lon as number),
    county: district.county,
    description,
    date: moment.date,
    roadUser,
  });
  // The report text without its last line: Done puts "Report sent ..." in place of that line.
  const body = `Plate: ${plate}
Location: ${address}
Date and time: ${moment.date} ${time}
Description: ${description}`;

  const sent = await callTelegram<{ message_id: number }>(c.env.TELEGRAM_BOT_TOKEN, "sendMessage", {
    chat_id: c.chatId,
    text: `${body}\n\n${OPEN_EXTERNALLY}`,
    reply_parameters: { message_id: draft.last_photo_id, allow_sending_without_reply: true },
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open form", url: link }],
        [
          { text: "Cancel", callback_data: FINAL_CANCEL },
          { text: "Done", callback_data: FINAL_DONE },
        ],
      ],
    },
  });
  if (!sent) {
    await moveStep(c.env.DB, c.userId, "finishing", "road_user");
    return;
  }
  // The link is already out, so a failure to keep the text must not leave the report in
  // "finishing": Done then only removes the buttons.
  try {
    await saveFinalMessage(c.env.DB, c.chatId, sent.message_id, body);
  } catch {
    console.error("Saving the final message failed");
  }

  const ids = [...(JSON.parse(draft.cleanup) as number[]), draft.buttons_message_id];
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "deleteMessages", {
      chat_id: c.chatId,
      message_ids: ids.slice(i, i + DELETE_BATCH),
    });
  }
  await deleteFinishedDraft(c.env.DB, c.userId);
}

async function answerButton(c: Context, queryId: string, text?: string): Promise<void> {
  await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "answerCallbackQuery", {
    callback_query_id: queryId,
    ...(text ? { text } : {}),
  });
}

// The buttons of a final message work with no draft: the report is finished and its draft is
// gone, and a new report may already be under way, which these buttons must not touch.
async function handleFinalButton(c: Context, done: boolean, messageId: number): Promise<void> {
  if (!done) {
    await deleteFinalMessage(c.env.DB, c.chatId, messageId);
    await deleteMessage(c, messageId);
    return;
  }
  const body = await readFinalMessage(c.env.DB, c.chatId, messageId);
  const noButtons = { inline_keyboard: [] };
  if (body === null) {
    // The text is no longer stored, so it cannot be rewritten: only the buttons go.
    await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "editMessageReplyMarkup", {
      chat_id: c.chatId,
      message_id: messageId,
      reply_markup: noButtons,
    });
    return;
  }
  const moment = dublinDateTime(Date.now());
  const edited = await callTelegram(c.env.TELEGRAM_BOT_TOKEN, "editMessageText", {
    chat_id: c.chatId,
    message_id: messageId,
    text: `${body}\n\n${REPORT_SENT} ${moment.date} ${moment.time}`,
    reply_markup: noButtons,
  });
  // The text stays until the message is really changed, so that a failed edit can be repeated.
  if (edited !== null) await deleteFinalMessage(c.env.DB, c.chatId, messageId);
}

export async function handleButton(
  env: DialogEnv,
  userId: number,
  chatId: number,
  query: { id: string; data?: string; messageId?: number },
): Promise<void> {
  const c: Context = { env, userId, chatId };
  const data = query.data ?? "";
  // Done may need a pop-up, which goes in this same answer; everything else is answered
  // first, so the button does not keep spinning.
  if (data !== "done") await answerButton(c, query.id);

  if (data === FINAL_CANCEL || data === FINAL_DONE) {
    if (query.messageId !== undefined) await handleFinalButton(c, data === FINAL_DONE, query.messageId);
    return;
  }

  const draft = await loadDraft(env.DB, userId);
  // A button of a finished report or of a replaced screen does nothing.
  if (!draft || draft.buttons_message_id !== query.messageId) {
    if (data === "done") await answerButton(c, query.id);
    return;
  }

  const [action, argument] = data.split(":");
  const step = draft.step;
  if (action === "cancel") {
    await cancel(c, draft);
  } else if (action === "address_ok" && step === "address") {
    await show(c, draft, SEND_PHOTOS, { step: "photos" });
  } else if (action === "address_edit" && step === "address") {
    await show(c, draft, EDIT_ADDRESS, { step: "address_edit" });
  } else if (action === "create" && step === "photos") {
    await createReport(c, draft);
  } else if (action === "pick" && step === "plate_choice") {
    const plate = parsePlateList(draft)[Number(argument)];
    if (plate !== undefined) await showPlateTime(c, draft, { plate });
  } else if (action === "plate_add" && step === "plate_choice") {
    await show(c, draft, WRITE_PLATE, { step: "plate_input" });
  } else if (action === "plate_ok" && step === "plate_time") {
    await show(c, draft, CHOOSE_PARKING, { step: "parking" });
  } else if (action === "plate_edit" && step === "plate_time") {
    await show(c, draft, WRITE_PLATE, { step: "plate_input" });
  } else if (action === "time_edit" && step === "plate_time") {
    await show(c, draft, WRITE_TIME, { step: "time_input" });
  } else if (action === "opt" && step === "parking") {
    const parking = await toggleParking(env.DB, userId, 1 << Number(argument));
    if (parking !== null) {
      await callTelegram(env.TELEGRAM_BOT_TOKEN, "editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: draft.buttons_message_id,
        reply_markup: { inline_keyboard: buttonsFor("parking", { ...draft, parking }) },
      });
    }
  } else if (action === "done" && step === "parking") {
    await answerButton(c, query.id, draft.parking === 0 ? CHOOSE_ONE : undefined);
    if (draft.parking !== 0) await show(c, draft, CHOOSE_ROAD_USER, { step: "road_user" });
  } else if (action === "road" && step === "road_user") {
    const roadUser = ROAD_USER_TYPES[Number(argument)];
    if (roadUser !== undefined) await finish(c, draft, roadUser);
  } else if (action === "done") {
    await answerButton(c, query.id);
  }
}
