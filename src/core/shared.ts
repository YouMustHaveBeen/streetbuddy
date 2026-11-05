// Constants and helpers used by more than one module.
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TWO_MONTHS_MS = 60 * DAY_MS;
export const REQUEST_TIMEOUT_MS = 10000;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
