import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { district } from "../core";
import { handleButton, handleMessage } from "./dialog";
import { closeExpiredFinalMessages } from "./final";
import type { DialogEnv, Message } from "./dialog";

const USER = 42;
let deferred: Promise<unknown>[] = [];
const defer = (work: Promise<unknown>) => void deferred.push(work);
const settle = () => Promise.all(deferred.splice(0));
const [lonInside, latInside] = (() => {
  const lons = district.ring.map(([lon]) => lon);
  const lats = district.ring.map(([, lat]) => lat);
  return [lons.reduce((a, b) => a + b) / lons.length, lats.reduce((a, b) => a + b) / lats.length];
})();

let env: DialogEnv;
let sqlite: ReturnType<typeof fakeD1>["sqlite"];
let run: ReturnType<typeof vi.fn>;
let calls: { method: string; body: Record<string, unknown> }[];
let nextId: number;
let nextMessage: number;
let nominatim: () => Response;
let failSend: boolean;
let failEdit: boolean;
let onAnswer: (() => void) | null;

const called = (method: string) => calls.filter((call) => call.method === method);
const sentTexts = () => called("sendMessage").map((call) => call.body.text);
const lastSent = () => called("sendMessage").at(-1)?.body as { text: string; reply_markup?: any; reply_parameters?: any };
const draft = () => sqlite.prepare("SELECT * FROM drafts WHERE user_id = ?").get(USER) as any;
const buttonId = () => (draft()?.buttons_message_id ?? 0) as number;
const labels = () => lastSent().reply_markup.inline_keyboard.flat().map((b: { text: string }) => b.text);

const message = async (fields: Partial<Message>) => {
  nextMessage += 1;
  await handleMessage(env, USER, USER, { message_id: nextMessage, date: 1793000000, ...fields }, defer);
  await settle();
};
const location = (latitude = latInside, longitude = lonInside) => message({ location: { latitude, longitude } });
const text = (value: string) => message({ text: value });
const photo = (id = "a", extra: Partial<Message> = {}) =>
  message({
    photo: [
      { file_id: `${id}-s`, file_unique_id: `${id}-us`, width: 320, height: 240 },
      { file_id: `${id}-m`, file_unique_id: `${id}-um`, width: 1280, height: 960 },
      { file_id: `${id}-l`, file_unique_id: `${id}-ul`, width: 2560, height: 1920 },
    ],
    ...extra,
  });
const press = async (data: string, messageId = buttonId()) => {
  await handleButton(env, USER, USER, { id: "q", data, messageId }, defer);
  await settle();
};

async function toPhotos() {
  await location();
  await press("address_ok");
}
const giveLink = async () => {
  await press("road:Pedestrian");
  await press("review_ok");
};
async function toPlateTime() {
  await toPhotos();
  await photo();
  await press("create");
}

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  run = vi.fn(async () => ({ response: '["12-D-3456"]' }));
  env = { AI: { run } as unknown as Ai, DB: fake.db, TELEGRAM_BOT_TOKEN: "token", SITE_URL: "https://site.example" };
  calls = [];
  deferred = [];
  nextId = 1000;
  nextMessage = 0;
  failSend = false;
  failEdit = false;
  onAnswer = null;
  sqlite.prepare("INSERT INTO user_phones (user_id, phone, reports, last_used_at) VALUES (?, 'android', 0, ?)").run(USER, Date.now());
  nominatim = () =>
    new Response(JSON.stringify({ lat: "53.4", lon: "-6.1", address: { house_number: "12", road: "Main Street", suburb: "Clongriffin" } }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      if (address.includes("nominatim")) return nominatim();
      if (address.includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3]));
      const method = address.split("/").pop() as string;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ method, body });
      if (method === "answerCallbackQuery") onAnswer?.();
      if (method === "sendMessage" && failSend) return new Response(JSON.stringify({ ok: false, error_code: 500 }));
      if (method === "editMessageText" && failEdit) return new Response(JSON.stringify({ ok: false, error_code: 500 }));
      if (method === "getFile") return new Response(JSON.stringify({ ok: true, result: { file_path: "p.jpg" } }));
      nextId += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: nextId } }));
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/start", () => {
  it("shows the /start text and takes away the Location button", async () => {
    await text("/start");
    expect(lastSent().text).toBe(`StreetBuddy turns a photo of an illegally parked car into a pre-filled Garda Traffic Watch report form. You tick the two boxes, pass the captcha and press Submit yourself.
Please note: a report may require you to give a statement in court.
***
First, read the <a href="https://site.example/manual">manual</a>.
Second, set up your phone: <a href="https://site.example/install">Installation guide</a>.
Third, to start a report, send location to the bot.
***
This bot is not affiliated with An Garda Síochána.
(A link to the Privacy Policy will be here.)
© OpenStreetMap contributors`);
    expect(lastSent().reply_markup).toEqual({ remove_keyboard: true });
    expect(draft()).toBeUndefined();
  });
  it("sends the text as HTML without a link preview", async () => {
    await text("/start");
    const body = lastSent() as unknown as { parse_mode?: string; link_preview_options?: unknown };
    expect(body.parse_mode).toBe("HTML");
    expect(body.link_preview_options).toEqual({ is_disabled: true });
  });
  it("sends the other messages as plain text", async () => {
    await location();
    const body = lastSent() as unknown as { parse_mode?: string };
    expect(body.parse_mode).toBeUndefined();
  });
  it("stops a report in the middle of it without a word", async () => {
    await location();
    const before = buttonId();
    await text("/start");
    expect(draft()).toBeUndefined();
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(before);
    expect(sentTexts()).not.toContain("Report cancelled");
    expect(lastSent().text).toContain("StreetBuddy turns a photo");
  });
});

