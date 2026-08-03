export type LoginAuthMode = "login" | "signup";
export type OAuthProvider = "google" | "discord";

export type LoginAuthState = {
  mode: LoginAuthMode;
  checkingSession: boolean;
  submitting: boolean;
  oauthBusy: boolean;
  checkEmail: boolean;
  error: string | null;
};

type AuthResult = { error: unknown };
type SignupResult = { data: { session: { user?: unknown } | null }; error: unknown };

export interface LoginAuthDependencies {
  getUser(): Promise<{ data: { user: unknown | null }; error: unknown }>;
  passwordLogin(email: string, password: string): Promise<AuthResult>;
  signup(email: string, password: string, emailRedirectTo: string | null): Promise<SignupResult>;
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<AuthResult>;
  subscribeAuthState(callback: () => void): () => void;
  navigate(destination: string): void;
}

const VERIFY_ERROR = "We could not verify your current session. Please try again.";
const PASSWORD_ERROR = "Email or password was not accepted. Please try again.";
const SIGNUP_ERROR = "We could not create your account. Please check your details and try again.";
const OAUTH_ERROR = "We could not start sign-in. Please try again.";

export class LoginAuthFlow {
  private state: LoginAuthState;
  private listener: (state: LoginAuthState) => void = () => undefined;
  private destination: string;
  private callbackUrl: string | null;
  private signupRedirect: string | null;
  private disposed = false;
  private started = false;
  private navigated = false;
  private verification: Promise<boolean> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    initialMode: LoginAuthMode,
    continuation: string | null,
    callbackUrl: string | null,
    initialError: string | null,
    private readonly dependencies: LoginAuthDependencies,
  ) {
    this.destination = continuation ?? "/dashboard";
    this.callbackUrl = callbackUrl;
    this.signupRedirect = continuation ? callbackUrl : null;
    this.state = {
      mode: initialMode,
      checkingSession: true,
      submitting: false,
      oauthBusy: false,
      checkEmail: false,
      error: initialError,
    };
  }

  subscribe(listener: (state: LoginAuthState) => void): () => void {
    this.listener = listener;
    listener(this.state);
    return () => { if (this.listener === listener) this.listener = () => undefined; };
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.unsubscribe = this.dependencies.subscribeAuthState(() => { void this.verifyUser(); });
    void this.verifyUser();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  updateServerValues(continuation: string | null, callbackUrl: string | null): void {
    this.destination = continuation ?? "/dashboard";
    this.callbackUrl = callbackUrl;
    this.signupRedirect = continuation ? callbackUrl : null;
  }

  setMode(mode: LoginAuthMode): void {
    if (this.disposed || this.state.checkEmail) return;
    this.publish({ mode, error: null });
  }

  returnToSignIn(): void {
    if (this.disposed) return;
    this.publish({ mode: "login", checkEmail: false, submitting: false, error: null });
  }

  retryVerification(): Promise<boolean> {
    return this.verifyUser();
  }

  private publish(patch: Partial<LoginAuthState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listener(this.state);
  }

  private navigateOnce(): boolean {
    if (this.disposed || this.navigated) return false;
    this.navigated = true;
    this.dependencies.navigate(this.destination);
    return true;
  }

  private verifyUser(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.verification) return this.verification;
    const verification = this.performVerification();
    this.verification = verification;
    void verification.then(() => {
      if (this.verification === verification) this.verification = null;
    });
    return verification;
  }

  private async performVerification(): Promise<boolean> {
    try {
      const result = await this.dependencies.getUser();
      if (this.disposed) return false;
      if (result.error) {
        this.publish({ checkingSession: false, error: VERIFY_ERROR });
        return false;
      }
      this.publish({ checkingSession: false });
      return result.data.user ? this.navigateOnce() : false;
    } catch {
      if (!this.disposed) this.publish({ checkingSession: false, error: VERIFY_ERROR });
      return false;
    }
  }

  private async verifyAfterAuthentication(): Promise<boolean> {
    const active = this.verification;
    if (active) await active;
    if (this.disposed || this.navigated) return false;
    return this.verifyUser();
  }

  async passwordLogin(email: string, password: string): Promise<void> {
    if (this.disposed || this.state.submitting || this.state.checkEmail) return;
    this.publish({ submitting: true, error: null });
    try {
      const result = await this.dependencies.passwordLogin(email, password);
      if (this.disposed) return;
      if (result.error) {
        this.publish({ submitting: false, error: PASSWORD_ERROR });
        return;
      }
      await this.verifyAfterAuthentication();
    } catch {
      if (!this.disposed) this.publish({ submitting: false, error: PASSWORD_ERROR });
      return;
    }
    if (!this.disposed) this.publish({ submitting: false });
  }

  async signup(email: string, password: string): Promise<void> {
    if (this.disposed || this.state.submitting || this.state.checkEmail) return;
    this.publish({ submitting: true, error: null });
    try {
      const result = await this.dependencies.signup(email, password, this.signupRedirect);
      if (this.disposed) return;
      if (result.error) {
        this.publish({ submitting: false, error: SIGNUP_ERROR });
        return;
      }
      if (result.data.session?.user) {
        await this.verifyAfterAuthentication();
        if (!this.disposed) this.publish({ submitting: false });
        return;
      }
      this.publish({ submitting: false, checkEmail: true });
    } catch {
      if (!this.disposed) this.publish({ submitting: false, error: SIGNUP_ERROR });
    }
  }

  async startOAuth(provider: OAuthProvider): Promise<void> {
    if (this.disposed || this.state.oauthBusy) return;
    const redirectTo = this.callbackUrl;
    if (!redirectTo) {
      this.publish({ error: "Sign-in is temporarily unavailable. Please try again later." });
      return;
    }
    this.publish({ oauthBusy: true, error: null });
    try {
      const result = await this.dependencies.startOAuth(provider, redirectTo);
      if (!this.disposed && result.error) this.publish({ error: OAUTH_ERROR });
    } catch {
      if (!this.disposed) this.publish({ error: OAUTH_ERROR });
    } finally {
      if (!this.disposed) this.publish({ oauthBusy: false });
    }
  }
}
