// Plate recognition through a Workers AI vision model.

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const CHUNK_BYTES = 0x8000;
// How long one call of the model may take, how many calls one photo gets, and the longest reply.
export const MODEL_TIMEOUT_MS = 12000;
const MODEL_ATTEMPTS = 2;
const MAX_REPLY_TOKENS = 200;

export const PLATE_MAX_LENGTH = 15;

const PROMPT =
  "List the registration number plate of every vehicle in this photo. " +
  'Reply only with a JSON array of strings, for example ["12-D-3456"]. ' +
  "If no plate can be read, reply with [].";

interface ModelReply {
  choices?: { message?: { content?: unknown } }[];
  response?: unknown;
}

type RunModel = (model: string, inputs: unknown) => Promise<ModelReply>;

const runner = (ai: Ai): RunModel => ai.run.bind(ai) as unknown as RunModel;

// Rejects when the work takes longer than ms.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Workers AI timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// Converts in chunks.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_BYTES));
  }
  return btoa(binary);
}

function platesFromArray(text: string): string[] {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const plates = list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item !== "" && item.length <= PLATE_MAX_LENGTH);
  return [...new Set(plates)];
}

// Tries each bracketed part of the reply on its own and takes the first with plates.
export function parsePlates(reply: unknown): string[] {
  if (typeof reply !== "string") return [];
  for (const [part] of reply.matchAll(/\[[^[\]]*\]/g)) {
    const plates = platesFromArray(part);
    if (plates.length > 0) return plates;
  }
  return [];
}

// Each call is limited to MODEL_TIMEOUT_MS; a failed or late call is made once more.
// Throws the last failure, including when the daily Workers AI limit is used up.
export async function recognizePlates(ai: Ai, image: Uint8Array): Promise<string[]> {
  const run = runner(ai);
  const inputs = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(image)}` } },
        ],
      },
    ],
    max_completion_tokens: MAX_REPLY_TOKENS,
  };
  let failure: unknown;
  for (let attempt = 0; attempt < MODEL_ATTEMPTS; attempt++) {
    try {
      const reply = await withTimeout(run(MODEL, inputs), MODEL_TIMEOUT_MS);
      return parsePlates(reply.choices?.[0]?.message?.content ?? reply.response);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

// A short call of the same model with text only. Throws when the model fails.
export async function warmUpModel(ai: Ai): Promise<void> {
  await withTimeout(
    runner(ai)(MODEL, { messages: [{ role: "user", content: "Reply with []" }], max_completion_tokens: 1 }),
    MODEL_TIMEOUT_MS,
  );
}
