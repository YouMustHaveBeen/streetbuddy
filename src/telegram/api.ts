// The only place that talks to api.telegram.org.
import { REQUEST_TIMEOUT_MS } from "../core";

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
}

// Downloads a file by the Telegram file_id; throws when it cannot be fetched.
export async function downloadFile(token: string, fileId: string): Promise<Uint8Array> {
  const file = await callTelegram<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  if (!file?.file_path) throw new Error("Telegram getFile failed");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Telegram file download responded ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Returns the method result, or null when the call fails for any reason.
export async function callTelegram<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await response.json()) as TelegramResponse<T>;
    if (!data.ok) {
      console.error(`Telegram ${method} failed with code ${data.error_code}`);
      return null;
    }
    return data.result ?? null;
  } catch {
    console.error(`Telegram ${method} request failed`);
    return null;
  }
}

// Returns the ID of the sent message, or null when sending fails.
export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  options: Record<string, unknown> = {},
): Promise<number | null> {
  const sent = await callTelegram<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text, ...options });
  return sent?.message_id ?? null;
}

// Sends a text file as a document; returns the ID of the sent message, or null when sending fails.
export async function sendDocument(
  token: string,
  chatId: number,
  fileName: string,
  content: string,
): Promise<number | null> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([content], { type: "application/geo+json" }), fileName);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await response.json()) as TelegramResponse<{ message_id: number }>;
    if (!data.ok) {
      console.error(`Telegram sendDocument failed with code ${data.error_code}`);
      return null;
    }
    return data.result?.message_id ?? null;
  } catch {
    console.error("Telegram sendDocument request failed");
    return null;
  }
}

export async function deleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
  await callTelegram(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

export async function answerButton(token: string, queryId: string, text?: string): Promise<void> {
  await callTelegram(token, "answerCallbackQuery", { callback_query_id: queryId, ...(text ? { text } : {}) });
}
