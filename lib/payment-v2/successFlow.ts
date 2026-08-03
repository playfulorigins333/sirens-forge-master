export const PAYMENT_SUCCESS_STATUS_INTERVAL_MS = 2_000;
export const PAYMENT_SUCCESS_STATUS_WINDOW_MS = 60_000;
export const PAYMENT_SUCCESS_PROFILE_WINDOW_MS = 30_000;
export const PAYMENT_SUCCESS_SESSION_MAX_LENGTH = 255;

export type SuccessView =
  | "loading" | "processing" | "sign_in" | "claiming" | "profile_setup"
  | "claimed" | "unavailable" | "not_found" | "error" | "timed_out";

export type SuccessState = { view: SuccessView; busy: boolean };
type Status = "processing" | "paid_unclaimed" | "claimed" | "unavailable" | "not_found";
type ApiResult = { status: number; body: unknown };

export interface SuccessFlowDependencies {
  requestStatus(sessionId: string): Promise<ApiResult>;
  requestClaim(sessionId: string): Promise<ApiResult>;
  isAuthenticated(): Promise<boolean>;
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

export function paymentFirstSuccessEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function validateSuccessSearchParams(
  params: Record<string, string | string[] | undefined>,
): string | null {
  if (Object.keys(params).length !== 1 || !Object.hasOwn(params, "session_id")) return null;
  const value = params.session_id;
  if (typeof value !== "string" || value.length > PAYMENT_SUCCESS_SESSION_MAX_LENGTH) return null;
  return /^cs_[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function buildPaymentSuccessLinks(sessionId: string) {
  const continuation = `/billing/success?session_id=${encodeURIComponent(sessionId)}`;
  return {
    continuation,
    signIn: `/login?next=${encodeURIComponent(continuation)}`,
    signUp: `/login?mode=signup&next=${encodeURIComponent(continuation)}`,
  };
}

function exactStatus(body: unknown): Status | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) return null;
  const status = (body as { status?: unknown }).status;
  return ["processing", "paid_unclaimed", "claimed", "unavailable", "not_found"].includes(status as string)
    ? status as Status : null;
}

function exactCode(body: unknown, code: string): boolean {
  return !!body && typeof body === "object" && !Array.isArray(body) &&
    (body as { code?: unknown }).code === code;
}

export class PaymentFirstSuccessFlow {
  private state: SuccessState = { view: "loading", busy: false };
  private listener: (state: SuccessState) => void = () => undefined;
  private timer: unknown;
  private disposed = false;
  private inFlight = false;
  private statusStarted = 0;
  private profileStarted = 0;
  private profileAttempt = 0;

  constructor(private readonly sessionId: string, private readonly dependencies: SuccessFlowDependencies) {}

  subscribe(listener: (state: SuccessState) => void) {
    this.listener = listener;
    listener(this.state);
    return () => this.dispose();
  }

  start() {
    if (this.disposed || this.inFlight || this.state.view !== "loading") return;
    this.statusStarted = this.dependencies.now();
    void this.checkStatus();
  }

  retry() {
    if (this.disposed || this.inFlight) return;
    this.cancelTimer();
    this.statusStarted = this.dependencies.now();
    this.profileStarted = 0;
    this.profileAttempt = 0;
    this.update("loading", true);
    void this.checkStatus();
  }

  dispose() {
    this.disposed = true;
    this.cancelTimer();
  }

  private update(view: SuccessView, busy = false) {
    if (this.disposed) return;
    this.state = { view, busy };
    this.listener(this.state);
  }

  private schedule(callback: () => void, delay: number) {
    this.cancelTimer();
    this.timer = this.dependencies.setTimer(callback, delay);
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.dependencies.clearTimer(this.timer);
    this.timer = undefined;
  }

  private async checkStatus() {
    if (this.disposed || this.inFlight) return;
    this.inFlight = true;
    this.update(this.state.view === "processing" ? "processing" : "loading", true);
    try {
      const result = await this.dependencies.requestStatus(this.sessionId);
      if (this.disposed) return;
      const status = result.status === 200 ? exactStatus(result.body) : null;
      if (!status) return this.update("error");
      if (status === "processing") {
        this.update("processing");
        if (this.dependencies.now() - this.statusStarted >= PAYMENT_SUCCESS_STATUS_WINDOW_MS) return this.update("timed_out");
        this.schedule(() => void this.checkStatus(), PAYMENT_SUCCESS_STATUS_INTERVAL_MS);
        return;
      }
      if (status === "paid_unclaimed") {
        const authenticated = await this.dependencies.isAuthenticated();
        if (this.disposed) return;
        if (!authenticated) return this.update("sign_in");
        this.profileStarted = this.dependencies.now();
        this.inFlight = false;
        await this.claim();
        return;
      }
      this.update(status);
    } catch {
      this.update("error");
    } finally {
      this.inFlight = false;
    }
  }

  private async claim() {
    if (this.disposed) return;
    // checkStatus owns the in-flight lock for the first claim; timers enter here unlocked.
    if (this.inFlight && this.profileAttempt > 0) return;
    this.inFlight = true;
    this.update(this.profileAttempt ? "profile_setup" : "claiming", true);
    try {
      const result = await this.dependencies.requestClaim(this.sessionId);
      if (this.disposed) return;
      if (result.status === 200 && exactStatus(result.body) === "claimed") return this.update("claimed");
      if (result.status === 401 && exactCode(result.body, "PAYMENT_V2_AUTH_REQUIRED")) return this.update("sign_in");
      if (result.status === 409 && exactCode(result.body, "PAYMENT_V2_PROFILE_NOT_READY")) {
        this.update("profile_setup");
        if (this.dependencies.now() - this.profileStarted >= PAYMENT_SUCCESS_PROFILE_WINDOW_MS) return this.update("timed_out");
        this.profileAttempt += 1;
        const delay = Math.min(2_000 * (2 ** (this.profileAttempt - 1)), 8_000);
        this.schedule(() => void this.claim(), delay);
        return;
      }
      this.update("error");
    } catch {
      this.update("error");
    } finally {
      this.inFlight = false;
    }
  }
}

export function browserSuccessDependencies(): SuccessFlowDependencies {
  return {
    async requestStatus(sessionId) {
      const response = await fetch(`/api/payment-v2/claim-status?session_id=${encodeURIComponent(sessionId)}`, {
        credentials: "include", cache: "no-store",
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* sanitized by the state machine */ }
      return { status: response.status, body };
    },
    async requestClaim(sessionId) {
      const response = await fetch("/api/payment-v2/claim", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }),
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* sanitized by the state machine */ }
      return { status: response.status, body };
    },
    async isAuthenticated() {
      const { supabaseBrowser } = await import("@/lib/supabase");
      const { data, error } = await supabaseBrowser().auth.getUser();
      if (error) throw new Error("Authentication verification failed");
      return !!data.user;
    },
    now: () => Date.now(),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (timer) => window.clearTimeout(timer as number),
  };
}
