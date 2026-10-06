import type {
  AccountUser,
  AttemptPage,
  AttemptPayload,
  AuthResponse,
  ProgressPoint,
  ProgressSummary,
  StoredAttempt,
} from "./types";

type Fetcher = typeof fetch;

const configuredBase = import.meta.env?.VITE_API_BASE_URL?.trim() ?? "";
const defaultBase = configuredBase.replace(/\/$/, "");
const sessionHintKey = "shadowcoach.account-session.v1";

function sessionHint(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(sessionHintKey) === "active";
  } catch {
    return null;
  }
}

function setSessionHint(active: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (active) localStorage.setItem(sessionHintKey, "active");
    else localStorage.removeItem(sessionHintKey);
  } catch {
    // The refresh cookie remains authoritative when browser storage is unavailable.
  }
}

export class BackendError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

async function errorFrom(response: Response): Promise<BackendError> {
  let message = `Backend request failed (${response.status})`;
  try {
    const value = (await response.json()) as { detail?: unknown };
    if (typeof value.detail === "string" && value.detail.trim())
      message = value.detail;
  } catch {
    // The status is still useful when an upstream proxy returned non-JSON.
  }
  return new BackendError(response.status, message);
}

export class BackendClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthResponse | null> | null = null;
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;

  constructor(
    fetcher: Fetcher = (...args) => fetch(...args),
    baseUrl = defaultBase,
  ) {
    this.fetcher = fetcher;
    this.baseUrl = baseUrl;
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/v1${path}`;
  }

  private async publicRequest<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(this.url(path), {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw await errorFrom(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private acceptAuth(response: AuthResponse): AccountUser {
    this.accessToken = response.access_token;
    setSessionHint(true);
    return response.user;
  }

  async register(input: {
    email: string;
    password: string;
    display_name: string;
  }): Promise<AccountUser> {
    const response = await this.publicRequest<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return this.acceptAuth(response);
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<AccountUser> {
    const response = await this.publicRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return this.acceptAuth(response);
  }

  async restoreSession(): Promise<AccountUser | null> {
    try {
      // A non-sensitive marker avoids a failing network probe for visitors who
      // have never authenticated. Tokens are never stored in JavaScript storage.
      if (sessionHint() === false) return null;
      const session = await this.publicRequest<{
        refresh_cookie_present: boolean;
      }>("/auth/session", { method: "GET" });
      if (!session.refresh_cookie_present) {
        this.accessToken = null;
        setSessionHint(false);
        return null;
      }
      const response = await this.refreshAccessToken();
      return response?.user ?? null;
    } catch (error) {
      if (error instanceof BackendError && error.status === 401) return null;
      throw error;
    }
  }

  private refreshAccessToken(): Promise<AuthResponse | null> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.publicRequest<AuthResponse>("/auth/refresh", {
      method: "POST",
    })
      .then((response) => {
        this.acceptAuth(response);
        return response;
      })
      .catch((error) => {
        this.accessToken = null;
        if (error instanceof BackendError && error.status === 401)
          setSessionHint(false);
        throw error;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private async authenticatedRequest<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<T> {
    if (!this.accessToken) await this.refreshAccessToken();
    if (!this.accessToken)
      throw new BackendError(401, "Authentication required");
    const response = await this.fetcher(this.url(path), {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (response.status === 401 && retry) {
      this.accessToken = null;
      await this.refreshAccessToken();
      return this.authenticatedRequest<T>(path, init, false);
    }
    if (!response.ok) throw await errorFrom(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async logout(): Promise<void> {
    try {
      await this.publicRequest<void>("/auth/logout", { method: "POST" });
    } finally {
      this.accessToken = null;
      setSessionHint(false);
    }
  }

  async me(): Promise<AccountUser> {
    return this.authenticatedRequest<AccountUser>("/users/me");
  }

  async createAttempt(payload: AttemptPayload): Promise<StoredAttempt> {
    const response = await this.authenticatedRequest<{
      created: boolean;
      attempt: StoredAttempt;
    }>("/attempts", { method: "POST", body: JSON.stringify(payload) });
    return response.attempt;
  }

  async listAttempts(limit = 20, offset = 0): Promise<AttemptPage> {
    return this.authenticatedRequest<AttemptPage>(
      `/attempts?limit=${limit}&offset=${offset}`,
    );
  }

  async deleteAttempt(attemptId: string): Promise<void> {
    await this.authenticatedRequest<void>(`/attempts/${attemptId}`, {
      method: "DELETE",
    });
  }

  async progressSummary(): Promise<ProgressSummary> {
    return this.authenticatedRequest<ProgressSummary>("/progress/summary");
  }

  async progressTimeline(): Promise<ProgressPoint[]> {
    return this.authenticatedRequest<ProgressPoint[]>(
      "/progress/timeline?limit=30",
    );
  }

  async clearAttempts(): Promise<void> {
    for (;;) {
      const page = await this.listAttempts(100, 0);
      if (page.items.length === 0) return;
      for (const attempt of page.items) await this.deleteAttempt(attempt.id);
    }
  }
}

export const backendClient = new BackendClient();
