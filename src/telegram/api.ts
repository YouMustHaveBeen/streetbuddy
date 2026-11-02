// The only place that talks to api.telegram.org.
const REQUEST_TIMEOUT_MS = 10000;

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
