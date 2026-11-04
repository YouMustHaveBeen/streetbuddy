import { describe, expect, it } from "vitest";
import {
  buildDescription,
  buildLocation,
  buildReportLink,
  dublinDateTime,
  PARKING_OPTIONS,
} from "./report";

const base = { plate: "12-D-3456", date: "02/11/2026", time: "13:02" };

function decodeLink(link: string): unknown {
  const data = link.split("#sb=")[1];
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("dublinDateTime", () => {
  it("uses GMT in winter", () => {
    expect(dublinDateTime(Date.UTC(2026, 10, 2, 13, 2))).toEqual({ date: "02/11/2026", time: "13:02" });
  });
  it("uses summer time, including across midnight", () => {
    expect(dublinDateTime(Date.UTC(2026, 6, 31, 23, 30))).toEqual({ date: "01/08/2026", time: "00:30" });
  });
});

describe("buildDescription", () => {
  it("matches the template with one option", () => {
    expect(
      buildDescription({ ...base, parking: ["on a footpath"], address: "Main Street, Clongriffin, D13" }),
    ).toBe("Vehicle 12-D-3456 parked on a footpath at Main Street, Clongriffin, D13 on 02/11/2026 at 13:02.");
  });
  it("joins options with commas and a final and", () => {
    expect(
      buildDescription({
        ...base,
        parking: ["on a cycle track", "on a footpath", "blocking a private driveway"],
        address: "D13",
      }),
    ).toContain("parked on a cycle track, on a footpath and blocking a private driveway at D13");
  });
  it("drops address parts from the end when too long", () => {
    const text = buildDescription({
      ...base,
      parking: PARKING_OPTIONS,
      address: `12 Main Street, ${"Clongriffin".repeat(8)}, D13`,
    });
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).toContain(" at 12 Main Street on ");
    expect(text).not.toContain("D13");
  });
  it("cuts the last part when dropping is not enough", () => {
    const text = buildDescription({ ...base, parking: PARKING_OPTIONS, address: "x".repeat(400) });
    expect(text).toHaveLength(300);
    expect(text.endsWith(" on 02/11/2026 at 13:02.")).toBe(true);
  });
});

describe("buildLocation", () => {
  it("adds coordinates with 5 decimals", () => {
    expect(buildLocation("Main Street, D13", 53.401234, -6.1656789)).toBe("Main Street, D13 (53.40123, -6.16568)");
  });
});

describe("buildReportLink", () => {
  it("packs the fields into URL-safe base64, keeping Irish letters", () => {
    const fields = {
      location: "Sráid Mhór?>~ (53.4, -6.1)",
      county: "Dublin",
      description: "á é",
      date: "02/11/2026",
      roadUser: "E-Scooter User, E-Moped User, E-Cyclist" as const,
    };
    const link = buildReportLink(fields);
    expect(link.startsWith("https://www.garda.ie/en/trafficwatchreport/#sb=")).toBe(true);
    expect(link.split("#sb=")[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLink(link)).toEqual({
      l: fields.location,
      c: fields.county,
      d: fields.description,
      t: fields.date,
      r: fields.roadUser,
    });
  });
});
