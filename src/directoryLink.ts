// The signed, expiring link to the address directory map page.
import type { Env } from "./env";
import { DIRECTORY_PATH } from "./maps";
import { secretMatches } from "./secret";

export const DIRECTORY_LINK_TTL_MS = 60 * 60 * 1000;
export const LINK_EXPIRED_TEXT = "This link has expired";

type LinkEnv = Pick<Env, "SITE_URL" | "DIRECTORY_LINK_SECRET">;

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// The HMAC-SHA256 of the directory path and the expiry time, as hex.
async function sign(secret: string, expires: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${DIRECTORY_PATH}:${expires}`)));
}

// The link to the directory map page that works for DIRECTORY_LINK_TTL_MS from now.
export async function directoryLink(env: LinkEnv, now = Date.now()): Promise<string> {
  const expires = String(Math.floor((now + DIRECTORY_LINK_TTL_MS) / 1000));
  return `${env.SITE_URL}${DIRECTORY_PATH}?exp=${expires}&sig=${await sign(env.DIRECTORY_LINK_SECRET, expires)}`;
}

// True when the parameters hold a signature made with the secret and an expiry time still ahead.
export async function isDirectoryLinkValid(
  env: Pick<Env, "DIRECTORY_LINK_SECRET">,
  params: URLSearchParams,
  now = Date.now(),
): Promise<boolean> {
  const expires = params.get("exp");
  const signature = params.get("sig");
  if (!env.DIRECTORY_LINK_SECRET || !expires || !/^\d{1,15}$/.test(expires) || Number(expires) * 1000 <= now) return false;
  return secretMatches(signature, await sign(env.DIRECTORY_LINK_SECRET, expires));
}
