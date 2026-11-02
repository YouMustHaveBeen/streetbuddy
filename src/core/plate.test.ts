import { describe, expect, it, vi } from "vitest";
import { parsePlates, recognizePlates } from "./plate";

describe("parsePlates", () => {
  it("reads a plain array", () => {
    expect(parsePlates('["12-D-3456", "191-KE-7"]')).toEqual(["12-D-3456", "191-KE-7"]);
  });
  it("reads an array inside prose and a code block", () => {
    expect(parsePlates('Here you go:\n```json\n["12-d-3456"]\n```')).toEqual(["12-D-3456"]);
  });
  it("drops repeats, empty and overlong entries", () => {
    expect(parsePlates('["12-D-1", "12-d-1", " ", "1234567890123456", 5]')).toEqual(["12-D-1"]);
  });
  it.each([[""], ["no plates"], ["[broken"], [null], [42]])("gives nothing for %j", (reply) => {
    expect(parsePlates(reply)).toEqual([]);
  });
});

describe("recognizePlates", () => {
  it("sends the image and reads the chat-style reply", async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: '["12-D-3456"]' } }] }));
    const plates = await recognizePlates({ run } as unknown as Ai, new Uint8Array([1, 2, 3]));
    expect(plates).toEqual(["12-D-3456"]);
    const inputs = (run.mock.calls[0] as unknown[])[1] as {
      messages: { content: { image_url?: { url: string } }[] }[];
    };
    expect(inputs.messages[0].content[1].image_url?.url).toBe("data:image/jpeg;base64,AQID");
  });
  it("reads the plain reply shape", async () => {
    const run = vi.fn(async () => ({ response: '["12-D-3456"]' }));
    expect(await recognizePlates({ run } as unknown as Ai, new Uint8Array(1))).toEqual(["12-D-3456"]);
  });
  it("encodes a photo larger than one chunk", async () => {
    const run = vi.fn(async () => ({ response: "[]" }));
    await expect(recognizePlates({ run } as unknown as Ai, new Uint8Array(200000))).resolves.toEqual([]);
  });
  it("passes a model failure to the caller", async () => {
    const run = vi.fn(async () => {
      throw new Error("limit");
    });
    await expect(recognizePlates({ run } as unknown as Ai, new Uint8Array(1))).rejects.toThrow("limit");
  });
});
