import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForm } from "./formcheck";

const PAGE_URL = "https://www.garda.ie/en/trafficwatchreport/";
// The copy of the real form kept for the browser test of the script.
const FORM = readFileSync("test/userscript/form.html", "utf8");

type Reply = string | Response | (() => string | Response);

let fetched: string[];

// Serves the given addresses; any other address answers 404.
function serve(replies: Record<string, Reply[] | Reply>) {
  const used: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const address = String(url);
      fetched.push(address);
      const reply = replies[address];
      if (reply === undefined) return new Response("", { status: 404 });
      const list = Array.isArray(reply) ? reply : [reply];
      const index = Math.min(used[address] ?? 0, list.length - 1);
      used[address] = (used[address] ?? 0) + 1;
      const item = list[index];
      const value = typeof item === "function" ? item() : item;
      return typeof value === "string" ? new Response(value) : value;
    }),
  );
}

const down = () => {
  throw new Error("network down");
};
const withoutDatePrefix = (page: string) => page.replaceAll("crimeDate_", "crimeDatX_");

beforeEach(() => {
  fetched = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkForm", () => {
  it("accepts the unchanged form", async () => {
    serve({ [PAGE_URL]: FORM });
    expect(await checkForm()).toEqual({ ok: true });
  });

  it("reports a missing field", async () => {
    serve({ [PAGE_URL]: FORM.replace('id="Location"', 'id="Place"') });
    expect(await checkForm()).toEqual({ ok: false, reason: "field Location is missing" });
  });

  it("reports a changed option list", async () => {
    serve({ [PAGE_URL]: FORM.replace('<option value="Carlow">', '<option value="Antrim">Antrim</option><option value="Carlow">') });
    expect(await checkForm()).toEqual({ ok: false, reason: "options of County changed" });
  });

  it("reports a missing option", async () => {
    serve({ [PAGE_URL]: FORM.replace(/<option value="Carlow">Carlow<\/option>/, "") });
    expect(await checkForm()).toEqual({ ok: false, reason: "options of County changed" });
  });

  it("reports a list that is no longer a select", async () => {
    serve({ [PAGE_URL]: FORM.replace(/<select name="ContactMethod"/, '<div name="ContactMethod"').replace(/(<div name="ContactMethod"[\s\S]*?)<\/select>/, "$1</div>") });
    const result = await checkForm();
    expect(result.ok).toBe(false);
  });

  it("does not mind the order of options or the way characters are written", async () => {
    const reordered = FORM.replace(
      '<option value="Carlow">Carlow</option>\n\t<option value="Cavan">Cavan</option>',
      '<option value="Cavan">Cavan</option>\n\t<option value="Carlow">Carlow</option>',
    ).replace("Insurance NCT Tax – Driving without", "Insurance NCT Tax &#8211; Driving without");
    expect(reordered).not.toBe(FORM);
    serve({ [PAGE_URL]: reordered });
    expect(await checkForm()).toEqual({ ok: true });
  });

  it("finds the date field code in a script of the site", async () => {
    const page = withoutDatePrefix(FORM);
    serve({
      [PAGE_URL]: page,
      "https://www.garda.ie/vendor/jquery.min.js": "",
      "https://www.garda.ie/vendor/bootstrap-datepicker.min.js": "var id = 'crimeDate_' + index;",
      "https://www.garda.ie/vendor/bootstrap-datepicker.en-IE.min.js": "",
    });
    expect(await checkForm()).toEqual({ ok: true });
  });

  it("reports that no script creates the date field any more", async () => {
    serve({
      [PAGE_URL]: withoutDatePrefix(FORM),
      "https://www.garda.ie/vendor/jquery.min.js": "",
      "https://www.garda.ie/vendor/bootstrap-datepicker.min.js": "",
      "https://www.garda.ie/vendor/bootstrap-datepicker.en-IE.min.js": "",
    });
    expect(await checkForm()).toEqual({ ok: false, reason: "the script no longer creates crimeDate_" });
  });

  it("leaves scripts of other sites alone", async () => {
    const page = withoutDatePrefix(FORM).replace("</head>", '<script src="https://cdn.example.com/x.js"></script></head>');
    serve({
      [PAGE_URL]: page,
      "https://www.garda.ie/vendor/jquery.min.js": "",
      "https://www.garda.ie/vendor/bootstrap-datepicker.min.js": "",
      "https://www.garda.ie/vendor/bootstrap-datepicker.en-IE.min.js": "",
      "https://cdn.example.com/x.js": "crimeDate_",
    });
    expect((await checkForm()).ok).toBe(false);
    expect(fetched).not.toContain("https://cdn.example.com/x.js");
  });

  it("keeps looking in the other scripts when one cannot be loaded", async () => {
    serve({
      [PAGE_URL]: withoutDatePrefix(FORM),
      "https://www.garda.ie/vendor/bootstrap-datepicker.min.js": "var id = 'crimeDate_' + index;",
    });
    expect(await checkForm()).toEqual({ ok: true });
  });

  it("does not fail on a character reference beyond Unicode", async () => {
    const text = ">Insurance NCT Tax – Driving without</option>";
    expect(FORM).toContain(text);
    serve({ [PAGE_URL]: FORM.replace(text, ">Insurance NCT Tax &#1114112; Driving without</option>") });
    expect(await checkForm()).toEqual({ ok: false, reason: "options of Crime changed" });
  });

  it.each([
    ["the attribute name in capitals", 'id="Location"', 'ID="Location"'],
    ["a value in single quotes", 'id="Location"', "id='Location'"],
    ["a value without quotes", 'id="Location"', "id=Location"],
    ["a list with a value without quotes", 'id="ContactMethod"', "id=ContactMethod"],
  ])("accepts %s", async (_name, from, to) => {
    expect(FORM).toContain(from);
    serve({ [PAGE_URL]: FORM.replace(from, to) });
    expect(await checkForm()).toEqual({ ok: true });
  });

  it("repeats a failed request of the page once", async () => {
    serve({ [PAGE_URL]: [down, FORM] });
    expect(await checkForm()).toEqual({ ok: true });
    expect(fetched).toEqual([PAGE_URL, PAGE_URL]);
  });

  it("counts a page that cannot be loaded twice as a changed form", async () => {
    serve({ [PAGE_URL]: [down, down] });
    expect(await checkForm()).toEqual({ ok: false, reason: "the form page could not be loaded" });
    expect(fetched).toEqual([PAGE_URL, PAGE_URL]);
  });

  it("counts an error answer given twice as a changed form", async () => {
    serve({ [PAGE_URL]: new Response("", { status: 500 }) });
    expect((await checkForm()).ok).toBe(false);
    expect(fetched).toEqual([PAGE_URL, PAGE_URL]);
  });

  it("reports a site script that cannot be loaded", async () => {
    serve({ [PAGE_URL]: withoutDatePrefix(FORM) });
    expect(await checkForm()).toEqual({ ok: false, reason: "a site script could not be loaded" });
  });
});
