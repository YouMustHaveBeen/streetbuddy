// Daily check of the Traffic Watch report form against config/form.json: the ids of the
// fields the script fills, the option lists it picks from, and the code of the site's own
// script that creates the date field after "Click Here to Start".
import reference from "../../config/form.json";
import { REQUEST_TIMEOUT_MS } from "./shared";

// "unloaded" marks a page or script that could not be fetched.
export type FormCheck = { ok: true } | { ok: false; reason: string; unloaded?: true };

// A failed request is repeated once; throws when it fails again.
async function fetchText(url: string): Promise<string> {
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok) return await response.text();
      failure = new Error(`responded ${response.status}`);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// An id attribute with this exact value: the attribute name in any case, the value in double
// quotes, single quotes or none, and not part of a longer name such as `data-id`.
function idAttribute(id: string): string {
  const value = escapeRegExp(id);
  return `(?<![\\w-])[iI][dD]\\s*=\\s*(?:"${value}"|'${value}'|${value}(?=[\\s>]|/>))`;
}

function hasId(html: string, id: string): boolean {
  return new RegExp(idAttribute(id)).test(html);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// The visible text of an option: tags removed, entities decoded, spaces trimmed.
function optionText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        // A reference above the last Unicode code point is left as is.
        return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Option texts of the select with this id, or null when there is no such select.
function selectOptions(html: string, id: string): string[] | null {
  const select = new RegExp(`<select\\b[^>]*${idAttribute(id)}[^>]*>([\\s\\S]*?)</select>`, "i").exec(html);
  if (!select) return null;
  return [...select[1].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map((option) => optionText(option[1]));
}

// Scripts of the site itself: the ones loaded from the same host as the form page.
function sameHostScripts(html: string, pageUrl: string): string[] {
  const urls = new Set<string>();
  for (const tag of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(tag[1], pageUrl);
      if (url.host === new URL(pageUrl).host) urls.add(url.href);
    } catch {
      // A script address that cannot be read is not a site script.
    }
  }
  return [...urls];
}

const sameItems = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export async function checkForm(): Promise<FormCheck> {
  let html: string;
  try {
    html = await fetchText(reference.url);
  } catch {
    return { ok: false, reason: "the form page could not be loaded", unloaded: true };
  }

  for (const id of reference.fields) {
    if (!hasId(html, id)) return { ok: false, reason: `field ${id} is missing` };
  }
  for (const [id, expected] of Object.entries(reference.lists)) {
    const actual = selectOptions(html, id);
    if (!actual || !sameItems(actual, expected)) return { ok: false, reason: `options of ${id} changed` };
  }

  // Looks for the prefix of the date id in the page and then in the site's script files.
  if (html.includes(reference.datePrefix)) return { ok: true };
  // A script that cannot be loaded is skipped and the search goes on.
  let unloaded = false;
  for (const url of sameHostScripts(html, reference.url)) {
    try {
      if ((await fetchText(url)).includes(reference.datePrefix)) return { ok: true };
    } catch {
      unloaded = true;
    }
  }
  if (unloaded) return { ok: false, reason: "a site script could not be loaded", unloaded: true };
  return { ok: false, reason: `the script no longer creates ${reference.datePrefix}` };
}
