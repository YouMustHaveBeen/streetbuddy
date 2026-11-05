// Report texts: description template, Location field value and the link to the form.
import reference from "../../config/form.json";

const DESCRIPTION_LIMIT = 300;

export const PARKING_OPTIONS = [
  "on a cycle track",
  "on a footpath",
  "on a grass margin",
  "within 5m of a junction",
  "blocking a private driveway",
  "interfering with traffic flow",
  "obstructing and endangering traffic",
] as const;

type ParkingOption = (typeof PARKING_OPTIONS)[number];

// The "Were you a" options as the form words them, in the order of the bot's buttons.
export const ROAD_USER_TYPES = [
  "Pedestrian",
  "Passenger",
  "Driver",
  "Cyclist",
  "Motorcyclist",
  "E-Scooter User, E-Moped User, E-Cyclist",
] as const;

type RoadUserType = (typeof ROAD_USER_TYPES)[number];

const DUBLIN_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Date as the form expects it (dd/mm/yyyy) and 24-hour time, both in Dublin time.
export function dublinDateTime(timestampMs: number): { date: string; time: string } {
  const parts = DUBLIN_FORMAT.formatToParts(new Date(timestampMs));
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

interface ReportText {
  plate: string;
  parking: readonly ParkingOption[];
  address: string;
  date: string;
  time: string;
}

const sentence = (report: ReportText, address: string) =>
  `Vehicle ${report.plate} parked ${joinOptions(report.parking)} at ${address} on ${report.date} at ${report.time}.`;

// Shortens the address so that the description fits the limit.
function fitAddress(report: ReportText): string {
  const parts = report.address.split(", ");
  while (parts.length > 1 && sentence(report, parts.join(", ")).length > DESCRIPTION_LIMIT) {
    parts.pop();
  }
  const address = parts.join(", ");
  const excess = sentence(report, address).length - DESCRIPTION_LIMIT;
  return excess > 0 ? address.slice(0, Math.max(0, address.length - excess)).trimEnd() : address;
}

export function buildDescription(report: ReportText): string {
  return sentence(report, fitAddress(report));
}

// The same description for the final message of the bot: one part of it on every line, each
// parking option on a line of its own.
export function buildDescriptionLines(report: ReportText): string {
  const options = report.parking.map((option, i) => {
    const last = report.parking.length - 1;
    const text = i === 0 ? `parked ${option}` : i === last ? `and ${option}` : option;
    return i < last - 1 ? `${text},` : text;
  });
  return [
    `Vehicle ${report.plate}`,
    ...options,
    `at ${fitAddress(report)}`,
    `on ${report.date} at ${report.time}.`,
  ].join("\n");
}

export function buildLocation(address: string, lat: number, lon: number): string {
  return `${address} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The link to the form with the report data after "#", under one-letter keys.
export function buildReportLink(fields: {
  location: string;
  county: string;
  description: string;
  date: string;
  roadUser: RoadUserType;
}): string {
  const data = JSON.stringify({
    l: fields.location,
    c: fields.county,
    d: fields.description,
    t: fields.date,
    r: fields.roadUser,
  });
  return `${reference.url}#sb=${base64url(data)}`;
}
