// ==UserScript==
// @name         StreetBuddy
// @namespace    streetbuddy
// @version      1.1.0
// @description  Fills in the Garda Traffic Watch form from a StreetBuddy link
// @match        https://www.garda.ie/en/trafficwatchreport*
// @match        https://garda.ie/en/trafficwatchreport*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

// StreetBuddy form-filling script: the userscript and the bookmarklet both run this same file.
// It never ticks the confirmation checkboxes, never presses "Click Here to Start" or
// "Submit Report" and never touches the captcha: those steps always stay with the person.
(function () {
  "use strict";

  if (!location.pathname.startsWith("/en/trafficwatchreport")) return;

  const LINK_PREFIX = "#sb=";
  const REPORT_KEY = "streetbuddy-report";
  const PANEL_ID = "streetbuddy-profile";
  const PROFILE_KEY = "profile";
  // How long to wait for the fields to appear after the person pressed "Click Here to Start".
  const FIELDS_TIMEOUT_MS = 10000;

  const MESSAGE_FORM_CHANGED = "The Garda form has changed. Please fill in the fields manually.";
  const MESSAGE_LINK_INVALID = "The link is not valid. Please fill in the fields manually.";

  // Same texts as on the form: the options are found by their visible text.
  const CRIME_TYPE = "Parking Offences";
  const CONTACT_METHODS = ["Email", "Phone Call", "Text Message"];
  const ROAD_USER_TYPES = [
    "Cyclist",
    "Driver",
    "E-Scooter User, E-Moped User, E-Cyclist",
    "Motorcyclist",
    "Passenger",
    "Pedestrian",
  ];

  // The form states this limit for the description in its own text; it has no other limits.
  const DESCRIPTION_LIMIT = 300;

  // ---------------------------------------------------------------- link data

  // Link data is base64url of UTF-8 JSON, so it is decoded back byte by byte.
  function decodeLinkData(encoded) {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return null;
    }
  }

  function isRealDate(text) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!match) return false;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function isText(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  // Returns the five known fields, or null when anything is missing, unknown or out of range.
  function validateReport(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const keys = Object.keys(data).sort().join(",");
    if (keys !== "c,d,l,r,t") return null;
    if (!isText(data.l) || !isText(data.c) || !isText(data.d) || !isRealDate(data.t)) return null;
    if (data.d.length > DESCRIPTION_LIMIT || !ROAD_USER_TYPES.includes(data.r)) return null;
    return { l: data.l, c: data.c, d: data.d, t: data.t, r: data.r };
  }

  // The data after "#" is removed from the address bar at once. It is kept in sessionStorage
  // so that a reload of the form does not lose it. Returns { report } or { invalid: true }.
  function readLink() {
    if (location.hash.startsWith(LINK_PREFIX)) {
      const report = validateReport(decodeLinkData(location.hash.slice(LINK_PREFIX.length)));
      history.replaceState(null, "", location.pathname + location.search);
      try {
        if (report) sessionStorage.setItem(REPORT_KEY, JSON.stringify(report));
        else sessionStorage.removeItem(REPORT_KEY);
      } catch {
        // Storage can be blocked; the data is then used from memory for this page only.
      }
      return report ? { report } : { invalid: true };
    }
    try {
      const stored = sessionStorage.getItem(REPORT_KEY);
      const report = stored ? validateReport(JSON.parse(stored)) : null;
      return report ? { report } : {};
    } catch {
      return {};
    }
  }

  // The panel for personal data is a form too; saving it must not drop the link data.
  function forgetReport(event) {
    if (event.target && event.target.id === PANEL_ID) return;
    try {
      sessionStorage.removeItem(REPORT_KEY);
    } catch {
      // Nothing to remove when storage is blocked.
    }
  }

  // ------------------------------------------------------------ personal data

  // Extension storage on the phone; the bookmarklet carries the data inside its own code.
  function pickStorage() {
    if (typeof GM !== "undefined" && GM && typeof GM.getValue === "function") {
      return { get: (key) => GM.getValue(key), set: (key, value) => GM.setValue(key, value) };
    }
    if (typeof GM_getValue === "function") {
      return {
        get: async (key) => GM_getValue(key),
        set: async (key, value) => GM_setValue(key, value),
      };
    }
    return null;
  }

  // Returns the cleaned personal data, or null when anything is missing or not allowed.
  // The page that builds the bookmarklet checks the data by the same rules.
  function validateProfile(data) {
    if (!data || typeof data !== "object") return null;
    if (!isText(data.name) || !isText(data.phone) || !isText(data.address)) return null;
    if (!isText(data.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return null;
    if (!CONTACT_METHODS.includes(data.contact)) return null;
    return {
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      address: data.address.trim(),
      contact: data.contact,
    };
  }

  async function loadProfile(storage) {
    if (globalThis.STREETBUDDY_PROFILE) return validateProfile(globalThis.STREETBUDDY_PROFILE);
    if (!storage) return null;
    try {
      const stored = await storage.get(PROFILE_KEY);
      return stored ? validateProfile(JSON.parse(stored)) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- page parts

  // Everything shown by the script is built from elements and plain text, never from HTML.
  function showMessage(text) {
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "padding:12px;margin:8px;border:2px solid #b00020;background:#fff;color:#000;font:16px sans-serif";
    box.textContent = text;
    document.body.prepend(box);
  }

  function field(labelText, control) {
    const label = document.createElement("label");
    label.style.cssText = "display:block;margin:8px 0";
    label.append(labelText, document.createElement("br"), control);
    return label;
  }

  function textInput(type) {
    const input = document.createElement("input");
    input.type = type;
    input.required = true;
    input.style.cssText = "width:100%;box-sizing:border-box;font-size:16px";
    return input;
  }

  function selectInput(options) {
    const select = document.createElement("select");
    select.required = true;
    select.style.cssText = "width:100%;box-sizing:border-box;font-size:16px";
    for (const text of options) select.append(new Option(text, text));
    select.selectedIndex = -1;
    return select;
  }

  // Asks for the personal data once; the form checks use the browser's own validation.
  function showProfilePanel(onSave) {
    const panel = document.createElement("form");
    panel.id = PANEL_ID;
    panel.style.cssText = "padding:12px;margin:8px;border:2px solid #444;background:#fff;color:#000;font:16px sans-serif";
    const name = textInput("text");
    const phone = textInput("tel");
    const email = textInput("email");
    const address = textInput("text");
    const contact = selectInput(CONTACT_METHODS);
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    save.style.cssText = "font-size:16px;padding:8px 16px";
    panel.append(
      field("First Name and Last Name", name),
      field("Phone", phone),
      field("Email", email),
      field("Address", address),
      field("How you wish to be contacted", contact),
      save,
    );
    panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      const profile = validateProfile({
        name: name.value,
        phone: phone.value,
        email: email.value,
        address: address.value,
        contact: contact.value,
      });
      if (!profile) return;
      panel.remove();
      await onSave(profile);
    });
    document.body.prepend(panel);
  }

  // ------------------------------------------------------------------- filling

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  // Sets a value the way typing does, so the page's own checks run: the native setter is
  // used because the page may have replaced the "value" property of the element.
  function setValue(element, value) {
    element.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    // The date picker of the form takes the date from the field only on a key press; without
    // it the picker empties the field as soon as it closes.
    if (!(element instanceof HTMLSelectElement)) {
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }

  function findOption(select, text) {
    return Array.from(select.options).find((option) => option.text.trim() === text);
  }

  // Returns true when the element can take the value: a select needs an option with that text.
  function canSet(element, value) {
    if (!element) return false;
    if (element instanceof HTMLSelectElement) return Boolean(findOption(element, value));
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  }

  // Every form field with the value that goes into it.
  function formValues(report, profile) {
    return [
      ["Location", report.l],
      ["County", report.c],
      ["Crime", CRIME_TYPE],
      ["RoadUserType", report.r],
      ["CrimeDescription", report.d],
      ["crimeDate_1", report.t],
      ["UserName", profile.name],
      ["Phone", profile.phone],
      ["Email", profile.email],
      ["UserAddress", profile.address],
      ["ContactMethod", profile.contact],
    ];
  }

  function fillForm(report, profile) {
    const values = formValues(report, profile);
    // Nothing is written until every field and option is there, so the form is never left
    // half filled while the message says to fill it in by hand.
    const ready = values.every(([id, value]) => canSet(document.getElementById(id), value));
    if (!ready) return false;
    for (const [id, value] of values) {
      const element = document.getElementById(id);
      if (element instanceof HTMLSelectElement) setValue(element, findOption(element, value).value);
      else setValue(element, value);
    }
    return true;
  }

  // The fields appear only after the person ticked the boxes and pressed "Click Here to
  // Start", so the page is watched until a field is visible, then all fields are
  // given a limited time to show up. When the start button goes out of view but no field
  // shows up at all, the same time counts from the button, so the message still appears.
  function waitAndFill(report, profile) {
    let fieldSeen = false;
    let startSeen = false;
    let finished = false;
    let timer = null;
    const observer = new MutationObserver(check);

    function finish(filled) {
      finished = true;
      observer.disconnect();
      clearTimeout(timer);
      if (!filled) showMessage(MESSAGE_FORM_CHANGED);
    }

    // A timer of its own, so the message appears even when the page stops changing.
    function armTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!finished) finish(fillForm(report, profile));
      }, FIELDS_TIMEOUT_MS);
    }

    function check() {
      if (finished) return;
      if (!fieldSeen) {
        // Any visible field counts, not one particular field: looking only at one field would
        // leave the person without a message when exactly that field is gone from the form.
        const anyField = formValues(report, profile).some(([id]) => {
          const element = document.getElementById(id);
          return element && isVisible(element);
        });
        const startButton = document.getElementById("startBtn");
        if (anyField) {
          fieldSeen = true;
          armTimer();
        } else if (!startSeen && startButton && !isVisible(startButton)) {
          startSeen = true;
          armTimer();
        }
      }
      if (!fieldSeen && !startSeen) return;
      if (fillForm(report, profile)) finish(true);
    }

    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  }

  // ---------------------------------------------------------------------- start

  // The link is read before anything else: the address bar must be cleaned at once.
  const link = readLink();

  function onReady(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback, { once: true });
    else callback();
  }

  async function run() {
    const storage = pickStorage();
    let profile = await loadProfile(storage);
    onReady(() => {
      // The saved link data is dropped when the form fires a submit event. This form may send
      // itself without one, then the data stays until the tab is closed.
      document.addEventListener("submit", forgetReport, true);
      if (link.invalid) showMessage(MESSAGE_LINK_INVALID);
      const start = () => {
        if (link.report && profile) waitAndFill(link.report, profile);
      };
      if (!profile && storage) {
        showProfilePanel(async (saved) => {
          await storage.set(PROFILE_KEY, JSON.stringify(saved));
          profile = saved;
          start();
        });
      } else {
        start();
      }
    });
  }

  run();
})();
