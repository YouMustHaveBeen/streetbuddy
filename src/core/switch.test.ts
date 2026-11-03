import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { disableBot, enableBot, getSwitchStatus, isBotEnabled, recordFormCheck } from "./switch";

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
  it("holds only the values 0 and 1", () => {
    const { sqlite } = fakeD1();
    expect(() => sqlite.prepare("UPDATE bot_switch SET enabled = 2 WHERE id = 1").run()).toThrow();
  });
  it("is on again after the owner sets it", async () => {
    const { db, sqlite } = fakeD1();
    await disableBot(db);
    sqlite.prepare("UPDATE bot_switch SET enabled = 1 WHERE id = 1").run();
    expect(await isBotEnabled(db)).toBe(true);
    expect(await disableBot(db)).toBe(true);
  });
  it("is turned on by enableBot, also when it is on already", async () => {
    const { db } = fakeD1();
    await disableBot(db);
    await enableBot(db);
    expect(await isBotEnabled(db)).toBe(true);
    await enableBot(db);
    expect(await isBotEnabled(db)).toBe(true);
  });
});

describe("switch status", () => {
  it("has no last check before the first one", async () => {
    const { db } = fakeD1();
    expect(await getSwitchStatus(db)).toEqual({ enabled: true, lastCheck: null });
  });
  it("shows the switch and the last check together", async () => {
    const { db } = fakeD1();
    await disableBot(db);
    await recordFormCheck(db, 1000, "changed");
    expect(await getSwitchStatus(db)).toEqual({
      enabled: false,
      lastCheck: { checkedAt: 1000, result: "changed" },
    });
  });
  it("keeps one row that each check overwrites", async () => {
    const { db, sqlite } = fakeD1();
    await recordFormCheck(db, 1000, "unloaded");
    await recordFormCheck(db, 2000, "ok");
    expect(sqlite.prepare("SELECT id, checked_at, result FROM form_check").all()).toEqual([
      { id: 1, checked_at: 2000, result: "ok" },
    ]);
  });
  it("holds only the three results", () => {
    const { sqlite } = fakeD1();
    expect(() =>
      sqlite.prepare("INSERT INTO form_check (id, checked_at, result) VALUES (1, 1, 'broken')").run(),
    ).toThrow();
  });
});
