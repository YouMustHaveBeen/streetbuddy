import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { disableBot, isBotEnabled } from "./switch";

describe("bot switch", () => {
  it("is on by default", async () => {
    const { db } = fakeD1();
    expect(await isBotEnabled(db)).toBe(true);
  });
  it("is turned off once, and says so only to the call that turned it off", async () => {
    const { db } = fakeD1();
    expect(await disableBot(db)).toBe(true);
    expect(await isBotEnabled(db)).toBe(false);
    expect(await disableBot(db)).toBe(false);
    expect(await isBotEnabled(db)).toBe(false);
  });
  it("is on again after the owner sets it", async () => {
    const { db, sqlite } = fakeD1();
    await disableBot(db);
    sqlite.prepare("UPDATE bot_switch SET enabled = 1 WHERE id = 1").run();
    expect(await isBotEnabled(db)).toBe(true);
    expect(await disableBot(db)).toBe(true);
  });
});
