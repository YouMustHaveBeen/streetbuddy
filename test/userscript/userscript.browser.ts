// Runs the real form-filling script in a headless browser against a copy of the report form.
// The script is put into the page directly, so its @match lines and its code stay untouched.
// Run with: npm run test:userscript
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDescription, buildLocation, buildReportLink, dublinDateTime } from "../../src/core/report";
import { INSTALL_PATH, SCRIPT_PATH, installPage, userscriptFile } from "../../src/install";
import { MANUAL_PATH, manualPage } from "../../src/manual";

const FORM_PATH = "/en/trafficwatchreport/";
const SCRIPT = readFileSync("userscript/streetbuddy.user.js", "utf8");
const FORM_HTML = readFileSync("test/userscript/form.html", "utf8");
const VENDOR_FILES: Record<string, string> = {
  "/vendor/jquery.min.js": "node_modules/jquery/dist/jquery.min.js",
  "/vendor/bootstrap-datepicker.min.js": "node_modules/bootstrap-datepicker/dist/js/bootstrap-datepicker.min.js",
  "/vendor/bootstrap-datepicker.en-IE.min.js":
    "node_modules/bootstrap-datepicker/dist/locales/bootstrap-datepicker.en-IE.min.js",
};

// Made-up personal data.
const PROFILE = {
  name: "Test Person",
  phone: "0870000000",
  email: "test.person@example.com",
  address: "1 Test Road, Dublin",
  contact: "Email",
};

const FIELD_IDS = [
  "Location",
  "County",
  "Crime",
  "RoadUserType",
  "CrimeDescription",
  "crimeDate_1",
  "UserName",
  "Phone",
  "Email",
  "UserAddress",
  "ContactMethod",
] as const;

// The script waits this long for the fields; the tests wait a little longer.
const FIELDS_TIMEOUT_MS = 10000;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === FORM_PATH) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(FORM_HTML);
    } else if (path === INSTALL_PATH || path === MANUAL_PATH || path === SCRIPT_PATH) {
      // The pages of the Worker itself, served by its own code.
      const served = path === INSTALL_PATH ? installPage() : path === MANUAL_PATH ? manualPage() : userscriptFile();
      void served.text().then((body) => {
        response.writeHead(200, { "content-type": served.headers.get("content-type") ?? "text/plain" });
        response.end(body);
      });
    } else if (VENDOR_FILES[path]) {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(readFileSync(VENDOR_FILES[path]));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

// A new context is a new browser profile: its session storage starts empty.
// `changeForm` edits the page text before the browser gets it (to take a field or option away).
// `profile` is the personal data the bookmarklet puts on the page.
async function newContext(
  changeForm?: (html: string) => string,
  profile: object = PROFILE,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(`globalThis.STREETBUDDY_PROFILE = ${JSON.stringify(profile)};\n${SCRIPT}`);
  if (changeForm) {
    await context.route(`**${FORM_PATH}`, (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: changeForm(FORM_HTML) }),
    );
  }
  return context;
}

// The link is built by the bot's own code; only its host is replaced by the test server.
function linkTo(fields: Parameters<typeof buildReportLink>[0]): string {
  const link = buildReportLink(fields);
  return origin + FORM_PATH + link.slice(link.indexOf("#"));
}

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function yesterday(): string {
  return dublinDateTime(Date.now() - 24 * 60 * 60 * 1000).date;
}

// What the person does: ticks both boxes and presses "Click Here to Start".
async function tickAndStart(page: Page): Promise<void> {
  await page.check("#NotAnEmergencyCheckbox");
  await page.check("#AttendCourtCheckbox");
  await page.click("#startBtn");
}

async function fieldValues(page: Page): Promise<Record<string, string | null>> {
  return (await page.evaluate(
    `Object.fromEntries(${JSON.stringify(FIELD_IDS)}.map((id) => [id, document.getElementById(id)?.value ?? null]))`,
  )) as Record<string, string | null>;
}

async function waitUntilFilled(page: Page): Promise<void> {
  await page.waitForFunction("document.getElementById('ContactMethod').value !== ''");
}

function expectedValues(fields: Parameters<typeof buildReportLink>[0]) {
  return {
    Location: fields.location,
    County: fields.county,
    Crime: "Parking Offences",
    RoadUserType: fields.roadUser,
    CrimeDescription: fields.description,
    crimeDate_1: fields.date,
    UserName: PROFILE.name,
    Phone: PROFILE.phone,
    Email: PROFILE.email,
    UserAddress: PROFILE.address,
    ContactMethod: PROFILE.contact,
  };
}

