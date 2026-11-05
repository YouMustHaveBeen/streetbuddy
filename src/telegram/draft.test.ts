import { beforeEach, describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import {
  addCleanup,
  createDraft,
  deleteDraft,
  deleteFinishedDraft,
  loadDraft,
  moveStep,
  recordPhoto,
  setPlates,
  startFinishing,
  swapScreen,
  toggleParking,
} from "./draft";

const USER = 7;
const PHOTO = { fileId: "f", fileUniqueId: "u", sentAt: 1, messageId: 10 };

let db: D1Database;

// A draft that was replaced by a new one: the handlers of the old one still hold its ID.
async function replaced(step: "photos" | "parking" | "road_user" | "finishing" = "photos") {
  const oldId = await createDraft(db, USER, 1, "old", { step }, []);
  const newId = await createDraft(db, USER, 2, "new", { step }, []);
  expect(newId).not.toBe(oldId);
  return { oldId, newId };
}

beforeEach(() => {
  db = fakeD1().db;
});

describe("draft ID", () => {
  it("is stored with the draft", async () => {
    const id = await createDraft(db, USER, 1, "p", { step: "address" }, []);
    expect((await loadDraft(db, USER))?.draft_id).toBe(id);
  });

  it("does not let a swap of an old screen touch the new draft", async () => {
    const { oldId, newId } = await replaced();
    expect(await swapScreen(db, USER, oldId, "photos", 5, "late", { step: "parking" }, [5])).toBeNull();
    const draft = await loadDraft(db, USER);
    expect(draft).toMatchObject({ draft_id: newId, step: "photos", prompt: "new", buttons_message_id: 2 });
    expect(await swapScreen(db, USER, newId, "photos", 6, "now", { step: "parking" }, [6])).toBe(2);
  });

  it("does not let an old handler add messages, record photos or set plates", async () => {
    const { oldId, newId } = await replaced();
    await addCleanup(db, USER, oldId, [99]);
    expect(await recordPhoto(db, USER, oldId, PHOTO)).toBeNull();
    await setPlates(db, USER, oldId, "u", ["A"]);
    expect(await loadDraft(db, USER)).toMatchObject({ draft_id: newId, cleanup: "[]", photo_count: 0, plates: null });

    expect(await recordPhoto(db, USER, newId, PHOTO)).toEqual({ photoCount: 1, isFirst: true });
    await setPlates(db, USER, newId, "u", ["A"]);
    expect((await loadDraft(db, USER))?.plates).toBe('["A"]');
  });

  it("does not let an old handler move the step or flip an option", async () => {
    const photos = await replaced("photos");
    expect(await moveStep(db, USER, photos.oldId, "photos", "recognizing")).toBe(false);
    expect(await moveStep(db, USER, photos.newId, "photos", "recognizing")).toBe(true);

    const parking = await replaced("parking");
    expect(await toggleParking(db, USER, parking.oldId, 1)).toBeNull();
    expect(await toggleParking(db, USER, parking.newId, 1)).toBe(1);

    const road = await replaced("road_user");
    expect(await startFinishing(db, USER, road.oldId, "road_user")).toBeNull();
    expect(await startFinishing(db, USER, road.newId, "road_user")).toBe(0);
  });

  it("does not let an old handler delete the new draft", async () => {
    const { oldId, newId } = await replaced("finishing");
    await deleteFinishedDraft(db, USER, oldId);
    await deleteDraft(db, USER, oldId);
    expect((await loadDraft(db, USER))?.draft_id).toBe(newId);
    await deleteFinishedDraft(db, USER, newId);
    expect(await loadDraft(db, USER)).toBeNull();
  });
});
