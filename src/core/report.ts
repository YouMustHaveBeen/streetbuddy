// Report texts: description template, Location field value and the link to the form.

const DESCRIPTION_LIMIT = 300;
const FORM_URL = "https://www.garda.ie/en/trafficwatchreport/";

export const PARKING_OPTIONS = [
  "on a cycle track",
  "on a footpath",
  "on a grass margin",
  "within 5m of a junction",
  "blocking a private driveway",
  "interfering with traffic flow",
  "obstructing and endangering traffic",
] as const;

export type ParkingOption = (typeof PARKING_OPTIONS)[number];

// Date as the form expects it (dd/mm/yyyy) and 24-hour time, both in Dublin time.
export function dublinDateTime(timestampMs: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestampMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("day")}/${get("month")}/${get("year")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function joinOptions(options: readonly ParkingOption[]): string {
  if (options.length < 2) return options.join("");
  return `${options.slice(0, -1).join(", ")} and ${options[options.length - 1]}`;
}

export function buildDescription(report: {
  plate: string;
  parking: readonly ParkingOption[];
  address: string;
  date: string;
  time: string;
}): string {
  const text = (address: string) =>
    `Vehicle ${report.plate} parked ${joinOptions(report.parking)} at ${address} on ${report.date} at ${report.time}.`;

  // The form states a 300-character limit but does not enforce it. Only the address
  // here is shortened: the full one stays in the Location field.
  const parts = report.address.split(", ");
  while (parts.length > 1 && text(parts.join(", ")).length > DESCRIPTION_LIMIT) {
    parts.pop();
  }
  const address = parts.join(", ");
  const excess = text(address).length - DESCRIPTION_LIMIT;
  return excess > 0 ? text(address.slice(0, Math.max(0, address.length - excess)).trimEnd()) : text(address);
}

export function buildLocation(address: string, lat: number, lon: number): string {
  return `${address} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The form ignores everything after "#", and the fragment is never sent to its server.
// One-letter keys keep the link short.
export function buildReportLink(fields: {
  location: string;
  county: string;
  description: string;
  date: string;
}): string {
  const data = JSON.stringify({
    l: fields.location,
    c: fields.county,
    d: fields.description,
    t: fields.date,
  });
  return `${FORM_URL}#sb=${base64url(data)}`;
}