function ordinaryReport(): Parameters<typeof buildReportLink>[0] {
  return {
    location: buildLocation("Main Street, Swords, Fingal, County Dublin", 53.45975, -6.21811),
    county: "Dublin",
    description: buildDescription({
      plate: "12-D-3456",
      parking: ["on a footpath", "blocking a private driveway"],
      address: "Main Street, Swords, Fingal, County Dublin",
      date: yesterday(),
      time: "13:02",
    }),
    date: yesterday(),
    roadUser: "Pedestrian",
  };
}

async function expectNothingWritten(page: Page): Promise<void> {
  const values = await fieldValues(page);
  for (const id of FIELD_IDS) expect(values[id] ?? "", id).toBe("");
}

describe("form-filling script on a copy of the report form", () => {
  it("fills every field only after the person ticked the boxes and pressed Start", async () => {
    const context = await newContext();
    const sent: string[] = [];
    context.on("request", (request) => {
      if (request.method() === "POST") sent.push(request.url());
    });
    const page = await context.newPage();
    const report = ordinaryReport();
    await page.goto(linkTo(report));

    // Before Start: the script has cleaned the address bar and touched nothing.
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain("#sb=");
    expect(await page.isChecked("#NotAnEmergencyCheckbox")).toBe(false);
    expect(await page.isChecked("#AttendCourtCheckbox")).toBe(false);
    await expectNothingWritten(page);
    await page.getByRole("status").filter({ hasText: /StreetBuddy is running/ }).waitFor();

    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual(expectedValues(report));
    expect(await page.getByRole("status").filter({ hasText: /StreetBuddy is running/ }).count()).toBe(0);

    // The date picker must keep the date when it closes, and the form's own checks must pass.
    await page.click("h2");
    await page.waitForTimeout(500);
    expect((await fieldValues(page)).crimeDate_1).toBe(report.date);
    for (const id of ["err_date_container", "err_location_container", "err_empty_container"]) {
      expect(await page.isVisible(`#${id}`), id).toBe(false);
    }

    // Nothing is sent and the captcha is not touched.
    expect(await page.isVisible("#SuccessPlaceHolder")).toBe(false);
    expect(await page.locator("[role=alert]").count()).toBe(0);
    expect(sent).toEqual([]);
    await context.close();
  });

  it("fills the form again after a reload", async () => {
    const context = await newContext();
    const page = await context.newPage();
    const report = ordinaryReport();
    await page.goto(linkTo(report));
    await tickAndStart(page);
    await waitUntilFilled(page);

    await page.reload();
    expect(page.url()).not.toContain("#sb=");
    await expectNothingWritten(page);
    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual(expectedValues(report));
    await context.close();
  });

  it("fills the form when the same link is opened again in another tab", async () => {
    const context = await newContext();
    const report = ordinaryReport();
    const link = linkTo(report);
    const first = await context.newPage();
    await first.goto(link);
    await tickAndStart(first);
    await waitUntilFilled(first);

    const second = await context.newPage();
    await second.goto(link);
    await tickAndStart(second);
    await waitUntilFilled(second);
    expect(await fieldValues(second)).toEqual(expectedValues(report));
    await context.close();
  });

  it("uses the newer link when another link is opened in the same tab", async () => {
    const context = await newContext();
    const page = await context.newPage();
    const older = ordinaryReport();
    await page.goto(linkTo(older));
    await tickAndStart(page);
    await waitUntilFilled(page);

    const newer = {
      ...older,
      location: buildLocation("Church Road, Malahide, Fingal, County Dublin", 53.45097, -6.15439),
      county: "Meath",
      description: "Vehicle 99-MH-1 parked on a cycle track.",
    };
    await page.goto("about:blank");
    await page.goto(linkTo(newer));
    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual(expectedValues(newer));
    await context.close();
  });

  it("fills the longest link, with á and é, exactly", async () => {
    const address = ("Áras an Uachtaráin, Ráth Éanna Road, Béal Átha, Cill Mhantáin, " + "Sráid Mhór ".repeat(10)).slice(0, 100);
    expect(address).toHaveLength(100);
    const date = yesterday();
    const report = {
      location: buildLocation(address, 53.45975, -6.21811),
      county: "Westmeath",
      description: buildDescription({
        plate: "191-WH-123456",
        parking: [
          "on a cycle track",
          "on a footpath",
          "on a grass margin",
          "within 5m of a junction",
          "blocking a private driveway",
          "interfering with traffic flow",
          "obstructing and endangering traffic",
        ],
        address,
        date,
        time: "23:59",
      }),
      date,
      roadUser: "E-Scooter User, E-Moped User, E-Cyclist" as const,
    };
    expect(report.description.length).toBeLessThanOrEqual(300);
    expect(report.description).toMatch(/[áé]/);
    expect(report.location).toMatch(/á/);
    expect(report.location).toMatch(/é/);

    const context = await newContext();
    const page = await context.newPage();
    await page.goto(linkTo(report));
    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual(expectedValues(report));
    await context.close();
  });

  const brokenLinks: [string, string][] = [
    ["not base64url", "!!!"],
    ["empty data", ""],
    ["not JSON", base64url("not json")],
    ["JSON that is not an object", base64url('["a","b","c","d"]')],
    ["a key is missing", base64url(JSON.stringify({ l: "x", c: "Dublin", d: "x", r: "Driver" }))],
    ["no Were you a", base64url(JSON.stringify({ l: "x", c: "Dublin", d: "x", t: yesterday() }))],
    ["an unknown Were you a", base64url(JSON.stringify({ l: "x", c: "Dublin", d: "x", t: yesterday(), r: "Pilot" }))],
    ["an unknown key", base64url(JSON.stringify({ l: "x", c: "Dublin", d: "x", t: yesterday(), r: "Driver", z: "x" }))],
    ["a date that does not exist", base64url(JSON.stringify({ l: "x", c: "Dublin", d: "x", t: "30/02/2026", r: "Driver" }))],
    [
      "a description over 300 characters",
      base64url(JSON.stringify({ l: "x", c: "Dublin", d: "x".repeat(301), t: yesterday(), r: "Driver" })),
    ],
    ["bytes that are not UTF-8", Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")],
  ];
  it.each(brokenLinks)("shows a message and fills nothing for a broken link: %s", async (_name, data) => {
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(`${origin}${FORM_PATH}#sb=${data}`);
    await page.getByRole("alert").filter({ hasText: /link is not valid/ }).waitFor();
    expect(page.url()).not.toContain("#sb=");

    await tickAndStart(page);
    await page.waitForTimeout(1000);
    await expectNothingWritten(page);
    await context.close();
  });

  // The time to wait counts from the first visible field, not from the press of Start: the form
  // opens 7 seconds after Start and the date field is added 5 seconds after that, which is later
  // than 10 seconds after Start but within 10 seconds of the first visible field.
  it(
    "waits for the fields up to 10 seconds after the first visible field",
    async () => {
      // A replacement that finds nothing would leave the form fast and the test checking nothing.
      const replaceOnce = (html: string, pattern: RegExp, text: string): string => {
        if (!pattern.test(html)) throw new Error(`The copy of the form has no match for ${pattern}`);
        return html.replace(pattern, () => text);
      };
      const slowForm = (html: string) =>
        replaceOnce(
          replaceOnce(html, /\$\("#startBtn"\)\.hide\(\);\s*openForm\(\);/, '$("#startBtn").hide(); setTimeout(openForm, 7000);'),
          /focus\(\);\s*addDate\(\);/,
          "focus(); setTimeout(addDate, 5000);",
        );
      const context = await newContext(slowForm);
      const page = await context.newPage();
      const report = ordinaryReport();
      await page.goto(linkTo(report));
      await tickAndStart(page);
      await waitUntilFilled(page);
      expect(await fieldValues(page)).toEqual(expectedValues(report));
      expect(await page.locator("[role=alert]").count()).toBe(0);
      await context.close();
    },
    FIELDS_TIMEOUT_MS + 30000,
  );

  // A field or an option that is gone from the form: nothing is written, the person is told.
  const changedForms: [string, (html: string) => string][] = [
    ["the Location field is missing", (html) => html.replace('id="Location"', 'id="Location_gone"')],
    ["the UserName field is missing", (html) => html.replace('id="UserName"', 'id="UserName_gone"')],
    ["the date field is missing", (html) => html.replace("id=\"crimeDate_'", "id=\"crimeDate_gone_'")],
    ["the Parking Offences option is missing", (html) => html.replace('<option value="Parking Offences">Parking Offences</option>', "")],
    ["the Dublin option is missing", (html) => html.replace('<option value="Dublin">Dublin</option>', "")],
    ["the Pedestrian option is missing", (html) => html.replace('<option value="Pedestrian">Pedestrian</option>', "")],
    [
      "every field is missing",
      (html) =>
        FIELD_IDS.reduce(
          (changed, id) => changed.replaceAll(`id="${id}"`, `id="${id}_gone"`),
          html.replace("id=\"crimeDate_'", "id=\"crimeDate_gone_'"),
        ),
    ],
  ];
  it.concurrent.each(changedForms)(
    "tells the person to fill the form by hand when %s",
    async (_name, changeForm) => {
      const context = await newContext(changeForm);
      const page = await context.newPage();
      await page.goto(linkTo(ordinaryReport()));
      await tickAndStart(page);

      await page
        .getByRole("alert")
        .filter({ hasText: /form has changed/ })
        .waitFor({ timeout: FIELDS_TIMEOUT_MS + 5000 });
      expect(await page.getByRole("status").filter({ hasText: /StreetBuddy is running/ }).count()).toBe(0);
      await expectNothingWritten(page);
      await context.close();
    },
    FIELDS_TIMEOUT_MS + 20000,
  );

  it(
    "tells the person to fill the form by hand when the start button is missing",
    async () => {
      const context = await newContext((html) => html.replace('id="startBtn"', 'id="startBtn_gone"'));
      const page = await context.newPage();
      await page.goto(linkTo(ordinaryReport()));
      await page.getByRole("status").filter({ hasText: /StreetBuddy is running/ }).waitFor();

      await page
        .getByRole("alert")
        .filter({ hasText: /form has changed/ })
        .waitFor({ timeout: FIELDS_TIMEOUT_MS + 5000 });
      expect(await page.getByRole("status").filter({ hasText: /StreetBuddy is running/ }).count()).toBe(0);
      await expectNothingWritten(page);
      await context.close();
    },
    FIELDS_TIMEOUT_MS + 20000,
  );
});

describe("bookmarklet built on the installation page", () => {
  // Personal data with quotes, a backslash and Irish letters, as typed on the page.
  const TYPED = {
    name: ' Séan "Test" Ó Briain\\ ',
    phone: "087 000 0000",
    email: "sean@example.ie",
    address: "1 Sráid Mhór, Dublin",
    contact: "Text Message",
  };

  async function openGuide(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto(origin + INSTALL_PATH);
    return page;
  }

  async function typeProfile(page: Page, profile: typeof TYPED): Promise<void> {
    await page.fill("#bookmark-form [name=name]", profile.name);
    await page.fill("#bookmark-form [name=phone]", profile.phone);
    await page.fill("#bookmark-form [name=email]", profile.email);
    await page.fill("#bookmark-form [name=address]", profile.address);
    await page.selectOption("#bookmark-form [name=contact]", profile.contact);
    await page.getByRole("button", { name: "Создать закладку" }).click();
  }

  it("copies a short bookmarklet, which loads the script and fills the form", async () => {
    const guideContext = await browser.newContext();
    await guideContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const sent: string[] = [];
    guideContext.on("request", (request) => {
      if (request.method() !== "GET") sent.push(request.url());
    });
    const guide = await openGuide(guideContext);
    expect(await guide.isVisible("#bookmark-ready")).toBe(false);
    expect(await guide.isVisible("#bookmark-created")).toBe(false);
    await typeProfile(guide, TYPED);
    expect(await guide.isVisible("#bookmark-ready")).toBe(true);
    expect(await guide.isVisible("#bookmark-created")).toBe(true);
    expect(await guide.textContent("#bookmark-created")).toBe("Закладка создана.");
    // The other ways to add the bookmark stay folded until the person opens them.
    expect(await guide.isVisible("#bookmark-link")).toBe(false);
    expect(await guide.isVisible("#bookmark-error")).toBe(false);
    await guide.getByRole("button", { name: "Скопировать закладку" }).click();
    await guide.locator("#bookmark-copied").waitFor();
    const bookmark = (await guide.evaluate("navigator.clipboard.readText()")) as string;
    expect(await guide.getAttribute("#bookmark-link", "href")).toBe(bookmark);
    expect(bookmark.startsWith("javascript:")).toBe(true);
    // The bookmarklet holds the data and the address of the script, not the script.
    expect(bookmark.length).toBeLessThan(1500);
    const code = decodeURIComponent(bookmark.slice("javascript:".length));
    expect(code).not.toContain("validateReport");
    expect(code).toContain(JSON.stringify(origin + SCRIPT_PATH));
    // Nothing typed on the page is sent anywhere.
    expect(sent).toEqual([]);
    // The phone way is shown first; the computer way replaces it when chosen.
    await guide.getByText("Другие варианты добавления закладки", { exact: true }).click();
    expect(await guide.isVisible("[data-variant-section=phone]")).toBe(true);
    expect(await guide.isVisible("[data-variant-section=computer]")).toBe(false);
    await guide.getByRole("button", { name: "Настроить с компьютера" }).click();
    expect(await guide.isVisible("[data-variant-section=phone]")).toBe(false);
    expect(await guide.isVisible("[data-variant-section=computer]")).toBe(true);
    // A plain tap on the link runs nothing on the guide page.
    await guide.click("#bookmark-link");
    expect(await guide.evaluate("typeof globalThis.STREETBUDDY_PROFILE")).toBe("undefined");
    await guideContext.close();

    // Chrome with no extension: the person opens the link, then runs the bookmarklet.
    const context = await browser.newContext();
    const loaded: string[] = [];
    context.on("request", (request) => {
      if (request.url().endsWith(SCRIPT_PATH)) loaded.push(request.url());
    });
    const page = await context.newPage();
    const report = ordinaryReport();
    await page.goto(linkTo(report));
    await page.evaluate(code);
    await page.waitForFunction("!location.hash.startsWith('#sb=')");
    expect(loaded).toEqual([origin + SCRIPT_PATH]);
    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual({
      ...expectedValues(report),
      UserName: TYPED.name.trim(),
      Phone: TYPED.phone,
      Email: TYPED.email,
      UserAddress: TYPED.address,
      ContactMethod: TYPED.contact,
    });
    expect(await page.locator("[role=alert]").count()).toBe(0);

    // Run as a link, the way Chrome runs a bookmark: the script is loaded and the page stays.
    const viaLink = await context.newPage();
    await viaLink.goto(linkTo(ordinaryReport()));
    await viaLink.evaluate(`location.href = ${JSON.stringify(bookmark)}`);
    await viaLink.waitForFunction("globalThis.STREETBUDDY_PROFILE !== undefined");
    await viaLink.waitForFunction("!location.hash.startsWith('#sb=')");
    expect(await viaLink.locator("#startBtn").count()).toBe(1);
    await context.close();
  });

  const badProfiles: [string, Partial<typeof TYPED>][] = [
    ["an empty name", { name: "   " }],
    ["an empty phone", { phone: "" }],
    ["an empty address", { address: "" }],
    ["an email without a dot", { email: "sean@example" }],
    ["an email with a space", { email: "se an@example.ie" }],
    ["no contact method", { contact: "" }],
  ];
  it.each(badProfiles)("does not build a bookmarklet for %s", async (_name, change) => {
    const context = await browser.newContext();
    const page = await openGuide(context);
    await typeProfile(page, { ...TYPED, ...change });
    expect(await page.isVisible("#bookmark-error")).toBe(true);
    expect(await page.isVisible("#bookmark-ready")).toBe(false);
    expect(await page.isVisible("#bookmark-created")).toBe(false);
    await context.close();
  });
});

describe("installation guide choices", () => {
  it("shows the blocks of the chosen phone", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin + INSTALL_PATH);
    const form = "#bookmark-form";
    const iphoneBlock = '[data-for="iphone-bookmark"]';
    expect(await page.isVisible(form)).toBe(true);
    expect(await page.isVisible(iphoneBlock)).toBe(false);

    await page.getByRole("button", { name: "iPhone" }).click();
    expect(await page.isVisible(form)).toBe(true);
    expect(await page.isVisible(iphoneBlock)).toBe(true);

    await page.getByRole("button", { name: "Android" }).click();
    expect(await page.isVisible(form)).toBe(true);
    expect(await page.isVisible(iphoneBlock)).toBe(false);
    await context.close();
  });
});

describe("manual page", () => {
  it("switches between the Android and iPhone instructions", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin + MANUAL_PATH);
    expect(await page.isVisible("[data-os-section=android]")).toBe(true);
    expect(await page.isVisible("[data-os-section=iphone]")).toBe(false);

    await page.getByRole("button", { name: "iPhone" }).click();
    expect(await page.isVisible("[data-os-section=android]")).toBe(false);
    expect(await page.isVisible("[data-os-section=iphone]")).toBe(true);
    expect(await page.textContent("[data-os-section=iphone]")).toContain("Safari");
    expect(await page.getAttribute("[data-os=iphone]", "aria-pressed")).toBe("true");
    expect(await page.getAttribute("[data-os=android]", "aria-pressed")).toBe("false");

    await page.getByRole("button", { name: "Android" }).click();
    expect(await page.isVisible("[data-os-section=android]")).toBe(true);
    expect(await page.isVisible("[data-os-section=iphone]")).toBe(false);
    await context.close();
  });
});
