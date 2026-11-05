// Address lookup through OpenStreetMap Nominatim, cached in D1.
import { areaBounds } from "./area";
import type { Area } from "./area";
import { DAY_MS, REQUEST_TIMEOUT_MS, sleep } from "./shared";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "StreetBuddy (t.me/streetbuddy_bot)";
const MIN_INTERVAL_MS = 1000;

// How long a cached address is kept; older rows are removed by the scheduled cleanup.
export const GEOCODE_CACHE_TTL_MS = 60 * DAY_MS;

const EIRCODE = /^([AC-FHKNPRTV-Y]\d{2}|D6W)\s?([0-9AC-FHKNPRTV-Y]{4})$/i;

// Runs work after the caller has finished, without making it wait.
export type Defer = (work: Promise<unknown>) => void;

export interface Place {
  address: string;
  lat: number;
  lon: number;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
}

// "12 Main Street, Clongriffin, D13 X1Y2"; anything but a full Eircode gives way to the
// postal district of the area.
function formatAddress(details: Record<string, string>, area: Area): string {
  const street =
    details.road ?? details.pedestrian ?? details.footway ?? details.cycleway ?? details.path;
  const line = [details.house_number, street].filter(Boolean).join(" ");
  const locality = details.suburb ?? details.neighbourhood ?? details.quarter;
  const eircode = EIRCODE.exec((details.postcode ?? "").trim());
  const postal = eircode
    ? `${eircode[1].toUpperCase()} ${eircode[2].toUpperCase()}`
    : area.postalDistrict;
  return [line, locality, postal].filter(Boolean).join(", ");
}

function toPlace(result: NominatimResult | undefined, area: Area): Place | null {
  if (!result?.address) return null;
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { address: formatAddress(result.address, area), lat, lon };
}

// Reserves the next free Nominatim slot in D1 and waits for it.
async function waitForSlot(db: D1Database): Promise<void> {
  const row = await db
    .prepare(
      "UPDATE nominatim_rate SET next_at = MAX(next_at, ?1) + ?2 WHERE id = 1 RETURNING next_at",
    )
    .bind(Date.now(), MIN_INTERVAL_MS)
    .first<{ next_at: number }>();
  const wait = (row?.next_at ?? 0) - MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
}

// Returns null when nothing is found (not cached); throws when Nominatim fails.
// The result is written to the cache in the background.
async function lookup(
  db: D1Database,
  key: string,
  url: URL,
  area: Area,
  pick: (body: unknown) => NominatimResult | undefined,
  defer: Defer,
): Promise<Place | null> {
  const cached = await db
    .prepare("SELECT address, lat, lon FROM geocode_cache WHERE key = ?1")
    .bind(key)
    .first<Place>();
  if (cached) return cached;

  await waitForSlot(db);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);

  const place = toPlace(pick(await response.json()), area);
  if (!place) return null;
  defer(
    db
      .prepare(
        "INSERT OR REPLACE INTO geocode_cache (key, address, lat, lon, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(key, place.address, place.lat, place.lon, Date.now())
      .run()
      .catch(() => console.error("Saving the address failed")),
  );
  return place;
}

// Address for coordinates, rounded to about 10 m for the request and the cache.
export async function reverseGeocode(
  db: D1Database,
  area: Area,
  lat: number,
  lon: number,
  defer: Defer,
): Promise<string | null> {
  const roundedLat = lat.toFixed(4);
  const roundedLon = lon.toFixed(4);
  const url = new URL(`${NOMINATIM_URL}/reverse`);
  url.search = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    lat: roundedLat,
    lon: roundedLon,
  }).toString();
  const place = await lookup(db, `r:${roundedLat},${roundedLon}`, url, area, (body) => body as NominatimResult, defer);
  return place?.address ?? null;
}

// Place for a typed address, searched only inside the rectangle around the district.
export async function searchAddress(
  db: D1Database,
  area: Area,
  text: string,
  defer: Defer,
): Promise<Place | null> {
  const query = text.trim().replace(/\s+/g, " ");
  const { west, south, east, north } = areaBounds(area);
  const url = new URL(`${NOMINATIM_URL}/search`);
  url.search = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    countrycodes: "ie",
    bounded: "1",
    viewbox: `${west},${north},${east},${south}`,
    q: query,
  }).toString();
  return lookup(
    db,
    `s:${query.toLowerCase()}`,
    url,
    area,
    (body) => (Array.isArray(body) ? (body[0] as NominatimResult | undefined) : undefined),
    defer,
  );
}
