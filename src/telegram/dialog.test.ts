import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { district } from "../core";
import { handleButton, handleMessage } from "./dialog";
import type { DialogEnv, Message } from "./dialog";

const USER = 42;
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

const called = (method: string) => calls.filter((call) => call.method === method);
const sentTexts = () => called("sendMessage").map((call) => call.body.text);
const lastSent = () => called("sendMessage").at(-1)?.body as { text: string; reply_markup?: any; reply_parameters?: any };
const draft = () => sqlite.prepare("SELECT * FROM drafts WHERE user_id = ?").get(USER) as any;
const buttonId = () => (draft()?.buttons_message_id ?? 0) as number;
const labels = () => lastSent().reply_markup.inline_keyboard.flat().map((b: { text: string }) => b.text);

const message = (fields: Partial<Message>) => {
  nextMessage += 1;
  return handleMessage(env, USER, USER, { message_id: nextMessage, date: 1793000000, ...fields });
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
const press = (data: string, messageId = buttonId()) =>
  handleButton(env, USER, USER, { id: "q", data, messageId });

async function toPhotos() {
  await location();
  await press("address_ok");
}
async function toPlateTime() {
  await toPhotos();
  await photo();
  await press("create");
}

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  run = vi.fn(async () => ({ response: '["12-D-3456"]' }));
  env = { AI: { run } as unknown as Ai, DB: fake.db, TELEGRAM_BOT_TOKEN: "token" };
  calls = [];
  nextId = 1000;
  nextMessage = 0;
  failSend = false;
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
      if (method === "sendMessage" && failSend) return new Response(JSON.stringify({ ok: false, error_code: 500 }));
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
  it("shows the text with the Location button", async () => {
    await text("/start");
    expect(lastSent().text).toContain("To start a report, send your location.");
    expect(lastSent().text).not.toContain("<link>");
    expect(lastSent().reply_markup.keyboard[0][0]).toEqual({ text: "Location", request_location: true });
    expect(draft()).toBeUndefined();
  });
  it("keeps the draft in the middle of a report and moves its screen below", async () => {
    await location();
    const before = buttonId();
    await text("/start");
    expect(draft().step).toBe("address");
    expect(sentTexts().at(-1)).toBe("12 Main Street, Clongriffin, D13");
    expect(called("deleteMessage").at(-1)?.body.message_id).toBe(before);
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
    expect(lastSent().text).toBe("Could not get the address. Please try again in a minute.");
    await location();
    expect(lastSent().text).toBe("Could not get the address. Please write it.");
    await text("My street");
    expect(lastSent().text).toBe("My street");
    expect(draft().address).toBe("My street");
    expect(draft().lat).toBe(latInside);
  });
  it("after two failures on a typed address asks for the location", async () => {
    nominatim = () => new Response("", { status: 500 });
    await text("Main Street");
    await text("Main Street");
    expect(lastSent().text).toBe("Please send the location.");
    expect(draft().step).toBe("location");
  });
  it("edits the address, keeps the coordinates, limits the length", async () => {
    await location();
    await press("address_edit");
    expect(lastSent().text).toBe("Write the correct address.");
    await text("x".repeat(101));
    expect(lastSent().text).toBe("The address must be 100 characters or less.");
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
  it("ignores a new location in the middle of a report and redraws", async () => {
    await toPhotos();
    await location(53.0, -7.0);
    expect(draft().step).toBe("photos");
    expect(lastSent().text).toBe("Now send photos, the first one with the number plate.");
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
    await handleMessage(env, USER, USER, { message_id: 501, date: 1793000100, photo: size("later") });
    await handleMessage(env, USER, USER, { message_id: 500, date: 1793000000, photo: size("earlier") });
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
    expect(lastSent().text).toBe("Several plates found. Choose one.");
    expect(labels()).toEqual(["12-D-1", "13-D-2", "Add", "Cancel"]);
    await press("pick:1");
    expect(lastSent().text).toContain("Plate: 13-D-2");
  });
  it("Add asks for the plate", async () => {
    run.mockImplementation(async () => ({ response: '["12-D-1", "13-D-2"]' }));
    await toPlateTime();
    await press("plate_add");
    expect(lastSent().text).toBe("Write the plate number.");
    await text("99-D-1");
    expect(lastSent().text).toContain("Plate: 99-D-1");
  });
  it("asks by hand when recognition fails, and rejects a long plate", async () => {
    run.mockImplementation(async () => {
      throw new Error("limit");
    });
    await toPlateTime();
    expect(lastSent().text).toBe("Could not read the plate. Please write it.");
    await text("1234567890123456");
    expect(lastSent().text).toBe("The plate number is too long. Please write it again.");
    await text("123456789012345");
    expect(lastSent().text).toContain("Plate: 123456789012345");
  });
  it("writes a typed plate in capitals with single spaces", async () => {
    await toPlateTime();
    await press("plate_edit");
    await text(" 12-d   3456 ");
    expect(lastSent().text).toContain("Plate: 12-D 3456");
  });
  it("asks again for a plate that is only blank characters", async () => {
    await toPlateTime();
    await press("plate_edit");
    await text("\u00a0");
    expect(lastSent().text).toBe("Write the plate number.");
    expect(draft().step).toBe("plate_input");
  });
  it("changes only the time and rejects a wrong or future one", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1793000000000 + 3600000);
    const original = draftTime(1793000000000);
    await toPlateTime();
    await press("time_edit");
    expect(lastSent().text).toBe("Write the time as hh:mm.");
    await text("25:00");
    expect(lastSent().text).toBe("Wrong time. Please write it again.");
    await text("23:59");
    expect(lastSent().text).toBe("Wrong time. Please write it again.");
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
    expect(lastSent().text).toBe("Choose one or more options, then press Done.");
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
    expect(called("answerCallbackQuery").at(-1)?.body.text).toBe("Choose at least one option.");
    expect(draft().step).toBe("parking");
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

    const final = lastSent();
    expect(final.text).toContain("Plate: 12-D-3456\nLocation: 12 Main Street, Clongriffin, D13\nDate and time: ");
    expect(final.text).toContain("parked on a footpath and blocking a private driveway at");
    expect(final.text).toContain("Open the link in an external browser.");
    expect(final.reply_parameters.message_id).toBe(lastPhoto);
    const button = final.reply_markup.inline_keyboard[0][0];
    expect(button.text).toBe("Open form");
    const data = JSON.parse(atob(button.url.split("#sb=")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(data.c).toBe("Dublin");
    expect(data.l).toContain(latInside.toFixed(5));
    const removed = called("deleteMessages").flatMap((call) => call.body.message_ids as number[]);
    expect(removed).toContain(screen);
    expect(removed).not.toContain(lastPhoto);
    expect(draft()).toBeUndefined();
  });
  it("keeps the report when Telegram fails to send the final message", async () => {
    await toParking();
    await press("opt:0");
    failSend = true;
    await press("done");
    expect(draft().step).toBe("parking");
    expect(called("deleteMessages")).toEqual([]);
  });
  it("gives one link for a double tap", async () => {
    await toParking();
    await press("opt:0");
    const screen = buttonId();
    await press("done", screen);
    await press("done", screen);
    expect(sentTexts().filter((value) => String(value).startsWith("Plate:") && String(value).includes("Description"))).toHaveLength(1);
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
  it("lets the user out of a report stuck on giving the link", async () => {
    await toPhotos();
    sqlite.prepare("UPDATE drafts SET step = 'finishing'").run();
    await press("cancel");
    expect(lastSent().text).toBe("Report cancelled");
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
    expect(sentTexts().at(-1)).toBe("Now send photos, the first one with the number plate.");
    expect(draft().photo_count).toBe(0);
  });
});