describe("the commands of the menu", () => {
  it("/manual and /setup give a link each, as HTML without a preview", async () => {
    await text("/manual");
    expect(lastSent().text).toBe('<a href="https://site.example/manual">User manual</a>');
    expect((lastSent() as unknown as { parse_mode: string }).parse_mode).toBe("HTML");
    expect((lastSent() as unknown as { link_preview_options: unknown }).link_preview_options).toEqual({ is_disabled: true });
    await text("/setup@streetbuddy_bot");
    expect(lastSent().text).toBe('<a href="https://site.example/install">Setup guide</a>');
    expect((lastSent() as unknown as { parse_mode: string }).parse_mode).toBe("HTML");
    expect((lastSent() as unknown as { link_preview_options: unknown }).link_preview_options).toEqual({ is_disabled: true });
  });
  it("/hotspots says there are none yet", async () => {
    await text("/hotspots");
    expect(lastSent().text).toBe("No hotspots yet");
  });
  it("/hotspots lists the places with the number of reports", async () => {
    sqlite.prepare("INSERT INTO hotspots (rank, address, plates) VALUES (1, '12 Main Street, D13', 7), (2, '3 Other Road, D13', 4)").run();
    await text("/hotspots");
    expect(lastSent().text).toBe("Hotspots\n1. 12 Main Street, D13 (7)\n2. 3 Other Road, D13 (4)");
  });
  it("/hotspots shows an address with line breaks on one line", async () => {
    sqlite.prepare("INSERT INTO hotspots (rank, address, plates) VALUES (1, '12 Main\nStreet', 7)").run();
    await text("/hotspots");
    expect(lastSent().text).toBe("Hotspots\n1. 12 Main Street (7)");
  });
  it("/reportmap shows the four buttons, and each answers that the map will be here", async () => {
    await text("/reportmap");
    expect(lastSent().text).toBe("Report map");
    expect(lastSent().reply_markup.inline_keyboard).toEqual([
      [
        { text: "Today", callback_data: "map:today" },
        { text: "Week", callback_data: "map:week" },
      ],
      [
        { text: "Last month", callback_data: "map:last_month" },
        { text: "Month before", callback_data: "map:month_before" },
      ],
    ]);
    await press("map:week", 5);
    expect(lastSent().text).toBe("The map will be here");
  });
  it("every command stops a report in progress without a word", async () => {
    for (const command of ["/manual", "/setup", "/hotspots", "/reportmap", "/feedback"]) {
      await toPhotos();
      const screen = buttonId();
      await text(command);
      if (command === "/feedback") expect(draft()?.step).toBe("feedback_input");
      else expect(draft()).toBeUndefined();
      expect(called("deleteMessage").some((call) => call.body.message_id === screen)).toBe(true);
      expect(sentTexts()).not.toContain("Report cancelled");
      await press("cancel");
    }
  });
});

describe("feedback", () => {
  const feedbackRows = () => sqlite.prepare("SELECT user_id, text FROM feedback").all();
  it("asks for the text with Cancel and keeps it with the Telegram ID", async () => {
    await text("/feedback");
    expect(lastSent().text).toBe("Write your feedback");
    expect(labels()).toEqual(["Cancel"]);
    const screen = buttonId();
    await text("It works");
    expect(feedbackRows()).toEqual([{ user_id: USER, text: "It works" }]);
    expect(lastSent().text).toBe("Thank you for your feedback");
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
    expect(draft()).toBeUndefined();
  });
  it("takes 1000 characters and refuses more, asking again", async () => {
    await text("/feedback");
    await text("x".repeat(1001));
    expect(lastSent().text).toBe("The feedback must not be longer than 1000 characters");
    expect(feedbackRows()).toEqual([]);
    expect(draft().step).toBe("feedback_input");
    await text("x".repeat(1000));
    expect(feedbackRows()).toHaveLength(1);
  });
  it("Cancel removes the screen and says nothing", async () => {
    await text("/feedback");
    const screen = buttonId();
    const sent = sentTexts().length;
    await press("cancel");
    expect(sentTexts().length).toBe(sent);
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
    expect(draft()).toBeUndefined();
    expect(feedbackRows()).toEqual([]);
  });
  it("shows the screen again on anything but text, and a location starts a report", async () => {
    await text("/feedback");
    await photo();
    expect(lastSent().text).toBe("Write your feedback");
    await location();
    expect(draft().step).toBe("address");
  });
});

