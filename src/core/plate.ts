// Plate recognition through a Workers AI vision model.

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const CHUNK_BYTES = 0x8000;

export const PLATE_MAX_LENGTH = 15;

const PROMPT =
  "List the registration number plate of every vehicle in this photo. " +
  'Reply only with a JSON array of strings, for example ["12-D-3456"]. ' +
  "If no plate can be read, reply with [].";

interface ModelReply {
  choices?: { message?: { content?: unknown } }[];
  response?: unknown;
}

// Chunks keep String.fromCharCode from hitting the argument limit on a large photo.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_BYTES));
  }
  return btoa(binary);
}

// The model may wrap the array in prose or a code block, so only the array itself is read.
export function parsePlates(reply: unknown): string[] {
  if (typeof reply !== "string") return [];
  const found = /\[[\s\S]*\]/.exec(reply);
  if (!found) return [];
  let list: unknown;
  try {
    list = JSON.parse(found[0]);
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

// Throws when the model fails, including when the daily Workers AI limit is used up.
export async function recognizePlates(ai: Ai, image: Uint8Array): Promise<string[]> {
  const run = ai.run.bind(ai) as unknown as (model: string, inputs: unknown) => Promise<ModelReply>;
  const reply = await run(MODEL, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(image)}` } },
        ],
      },
    ],
  });
  return parsePlates(reply.choices?.[0]?.message?.content ?? reply.response);
}
