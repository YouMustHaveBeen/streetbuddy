// Constants and helpers used by more than one module.
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TWO_MONTHS_MS = 60 * DAY_MS;
export const REQUEST_TIMEOUT_MS = 10000;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The page of a list cut into pages of perPage: the wanted one, or the nearest one that exists.
export function pageIn(wanted: number, total: number, perPage: number): { page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const whole = Number.isFinite(wanted) ? Math.floor(wanted) : 0;
  return { page: Math.min(Math.max(whole, 0), pages - 1), pages };
}
