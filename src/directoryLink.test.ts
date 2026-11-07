import { describe, expect, it } from "vitest";
import { DIRECTORY_LINK_TTL_MS, directoryLink, isDirectoryLinkValid } from "./directoryLink";

const env = { SITE_URL: "https://site.example", DIRECTORY_LINK_SECRET: "link-secret" };
const NOW = Date.UTC(2026, 10, 7, 12);
const paramsOf = (link: string) => new URL(link).searchParams;

describe("the directory link", () => {
  it("points at the directory page with an expiry time and a signature", async () => {
    const link = await directoryLink(env, NOW);
    expect(link).toMatch(/^https:\/\/site\.example\/directory\?exp=\d+&sig=[0-9a-f]{64}$/);
    expect(paramsOf(link).get("exp")).toBe(String((NOW + DIRECTORY_LINK_TTL_MS) / 1000));
  });

  it("is valid until the hour is over", async () => {
    const params = paramsOf(await directoryLink(env, NOW));
    expect(await isDirectoryLinkValid(env, params, NOW)).toBe(true);
    expect(await isDirectoryLinkValid(env, params, NOW + DIRECTORY_LINK_TTL_MS - 1000)).toBe(true);
    expect(await isDirectoryLinkValid(env, params, NOW + DIRECTORY_LINK_TTL_MS)).toBe(false);
  });

  it("is not valid with another expiry time, another signature or another secret", async () => {
    const params = paramsOf(await directoryLink(env, NOW));
    const later = new URLSearchParams(params);
    later.set("exp", String(Number(params.get("exp")) + 3600));
    const otherSig = new URLSearchParams(params);
    otherSig.set("sig", "0".repeat(64));
    expect(await isDirectoryLinkValid(env, later, NOW)).toBe(false);
    expect(await isDirectoryLinkValid(env, otherSig, NOW)).toBe(false);
    expect(await isDirectoryLinkValid({ DIRECTORY_LINK_SECRET: "another" }, params, NOW)).toBe(false);
  });

  it("is not valid when a parameter is missing or the expiry time is not a number", async () => {
    const params = paramsOf(await directoryLink(env, NOW));
    expect(await isDirectoryLinkValid(env, new URLSearchParams({ sig: params.get("sig")! }), NOW)).toBe(false);
    expect(await isDirectoryLinkValid(env, new URLSearchParams({ exp: params.get("exp")! }), NOW)).toBe(false);
    expect(await isDirectoryLinkValid(env, new URLSearchParams({ exp: "1e12", sig: params.get("sig")! }), NOW)).toBe(false);
  });

  it("is never valid when the secret is not set", async () => {
    const params = paramsOf(await directoryLink(env, NOW));
    expect(await isDirectoryLinkValid({ DIRECTORY_LINK_SECRET: "" }, params, NOW)).toBe(false);
  });
});