describe("location", () => {
  it("ignores a photo sent before the location, silently", async () => {
    await photo();
    expect(calls).toEqual([]);
    expect(draft()).toBeUndefined();
  });
  it("refuses a point outside the area without asking Nominatim", async () => {
    nominatim = () => {
      throw new Error("must not be called");
    };
    await location(53.0, -7.0);
    expect(sentTexts()).toEqual(["Sorry, this bot doesn't work in this area"]);
    expect(draft()).toBeUndefined();
  });
  it("shows the address with Confirm, Edit and Cancel", async () => {
    await location();
    expect(lastSent().text).toBe("12 Main Street, Clongriffin, D13");
    expect(labels()).toEqual(["Confirm", "Edit", "Cancel"]);
  });
  it("treats text as an address and refuses one that is not found", async () => {
    nominatim = () => new Response("[]");
    await text("Nowhere");
    expect(sentTexts()).toEqual(["Sorry, this bot doesn't work in this area"]);
  });
  it("after two failures on a location takes the address as text", async () => {
    nominatim = () => new Response("", { status: 500 });
    await location();
    expect(lastSent().text).toBe("Could not get the address. Please try again in a minute");
    await location();
    expect(lastSent().text).toBe("Could not get the address. Please write it");
    await text("My street");
    expect(lastSent().text).toBe("My street");
    expect(draft().address).toBe("My street");
    expect(draft().lat).toBe(latInside);
  });
  it("after two failures on a typed address asks for the location", async () => {
    nominatim = () => new Response("", { status: 500 });
    await text("Main Street");
    await text("Main Street");
    expect(lastSent().text).toBe("Please send the location");
    expect(draft().step).toBe("location");
  });
  it("edits the address, keeps the coordinates, limits the length", async () => {
    await location();
    await press("address_edit");
    expect(lastSent().text).toBe("12 Main Street, Clongriffin, D13\n\nWrite the correct address");
    await text("x".repeat(101));
    expect(lastSent().text).toBe("The address must be 100 characters or less");
    await text("5 New Street");
    expect(draft().step).toBe("address");
    expect(draft().address).toBe("5 New Street");
    expect(draft().lat).toBe(latInside);
  });
  it("moves the address screen below a photo and does not remember the photo", async () => {
    await location();
    const before = buttonId();
    await photo();
    expect(draft().photo_count).toBe(0);
    expect(buttonId()).not.toBe(before);
    expect(JSON.parse(draft().cleanup)).toHaveLength(1);
  });
  it("starts the report over on a new location, on any step, and removes the old screen", async () => {
    await toPhotos();
    await photo();
    const screen = buttonId();
    nominatim = () =>
      new Response(JSON.stringify({ lat: "53.4", lon: "-6.1", address: { house_number: "7", road: "Other Road", suburb: "Clongriffin" } }));
    // Another point: the address of the first one is cached.
    await location(latInside + 0.0002);
    expect(draft().step).toBe("address");
    expect(draft().photo_count).toBe(0);
    expect(lastSent().text).toBe("7 Other Road, Clongriffin, D13");
    expect(called("deleteMessage").some((call) => call.body.message_id === screen)).toBe(true);
    expect(sentTexts()).not.toContain("Report cancelled");
  });
  it("drops the old report on a new location outside the area", async () => {
    await toPhotos();
    await location(53.0, -7.0);
    expect(draft()).toBeUndefined();
    expect(lastSent().text).toBe("Sorry, this bot doesn't work in this area");
  });
  it("leaves the report as it is on a new location while the bot is off", async () => {
    await toPhotos();
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    await location();
    expect(draft().step).toBe("photos");
    expect(lastSent().text).toContain("report form has changed");
  });
});

describe("photos", () => {
  it("answers each photo and recognizes only the first, in a size big enough", async () => {
    await toPhotos();
    await photo("a");
    await photo("b");
    expect(run).toHaveBeenCalledTimes(1);
    expect(called("getFile")[0].body.file_id).toBe("a-m");
    expect(lastSent().text).toBe("Photo received. Send more photos or press Create report");
    expect(labels()).toEqual(["Create report", "Cancel"]);
    expect(lastSent().reply_markup.inline_keyboard).toHaveLength(1);
    expect(draft().last_photo_id).toBe(nextMessage);
  });
  it("answers an album once", async () => {
    await toPhotos();
    const before = sentTexts().length;
    await Promise.all([photo("a", { media_group_id: "m" }), photo("b", { media_group_id: "m" })]);
    expect(sentTexts().length).toBe(before + 1);
    expect(draft().photo_count).toBe(2);
  });
  it("redraws after text and after a photo sent as a file", async () => {
    await toPhotos();
    await photo();
    await text("hello");
    expect(lastSent().text).toBe("Photo received. Send more photos or press Create report");
    expect(labels()).toEqual(["Create report", "Cancel"]);
    await message({});
    expect(JSON.parse(draft().cleanup)).toHaveLength(3);
  });
  it("takes the earliest album photo as the first, whatever reaches D1 first", async () => {
    await toPhotos();
    const size = (id: string) => [{ file_id: id, file_unique_id: `u-${id}`, width: 1280, height: 960 }];
    await handleMessage(env, USER, USER, { message_id: 501, date: 1793000100, photo: size("later") }, defer);
    await handleMessage(env, USER, USER, { message_id: 500, date: 1793000000, photo: size("earlier") }, defer);
    await settle();
    expect(draft().first_file_id).toBe("earlier");
    expect(draft().first_photo_at).toBe(1793000000000);
    expect(draft().last_photo_id).toBe(501);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("does not write an old recognition into a new report", async () => {
    await toPhotos();
    let finishModel = (_: unknown) => {};
    run.mockImplementationOnce(() => new Promise((resolve) => (finishModel = resolve)));
    const pending = photo("a");
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    await press("cancel");
    await toPhotos();
    await photo("b");
    finishModel({ response: '["OLD-1"]' });
    await pending;
    expect(JSON.parse(draft().plates)).toEqual(["12-D-3456"]);
  });
  it("does not recognize the same photo twice", async () => {
    await toPhotos();
    await photo("a");
    await press("cancel");
    await toPhotos();
    await photo("a");
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(draft().plates)).toEqual(["12-D-3456"]);
  });
});

describe("plate and time", () => {
  it("shows one screen for a single plate", async () => {
    await toPlateTime();
    expect(lastSent().text).toMatch(/^Plate: 12-D-3456\nTime: \d\d\/\d\d\/\d{4} \d\d:\d\d$/);
    expect(labels()).toEqual(["Confirm", "Edit plate", "Change time", "Cancel"]);
  });
  it("offers several plates and Add", async () => {
    run.mockImplementation(async () => ({ response: '["12-D-1", "13-D-2"]' }));
    await toPlateTime();
    expect(lastSent().text).toBe("Several plates found. Choose one");
    expect(labels()).toEqual(["12-D-1", "13-D-2", "Add", "Cancel"]);
    expect(lastSent().reply_markup.inline_keyboard.map((line: { text: string }[]) => line.length)).toEqual([1, 1, 2]);
    await press("pick:1");
    expect(lastSent().text).toContain("Plate: 13-D-2");
  });
  it("Add asks for the plate", async () => {
    run.mockImplementation(async () => ({ response: '["12-D-1", "13-D-2"]' }));
    await toPlateTime();
    await press("plate_add");
    expect(lastSent().text).toBe("Write the plate number");
    await text("99-D-1");
    expect(lastSent().text).toContain("Plate: 99-D-1");
  });
  it("asks by hand when recognition fails, and rejects a long plate", async () => {
    run.mockImplementation(async () => {
      throw new Error("limit");
    });
    await toPlateTime();
    expect(lastSent().text).toBe("Could not read the plate. Please write it");
    await text("1234567890123456");
    expect(lastSent().text).toBe("The plate number is too long. Please write it again");
    await text("123456789012345");
    expect(lastSent().text).toContain("Plate: 123456789012345");
  });
  it("writes a typed plate in capitals with single spaces", async () => {
    await toPlateTime();
    await press("plate_edit");
    expect(lastSent().text).toBe("12-D-3456\n\nWrite the plate number");
    await text(" 12-d   3456 ");
    expect(lastSent().text).toContain("Plate: 12-D 3456");
  });
  it("asks again for a plate that is only blank characters", async () => {
    await toPlateTime();
    await press("plate_edit");
    await text("\u00a0");
    expect(lastSent().text).toBe("Write the plate number");
    expect(draft().step).toBe("plate_input");
  });
  it("changes only the time and rejects a wrong or future one", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1793000000000 + 3600000);
    const original = draftTime(1793000000000);
    await toPlateTime();
    await press("time_edit");
    expect(lastSent().text).toBe(`${original}\n\nWrite the time as hh:mm`);
    await text("25:00");
    expect(lastSent().text).toBe("Wrong time. Please write it again");
    await text("23:59");
    expect(lastSent().text).toBe("Wrong time. Please write it again");
    await text(original);
    expect(draft().time).toBe(original);
    expect(lastSent().text).toContain(original);
  });
});

function draftTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

describe("parking and the final message", () => {
  async function toParking() {
    await toPlateTime();
    await press("plate_ok");
  }
  it("toggles options without a new message", async () => {
    await toParking();
    expect(lastSent().text).toBe("Choose one or more options, then press Done");
    expect(lastSent().reply_markup.inline_keyboard.at(-1).map((b: { text: string }) => b.text)).toEqual(["Done", "Cancel"]);
    const before = sentTexts().length;
    await press("opt:1");
    const edited = called("editMessageReplyMarkup").at(-1)?.body as any;
    expect(edited.reply_markup.inline_keyboard[1][0].text).toBe("✅ on a footpath");
    await press("opt:1");
    expect(draft().parking).toBe(0);
    expect(sentTexts().length).toBe(before);
  });
  it("requires one option", async () => {
    await toParking();
    await press("done");
    expect(called("answerCallbackQuery").at(-1)?.body.text).toBe("Choose at least one option");
    expect(draft().step).toBe("parking");
  });
  it("asks Were you a after Done, with the six options of the form and Cancel", async () => {
    await toParking();
    await press("opt:0");
    const screen = buttonId();
    await press("done");
    expect(draft().step).toBe("road_user");
    expect(lastSent().text).toBe("Were you a:");
    expect(labels()).toEqual([
      "Pedestrian",
      "Passenger",
      "Driver",
      "Cyclist",
      "Motorcyclist",
      "E-Scooter User, E-Moped User, E-Cyclist",
      "Cancel",
    ]);
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
  });
  it("draws Were you a again on a stray message and ignores an unknown option", async () => {
    await toParking();
    await press("opt:0");
    await press("done");
    await text("stray");
    expect(lastSent().text).toBe("Were you a:");
    await press("road:9");
    expect(draft().step).toBe("road_user");
    expect(called("sendMessage").filter((call) => JSON.stringify(call.body).includes("Open report"))).toEqual([]);
  });
  it("cancels the report at the Were you a step", async () => {
    await toParking();
    await press("opt:0");
    await press("done");
    const screen = buttonId();
    await press("cancel");
    expect(lastSent()).toEqual({ chat_id: USER, text: "Report cancelled" });
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
    expect(draft()).toBeUndefined();
  });
  it("stays on the options with their screen when Were you a cannot be sent", async () => {
    await toParking();
    await press("opt:0");
    const screen = buttonId();
    const deletedBefore = called("deleteMessage").length;
    failSend = true;
    await press("done");
    expect(draft().step).toBe("parking");
    expect(buttonId()).toBe(screen);
    expect(called("deleteMessage")).toHaveLength(deletedBefore);
    failSend = false;
    await press("done");
    expect(draft().step).toBe("road_user");
  });
  it("keeps one Were you a screen for a double tap on Done", async () => {
    await toParking();
    await press("opt:0");
    const screen = buttonId();
    const deletedBefore = called("deleteMessage").length;
    await Promise.all([press("done", screen), press("done", screen)]);
    expect(draft().step).toBe("road_user");
    const asks = sentTexts().filter((value) => value === "Were you a:");
    const deleted = called("deleteMessage")
      .slice(deletedBefore)
      .map((call) => call.body.message_id);
    // The options screen goes, and so does every Were you a screen but the one the draft holds.
    expect(deleted).toContain(screen);
    expect(deleted).not.toContain(buttonId());
    expect(deleted).toHaveLength(asks.length);
  });
  it("gives the link as a reply to the last photo and removes the dialog", async () => {
    await toPhotos();
    await photo("a");
    const lastPhoto = nextMessage;
    await text("stray");
    await press("create");
    await press("plate_ok");
    await press("opt:1");
    await press("opt:4");
    const screen = buttonId();
    await press("done");
    await press("road:Pedestrian");
    const roadScreen = buttonId();
    await press("review_ok");

    const final = lastSent();
    expect(final.text).toBe(
      "Vehicle 12-D-3456\nparked on a footpath\nand blocking a private driveway\nat 12 Main Street, Clongriffin, D13\non 26/10/2026 at 07:33.\nI was a pedestrian.\n\n-> Press “Open report”,\n-> «⋮» on the top and “Open in browser”,\n-> tap the address bar and type qqqwww,\n-> choose qqqwww in the suggestions,\n-> fill and send the report,\n-> press “Done” to close the form.",
    );
    expect(final.reply_parameters.message_id).toBe(lastPhoto);
    const button = final.reply_markup.inline_keyboard[0][0];
    expect(button.text).toBe("Open report");
    const data = JSON.parse(atob(button.url.split("#sb=")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(data.c).toBe("Dublin");
    expect(data.l).toContain(latInside.toFixed(5));
    expect(data.r).toBe("Pedestrian");
    const removed = called("deleteMessages").flatMap((call) => call.body.message_ids as number[]);
    expect(removed).toContain(roadScreen);
    expect(removed).not.toContain(screen);
    expect(removed).not.toContain(lastPhoto);
    expect(draft()).toBeUndefined();
  });
  it("writes a line of the report log without the Telegram ID, and survives a failed write", async () => {
    await toParking();
    await press("opt:1");
    await press("done");
    await giveLink();
    const rows = sqlite.prepare("SELECT * FROM report_log").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plate: "12-D-3456", parking: 2, address: "12 Main Street, Clongriffin, D13", lat: latInside, lon: lonInside });
    expect(Object.keys(rows[0])).not.toContain("user_id");

    sqlite.exec("DROP TABLE report_log");
    await toParking();
    await press("opt:1");
    await press("done");
    await giveLink();
    expect(lastSent().text).toContain("I was a pedestrian.");
    expect(draft()).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Writing the report log failed");
  });
  it("keeps the report when Telegram fails to send the final message", async () => {
    await toParking();
    await press("opt:0");
    await press("done");
    await press("road:Pedestrian");
    failSend = true;
    await press("review_ok");
    expect(draft().step).toBe("review");
    expect(called("deleteMessages")).toEqual([]);
  });
  it("gives one link for a double tap", async () => {
    await toParking();
    await press("opt:0");
    await press("done");
    await press("road:Pedestrian");
    const screen = buttonId();
    await Promise.all([press("review_ok", screen), press("review_ok", screen)]);
    expect(called("sendMessage").filter((call) => JSON.stringify(call.body).includes("Open report"))).toHaveLength(1);
  });
  it("uses the options chosen up to the moment of Done", async () => {
    await toParking();
    await press("opt:0");
    // A tap on another option lands after Done has loaded the draft.
    onAnswer = () => sqlite.prepare("UPDATE drafts SET parking = parking | 4 WHERE user_id = ?").run(USER);
    await press("done");
    onAnswer = null;
    await giveLink();
    expect(lastSent().text).toContain("parked on a cycle track\nand on a grass margin");
  });
  it("draws the options again when the last one was switched off at the moment of Done", async () => {
    await toParking();
    await press("opt:0");
    onAnswer = () => sqlite.prepare("UPDATE drafts SET parking = 0 WHERE user_id = ?").run(USER);
    await press("done");
    onAnswer = null;
    await press("road:Pedestrian");
    const screen = buttonId();
    const sentBefore = called("sendMessage").length;
    await press("review_ok");
    expect(draft().step).toBe("parking");
    expect(called("sendMessage").length).toBe(sentBefore + 1);
    expect(buttonId()).not.toBe(screen);
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
    expect(lastSent().text).toBe("Choose one or more options, then press Done");
    expect(labels().some((label: string) => label.startsWith("✅"))).toBe(false);
    expect(called("sendMessage").filter((call) => JSON.stringify(call.body).includes("Open report"))).toEqual([]);
    expect(called("deleteMessages")).toEqual([]);
  });
});

