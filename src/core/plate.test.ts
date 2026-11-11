import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_TIMEOUT_MS, parsePlates, recognizePlates, warmUpModel } from "./plate";

describe("parsePlates", () => {
  it("reads a plain array", () => {
    expect(parsePlates('["12-D-3456", "191-KE-7"]')).toEqual(["12-D-3456", "191-KE-7"]);
  });
  it("reads an array inside prose and a code block", () => {
    expect(parsePlates('Here you go:\n```json\n["12-d-3456"]\n```')).toEqual(["12-D-3456"]);
  });
  it("reads the array among other brackets", () => {
    expect(parsePlates('No plate: []; found ["12-D-3456"]')).toEqual(["12-D-3456"]);
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
    const image = Uint8Array.from({ length: 200000 }, (_, i) => i % 251);
    await expect(recognizePlates({ run } as unknown as Ai, image)).resolves.toEqual([]);
    const inputs = (run.mock.calls[0] as unknown[])[1] as {
      messages: { content: { image_url?: { url: string } }[] }[];
    };
    const url = inputs.messages[0].content[1].image_url?.url ?? "";
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    const decoded = Uint8Array.from(atob(url.split(",")[1]), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(image);
  });
  it("passes a model failure to the caller after the second call", async () => {
    const run = vi.fn(async () => {
      throw new Error("limit");
    });
    await expect(recognizePlates({ run } as unknown as Ai, new Uint8Array(1))).rejects.toThrow("limit");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("calls the model once more after a failure", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce({ response: '["12-D-3456"]' });
    expect(await recognizePlates({ run } as unknown as Ai, new Uint8Array(1))).toEqual(["12-D-3456"]);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("limits the length of the reply", async () => {
    const run = vi.fn(async () => ({ response: "[]" }));
    await recognizePlates({ run } as unknown as Ai, new Uint8Array(1));
    expect(((run.mock.calls[0] as unknown[])[1] as { max_completion_tokens: number }).max_completion_tokens).toBe(200);
  });
  describe("with a late model", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    it("gives up a late call and calls the model once more", async () => {
      const run = vi
        .fn()
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce({ response: '["12-D-3456"]' });
      const plates = recognizePlates({ run } as unknown as Ai, new Uint8Array(1));
      await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
      expect(await plates).toEqual(["12-D-3456"]);
      expect(run).toHaveBeenCalledTimes(2);
    });
    it("fails when both calls are late", async () => {
      const run = vi.fn(() => new Promise(() => {}));
      const plates = recognizePlates({ run } as unknown as Ai, new Uint8Array(1));
      const failed = expect(plates).rejects.toThrow("Workers AI timed out");
      await vi.advanceTimersByTimeAsync(2 * MODEL_TIMEOUT_MS);
      await failed;
      expect(run).toHaveBeenCalledTimes(2);
    });
  });
});

describe("warmUpModel", () => {
  it("makes one short text call of the plate model", async () => {
    const run = vi.fn(async () => ({ response: "[]" }));
    await warmUpModel({ run } as unknown as Ai);
    expect(run).toHaveBeenCalledTimes(1);
    const [model, inputs] = run.mock.calls[0] as unknown as [string, { max_completion_tokens: number }];
    expect(model).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(inputs.max_completion_tokens).toBe(1);
  });
});
