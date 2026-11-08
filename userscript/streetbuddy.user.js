// ==UserScript==
// @name         StreetBuddy
// @namespace    streetbuddy
// @version      1.4.1
// @description  Fills in the Garda Traffic Watch form from a StreetBuddy link
// @match        https://www.garda.ie/en/trafficwatchreport*
// @match        https://garda.ie/en/trafficwatchreport*
// @run-at       document-start
// ==/UserScript==

// StreetBuddy form-filling script: the bookmarklet loads this file.
// It never ticks the confirmation checkboxes, never presses "Click Here to Start" or
// "Submit Report" and never touches the captcha: those steps always stay with the person.
(function () {
  "use strict";

  if (!location.pathname.startsWith("/en/trafficwatchreport")) return;

  const LINK_PREFIX = "#sb=";
  const REPORT_KEY = "streetbuddy-report";
  // How long to wait for all the fields once the first one is visible.
  const FIELDS_TIMEOUT_MS = 10000;

  const MESSAGE_FORM_CHANGED = "The Garda form has changed. Please fill in the fields manually.";
  const MESSAGE_LINK_INVALID = "The link is not valid. Please fill in the fields manually.";
  const MESSAGE_RUNNING = "StreetBuddy is running. Tick the two boxes below and press Click Here to Start";

  // Same texts as on the form.
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

  // The longest description.
  const DESCRIPTION_LIMIT = 300;

  // ---------------------------------------------------------------- link data

  // Decodes base64url of UTF-8 JSON.
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

  // Removes the data after "#" from the address bar and keeps it in sessionStorage.
  // Returns { report } or { invalid: true }.
  function readLink() {
    if (location.hash.startsWith(LINK_PREFIX)) {
      const report = validateReport(decodeLinkData(location.hash.slice(LINK_PREFIX.length)));
      history.replaceState(null, "", location.pathname + location.search);
      try {
        if (report) sessionStorage.setItem(REPORT_KEY, JSON.stringify(report));
        else sessionStorage.removeItem(REPORT_KEY);
      } catch {
        // With storage blocked, the data stays in memory.
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

  // Drops the link data on submit events.
  function forgetReport() {
    try {
      sessionStorage.removeItem(REPORT_KEY);
    } catch {
      // Nothing to remove when storage is blocked.
    }
  }

  // ------------------------------------------------------------ personal data

  // Returns the cleaned personal data, or null when anything is missing or not allowed.
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

  function loadProfile() {
    return globalThis.STREETBUDDY_PROFILE ? validateProfile(globalThis.STREETBUDDY_PROFILE) : null;
  }

  // ---------------------------------------------------------------- page parts

  // Builds what the script shows from elements and plain text: an error by default,
  // a plain notice when ok is true. Returns the box.
  function showMessage(text, ok) {
    const box = document.createElement("div");
    box.setAttribute("role", ok ? "status" : "alert");
    box.style.cssText = "padding:12px;margin:8px;border:2px solid " + (ok ? "#1a7f37" : "#b00020") + ";background:#fff;color:#000;font:16px sans-serif";
    box.textContent = text;
    document.body.prepend(box);
    return box;
  }

  // ------------------------------------------------------------------- filling

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  // Sets a value the way typing does: through the native setter, then with the same events.
  function setValue(element, value) {
    element.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    // Sends a key press to every field but a list.
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
    // Writes nothing until every field and option is there.
    const ready = values.every(([id, value]) => canSet(document.getElementById(id), value));
    if (!ready) return false;
    for (const [id, value] of values) {
      const element = document.getElementById(id);
      if (element instanceof HTMLSelectElement) setValue(element, findOption(element, value).value);
      else setValue(element, value);
    }
    return true;
  }

  // Watches the page until a field is visible, then gives all fields a limited time to show
  // up. If the start button is not on the page or goes out of view and no field shows up, the
  // same time counts from that moment.
  function waitAndFill(report, profile) {
    let fieldSeen = false;
    let startSeen = false;
    let finished = false;
    let timer = null;
    const observer = new MutationObserver(check);
    const runningNotice = showMessage(MESSAGE_RUNNING, true);

    function finish(filled) {
      finished = true;
      observer.disconnect();
      clearTimeout(timer);
      runningNotice.remove();
      if (!filled) showMessage(MESSAGE_FORM_CHANGED);
    }

    // Fills the form or shows the message when the time is up.
    function armTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!finished) finish(fillForm(report, profile));
      }, FIELDS_TIMEOUT_MS);
    }

    function check() {
      if (finished) return;
      if (!fieldSeen) {
        // Any visible field counts.
        const anyField = formValues(report, profile).some(([id]) => {
          const element = document.getElementById(id);
          return element && isVisible(element);
        });
        const startButton = document.getElementById("startBtn");
        if (anyField) {
          fieldSeen = true;
          armTimer();
        } else if (!startSeen && (!startButton || !isVisible(startButton))) {
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

  // Reads the link first of all.
  const link = readLink();

  function onReady(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback, { once: true });
    else callback();
  }

  function run() {
    const profile = loadProfile();
    onReady(() => {
      // Drops the saved link data on a submit event.
      document.addEventListener("submit", forgetReport, true);
      if (link.invalid) showMessage(MESSAGE_LINK_INVALID);
      if (link.report && profile) waitAndFill(link.report, profile);
    });
  }

  run();
})();