describe("final message buttons", () => {
  const BODY_END = "\n\n-> Press “Open report”,\n-> «⋮» on the top and “Open in browser”,\n-> tap the address bar and type qqqwww,\n-> choose qqqwww in the suggestions,\n-> fill and send the report,\n-> press “Done” to close the form.";
  async function toParking() {
    await toPlateTime();
    await press("plate_ok");
  }
  const finalRow = () =>
    sqlite.prepare("SELECT chat_id, message_id, text FROM final_messages").get() as
      | { chat_id: number; message_id: number; text: string }
      | undefined;
  async function toFinal() {
    await toParking();
    await press("opt:0");
    await press("done");
    await giveLink();
    return finalRow() as { chat_id: number; message_id: number; text: string };
  }

  it("keeps the callback_data of every button of the Were you a screen within 64 bytes", async () => {
    await toParking();
    await press("opt:0");
    await press("done");
    const data = lastSent().reply_markup.inline_keyboard.flat().map((b: { callback_data: string }) => b.callback_data);
    expect(data).toHaveLength(7);
    for (const value of data) expect(Buffer.byteLength(value)).toBeLessThanOrEqual(64);
  });

  it("has Open report, then Done and Cancel, and keeps the report text without the last line", async () => {
    const row = await toFinal();
    expect(lastSent().reply_markup.inline_keyboard.map((line: { text: string }[]) => line.map((b) => b.text))).toEqual([
      ["Open report"],
      ["Done", "Cancel"],
    ]);
    expect(lastSent().text.endsWith(BODY_END)).toBe(true);
    expect(row.text).toBe(lastSent().text.slice(0, -BODY_END.length));
    expect(row.chat_id).toBe(USER);
  });

  it("Done removes all the buttons and puts the time of the press in place of the last line", async () => {
    const row = await toFinal();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.UTC(2026, 10, 3, 10, 35));
      await press("final_done", row.message_id);
    } finally {
      vi.useRealTimers();
    }
    expect(called("editMessageText").at(-1)?.body).toEqual({
      chat_id: USER,
      message_id: row.message_id,
      text: `${row.text}\n\nReport sent 03/11/2026 10:35`,
      reply_markup: { inline_keyboard: [] },
    });
    expect(called("deleteMessage").filter((call) => call.body.message_id === row.message_id)).toEqual([]);
    expect(finalRow()).toBeUndefined();
  });

  it("keeps the text when the edit fails, so that Done can be pressed again", async () => {
    const row = await toFinal();
    failEdit = true;
    await press("final_done", row.message_id);
    expect(finalRow()?.text).toBe(row.text);
    failEdit = false;
    await press("final_done", row.message_id);
    expect(called("editMessageText").at(-1)?.body.text).toMatch(/^.*Report sent \d\d\/\d\d\/\d{4} \d\d:\d\d$/s);
    expect(finalRow()).toBeUndefined();
  });

  it("Cancel deletes the message and its stored text", async () => {
    const row = await toFinal();
    await press("final_cancel", row.message_id);
    expect(called("deleteMessage").at(-1)?.body).toEqual({ chat_id: USER, message_id: row.message_id });
    expect(called("editMessageText")).toEqual([]);
    expect(finalRow()).toBeUndefined();
  });

  it("Cancel takes the report out of the log, Done keeps it", async () => {
    const logRows = () => sqlite.prepare("SELECT id FROM report_log").all();
    const row = await toFinal();
    expect(logRows()).toHaveLength(1);
    await press("final_cancel", row.message_id);
    expect(logRows()).toEqual([]);

    const second = await toFinal();
    await press("final_done", second.message_id);
    expect(logRows()).toHaveLength(1);
  });

  it("Cancel leaves the other lines of the log alone", async () => {
    sqlite
      .prepare("INSERT INTO report_log (created_at, plate, parking, address, lat, lon) VALUES (1, 'x', 1, 'a', 53.4, -6.1)")
      .run();
    const row = await toFinal();
    await press("final_cancel", row.message_id);
    expect(sqlite.prepare("SELECT plate FROM report_log").all()).toEqual([{ plate: "x" }]);
  });

  it("Done only removes the buttons when the text is no longer stored", async () => {
    const row = await toFinal();
    sqlite.prepare("DELETE FROM final_messages").run();
    await press("final_done", row.message_id);
    expect(called("editMessageText")).toEqual([]);
    expect(called("editMessageReplyMarkup").at(-1)?.body).toEqual({
      chat_id: USER,
      message_id: row.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("treats a text older than 48 hours as gone", async () => {
    const row = await toFinal();
    sqlite.prepare("UPDATE final_messages SET created_at = ?").run(Date.now() - 48 * 60 * 60 * 1000 - 1);
    await press("final_done", row.message_id);
    expect(called("editMessageText")).toEqual([]);
    expect(called("editMessageReplyMarkup").at(-1)?.body).toEqual({
      chat_id: USER,
      message_id: row.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("Cancel still deletes the message when the text is gone", async () => {
    const row = await toFinal();
    sqlite.prepare("DELETE FROM final_messages").run();
    await press("final_cancel", row.message_id);
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(row.message_id);
  });

  it("still gives the link and clears the report when the text cannot be saved", async () => {
    await toParking();
    await press("opt:0");
    await press("done");
    sqlite.exec("DROP TABLE final_messages");
    await giveLink();
    expect(lastSent().text).toContain("I was a pedestrian.");
    expect(draft()).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Saving the final message failed");
  });
});

describe("cancel and old buttons", () => {
  it("removes the draft and the buttons and leaves the rest", async () => {
    await toPhotos();
    const screen = buttonId();
    await press("cancel");
    expect(lastSent()).toEqual({ chat_id: USER, text: "Report cancelled" });
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
    expect(draft()).toBeUndefined();
  });
  it("redraws while waiting for recognition, with Cancel only", async () => {
    await toPhotos();
    await photo();
    const before = buttonId();
    sqlite.prepare("UPDATE drafts SET step = 'recognizing'").run();
    await text("hello");
    expect(buttonId()).not.toBe(before);
    expect(labels()).toEqual(["Cancel"]);
  });
  it("lets the user out of a report stuck on giving the link", async () => {
    await toPhotos();
    sqlite.prepare("UPDATE drafts SET step = 'finishing'").run();
    await press("cancel");
    expect(lastSent().text).toBe("Report cancelled");
    expect(draft()).toBeUndefined();
  });
  it("does not delete a new report when an old one finishes after a cancel", async () => {
    await toPhotos();
    await photo();
    await press("create");
    await press("plate_ok");
    await press("opt:0");
    await press("done");
    await press("road:Pedestrian");
    const screen = buttonId();
    const realFetch = globalThis.fetch;
    let release = () => {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/deleteMessages")) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return realFetch(url, init);
    });
    const finishing = press("review_ok", screen);
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await vi.waitFor(() => expect(draft().step).toBe("finishing"));
    await press("cancel", screen);
    await location();
    await vi.waitFor(() => expect(sentTexts().at(-1)).toContain("Main Street"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await finishing;
    expect(draft().step).toBe("address");
  });
  it("also deletes a message sent while the link is being given", async () => {
    await toPhotos();
    await photo();
    await press("create");
    await press("plate_ok");
    await press("opt:0");
    await press("done");
    await press("road:Pedestrian");
    const screen = buttonId();
    const realFetch = globalThis.fetch;
    let blocked = false;
    let release = () => {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/deleteMessages") && !blocked) {
        blocked = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return realFetch(url, init);
    });
    const finishing = press("review_ok", screen);
    await vi.waitFor(() => expect(blocked).toBe(true));
    nextMessage += 1;
    const lateId = nextMessage;
    await handleMessage(env, USER, USER, { message_id: lateId, date: 1793000000, text: "late" }, defer);
    release();
    await finishing;
    const deleted = called("deleteMessages").flatMap((call) => call.body.message_ids as number[]);
    expect(deleted).toContain(lateId);
    expect(draft()).toBeUndefined();
  });
  it("only stops the spinner on a button of a replaced screen", async () => {
    await location();
    const old = buttonId();
    await press("address_edit");
    const count = calls.length;
    await press("address_ok", old);
    expect(calls.slice(count).map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(draft().step).toBe("address_edit");
  });
  it("only stops the spinner when there is no draft", async () => {
    await press("address_ok", 1);
    expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
  });
  it("treats an expired draft as no draft", async () => {
    await toPhotos();
    sqlite.prepare("UPDATE drafts SET created_at = 0").run();
    await photo();
    expect(sentTexts().at(-1)).toBe("Now send photos, the first one with the number plate, or write the plate number");
    expect(draft().photo_count).toBe(0);
  });
});

describe("bot switched off", () => {
  const FORM_CHANGED =
    "The Traffic Watch report form has changed, so the bot is temporarily not working. The developer has been notified";
  const switchOff = () => sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();

  it("answers a location with the form-changed message and starts no report", async () => {
    switchOff();
    await location();
    expect(sentTexts()).toEqual([FORM_CHANGED]);
    expect(draft()).toBeUndefined();
  });
  it("answers a typed address the same way", async () => {
    switchOff();
    await text("12 Main Street");
    expect(sentTexts()).toEqual([FORM_CHANGED]);
    expect(draft()).toBeUndefined();
  });
  it("still shows /start and ignores a photo sent without a report", async () => {
    switchOff();
    await text("/start");
    await photo();
    expect(sentTexts()).toHaveLength(1);
    expect(lastSent().text).toContain("Third, to start a report, send location to the bot.");
    expect(draft()).toBeUndefined();
  });
  it("carries on a report that was already begun", async () => {
    await location();
    switchOff();
    await text("hello");
    expect(sentTexts().at(-1)).toBe("12 Main Street, Clongriffin, D13");
    await press("address_ok");
    expect(sentTexts().at(-1)).toBe("Now send photos, the first one with the number plate, or write the plate number");
    expect(sentTexts()).not.toContain(FORM_CHANGED);
  });
  it("starts reports again when the bot is switched on", async () => {
    switchOff();
    sqlite.prepare("UPDATE bot_switch SET enabled = 1").run();
    await location();
    expect(draft().step).toBe("address");
  });
});

describe("review, Edit and the phone", () => {
  async function toReview() {
    await toPlateTime();
    await press("plate_ok");
    await press("opt:1");
    await press("done");
    await press("road:Pedestrian");
  }
  const rowsOf = () => lastSent().reply_markup.inline_keyboard.map((line: { text: string }[]) => line.map((b) => b.text));
  const REPORT = "Vehicle 12-D-3456\nparked on a footpath\nat 12 Main Street, Clongriffin, D13\non 26/10/2026 at 07:33.\nI was a pedestrian.";

  it("shows the review under the last photo", async () => {
    await toReview();
    expect(lastSent().text).toBe(`${REPORT}\n\nIs everything correct?`);
    expect(rowsOf()).toEqual([["Yes, it’s correct"], ["Edit", "Cancel"]]);
    expect(lastSent().reply_parameters.message_id).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM report_log").get()).toEqual({ n: 0 });
  });

  it("shows the Edit screen, and Save goes back to the review", async () => {
    await toReview();
    await press("review_edit");
    expect(lastSent().text).toBe(REPORT);
    expect(rowsOf()).toEqual([
      ["Edit plate"],
      ["Edit description"],
      ["Edit address"],
      ["Edit time"],
      ['Edit "I was a"'],
      ["Save"],
      ["Cancel"],
    ]);
    await press("edit_save");
    expect(draft().step).toBe("review");
    expect(draft().editing).toBe(0);
    expect(lastSent().text).toBe(`${REPORT}\n\nIs everything correct?`);
  });

  it("comes back to the Edit screen after every kind of edit", async () => {
    await toReview();
    await press("review_edit");

    await press("edit_plate");
    expect(lastSent().text).toBe("12-D-3456\n\nWrite the plate number");
    await text("99-d-1");
    expect(draft().step).toBe("edit");
    expect(lastSent().text).toContain("Vehicle 99-D-1");

    await press("edit_time");
    await text("07:00");
    expect(draft().step).toBe("edit");
    expect(lastSent().text).toContain("at 07:00.");

    await press("edit_address");
    expect(lastSent().text).toBe("12 Main Street, Clongriffin, D13\n\nWrite the correct address");
    await text("1 New Road");
    expect(draft().step).toBe("edit");
    expect(lastSent().text).toContain("at 1 New Road");

    await press("edit_parking");
    expect(labels()).toContain("✅ on a footpath");
    await press("opt:0");
    await press("done");
    expect(draft().step).toBe("edit");
    expect(lastSent().text).toContain("parked on a cycle track\nand on a footpath");

    await press("edit_road_user");
    await press("road:E-Scooter User, E-Moped User, E-Cyclist");
    expect(draft().step).toBe("edit");
    expect(lastSent().text).toContain("I was a e-scooter user (e-moped user, e-cyclist).");
  });

  it("sends the form wording of Were you a in the link", async () => {
    await toReview();
    await press("review_edit");
    await press("edit_road_user");
    await press("road:E-Scooter User, E-Moped User, E-Cyclist");
    await press("edit_save");
    await press("review_ok");
    const url = lastSent().reply_markup.inline_keyboard[0][0].url as string;
    const data = JSON.parse(new TextDecoder().decode(Buffer.from(url.split("#sb=")[1], "base64url")));
    expect(data.r).toBe("E-Scooter User, E-Moped User, E-Cyclist");
    expect(data.d).not.toContain("I was a");
  });

  it("cancels the report from the review and the Edit screen", async () => {
    await toReview();
    await press("review_edit");
    await press("cancel");
    expect(draft()).toBeUndefined();
    expect(lastSent().text).toBe("Report cancelled");
  });

  it("asks for the phone before the first link only", async () => {
    sqlite.exec("DELETE FROM user_phones");
    await toReview();
    await press("review_ok");
    expect(draft().step).toBe("phone");
    expect(lastSent().text).toBe("Your phone?");
    expect(rowsOf()).toEqual([["iPhone bookmark"], ["iPhone Userscripts"], ["Android"], ["Cancel"]]);
    await press("phone:iphone_userscripts");
    expect(lastSent().text).toBe(
      `${REPORT}\n\n-> Press “Open report”,\n-> «⋯» on the top and “Open in Safari”,\n-> fill and send the report,\n-> press “Done” to close the form.`,
    );
    expect(sqlite.prepare("SELECT phone, reports FROM user_phones").get()).toEqual({ phone: "iphone_userscripts", reports: 1 });

    await toReview();
    await press("review_ok");
    expect(lastSent().reply_markup.inline_keyboard[0][0].text).toBe("Open report");
  });

  it("cancels the report on the phone question", async () => {
    sqlite.exec("DELETE FROM user_phones");
    await toReview();
    await press("review_ok");
    await press("cancel");
    expect(draft()).toBeUndefined();
    expect(lastSent().text).toBe("Report cancelled");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM user_phones").get()).toEqual({ n: 0 });
  });

  it("shows the steps of the bookmark on an iPhone", async () => {
    sqlite.exec("UPDATE user_phones SET phone = 'iphone_bookmark'");
    await toReview();
    await press("review_ok");
    expect(lastSent().text).toContain("-> «⋯» on the bottom and “Bookmarks”,\n-> press qqqwww,");
  });

  it("leaves the steps out after ten links, and /phone brings them back", async () => {
    sqlite.exec("UPDATE user_phones SET reports = 10");
    await toReview();
    await press("review_ok");
    expect(lastSent().text).toBe(REPORT);

    await text("/phone");
    expect(lastSent().text).toBe("Your phone?");
    expect(draft().step).toBe("phone_choice");
    const screen = buttonId();
    await press("phone:android");
    expect(draft()).toBeUndefined();
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(screen);
    expect(sqlite.prepare("SELECT phone, reports FROM user_phones").get()).toEqual({ phone: "android", reports: 0 });
  });

  it("Cancel on /phone only removes the screen", async () => {
    await text("/phone");
    const sent = called("sendMessage").length;
    await press("cancel");
    expect(draft()).toBeUndefined();
    expect(called("sendMessage").length).toBe(sent);
  });

  it("treats a choice of the phone older than two months as none", async () => {
    sqlite.exec("UPDATE user_phones SET last_used_at = 0");
    await toReview();
    await press("review_ok");
    expect(draft().step).toBe("phone");
  });

  it("takes the plate as text instead of a photo", async () => {
    await toPhotos();
    await text("12-d-3456");
    expect(draft().step).toBe("plate_time");
    expect(lastSent().text).toBe("Plate: 12-D-3456\nTime: 26/10/2026 07:33");
    await press("plate_ok");
    await press("opt:1");
    await press("done");
    await press("road:Pedestrian");
    expect(lastSent().reply_parameters).toBeUndefined();
    await press("review_ok");
    expect(lastSent().reply_parameters).toBeUndefined();
    expect(lastSent().text).toContain("on 26/10/2026 at 07:33.");
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["05KE123", "181 d 12345", "12-D-3456"])("takes %s as the plate before the first photo", async (value) => {
    await toPhotos();
    await text(value);
    expect(draft().step).toBe("plate_time");
    expect(draft().plate).toBe(value.toUpperCase());
  });

  it.each(["ок", "сейчас пришлю фото", "hello!", "- 1"])("does not take %s as the plate", async (value) => {
    await toPhotos();
    await text(value);
    expect(draft().step).toBe("photos");
    expect(draft().plate).toBeNull();
    expect(lastSent().text).toBe("Write the plate number");
  });

  it("refuses a plate that is too long and stays on the step", async () => {
    await toPhotos();
    await text("1234567890123456");
    expect(draft().step).toBe("photos");
    expect(lastSent().text).toBe("The plate number is too long. Please write it again");
  });

  it("does not take a text as the plate after a photo", async () => {
    await toPhotos();
    await photo();
    await text("12-D-3456");
    expect(draft().step).toBe("photos");
    expect(draft().plate).toBeNull();
  });

  it("keeps an open final message when a new report starts, so that its Cancel still works", async () => {
    await toReview();
    await press("review_ok");
    const row = sqlite.prepare("SELECT message_id FROM final_messages").get() as { message_id: number };
    await location();
    expect(called("editMessageText")).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM final_messages").get()).toEqual({ n: 1 });
    await press("final_cancel", row.message_id);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM report_log").get()).toEqual({ n: 0 });
    expect(draft().step).toBe("address");
  });

  it("closes the final messages older than 48 hours", async () => {
    await toReview();
    await press("review_ok");
    sqlite.exec("UPDATE final_messages SET created_at = 0");
    await closeExpiredFinalMessages(env);
    expect(called("editMessageText").at(-1)?.body).toMatchObject({ text: REPORT, reply_markup: { inline_keyboard: [] } });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM final_messages").get()).toEqual({ n: 0 });
  });

  it("keeps the stored text of a message that Telegram could not change", async () => {
    await toReview();
    await press("review_ok");
    sqlite.exec("UPDATE final_messages SET created_at = 0");
    failEdit = true;
    await closeExpiredFinalMessages(env);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM final_messages").get()).toEqual({ n: 1 });
    failEdit = false;
    await closeExpiredFinalMessages(env);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM final_messages").get()).toEqual({ n: 0 });
  });

  it("closes at most 30 messages per run, the oldest first", async () => {
    for (let i = 0; i < 35; i++) {
      sqlite.prepare("INSERT INTO final_messages (chat_id, message_id, text, created_at) VALUES (1, ?, 'x', ?)").run(i, i);
    }
    await closeExpiredFinalMessages(env);
    expect(called("editMessageText")).toHaveLength(30);
    expect(sqlite.prepare("SELECT MIN(message_id) AS first FROM final_messages").get()).toEqual({ first: 30 });
  });

  it("still gives the link and clears the report when the count of reports cannot be written", async () => {
    sqlite.exec("CREATE TRIGGER fail_count BEFORE UPDATE ON user_phones BEGIN SELECT RAISE(ABORT, 'down'); END");
    await toReview();
    await press("review_ok");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM final_messages").get()).toEqual({ n: 1 });
    expect(draft()).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Counting the report failed");
  });

  it("leaves a fresh final message open", async () => {
    await toReview();
    await press("review_ok");
    await closeExpiredFinalMessages(env);
    expect(called("editMessageText")).toEqual([]);
  });
});
