export const COMPLETION_POLL_INTERVAL_MS = 3_000;
export const COMPLETION_MAX_PENDING_ATTEMPTS = 20;

export function shouldPollCheckoutCompletion(state: string, attempt: number): boolean {
  return state === "awaiting_confirmation" && attempt < COMPLETION_MAX_PENDING_ATTEMPTS;
}

export function boundedCompletionState(state: string, attempt: number): string {
  return state === "awaiting_confirmation" && attempt >= COMPLETION_MAX_PENDING_ATTEMPTS
    ? "unavailable"
    : state;
}
