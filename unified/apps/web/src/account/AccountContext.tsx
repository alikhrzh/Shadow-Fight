import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Report } from "../../../../packages/coach-core/src/types";
import { toAttemptPayload } from "./attemptPayload";
import { BackendError, backendClient } from "./backendClient";
import { queueAttempt, readOutbox, removeQueuedAttempt } from "./outbox";
import type {
  AccountUser,
  ProgressPoint,
  ProgressSummary,
  StoredAttempt,
} from "./types";

type SessionStatus = "restoring" | "guest" | "authenticated";
type SyncStatus = "idle" | "syncing" | "synced" | "queued" | "error";

interface AccountContextValue {
  sessionStatus: SessionStatus;
  user: AccountUser | null;
  summary: ProgressSummary | null;
  attempts: StoredAttempt[];
  timeline: ProgressPoint[];
  historyTotal: number;
  dataLoading: boolean;
  sessionError: string | null;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  login(input: { email: string; password: string }): Promise<void>;
  register(input: {
    email: string;
    password: string;
    display_name: string;
  }): Promise<void>;
  logout(): Promise<void>;
  refreshData(): Promise<void>;
  recordAttempt(attemptId: string, report: Report): Promise<void>;
  deleteAttempt(attemptId: string): Promise<void>;
  clearHistory(): Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const connectionMessage =
  "Backend недоступен. Тренировка продолжит работать локально.";

export function AccountProvider({ children }: { children: ReactNode }) {
  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("restoring");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [attempts, setAttempts] = useState<StoredAttempt[]>([]);
  const [timeline, setTimeline] = useState<ProgressPoint[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [nextSummary, history, nextTimeline] = await Promise.all([
        backendClient.progressSummary(),
        backendClient.listAttempts(10, 0),
        backendClient.progressTimeline(),
      ]);
      setSummary(nextSummary);
      setAttempts(history.items);
      setHistoryTotal(history.total);
      setTimeline(nextTimeline);
      setSessionError(null);
    } catch (error) {
      if (error instanceof BackendError && error.status === 401) {
        setUser(null);
        setSessionStatus("guest");
        setSummary(null);
        setAttempts([]);
        setTimeline([]);
        setHistoryTotal(0);
        setSessionError("Сессия истекла. Войдите снова.");
      }
      throw error;
    } finally {
      setDataLoading(false);
    }
  }, []);

  const flushOutbox = useCallback(
    async (activeUser: AccountUser) => {
      const queued = readOutbox(activeUser.id);
      if (!queued.length) return;
      setSyncStatus("syncing");
      for (const payload of queued) {
        try {
          await backendClient.createAttempt(payload);
          removeQueuedAttempt(activeUser.id, payload.client_attempt_id);
        } catch {
          setSyncStatus("queued");
          setSyncMessage(
            "Есть локально сохранённые попытки. Синхронизация повторится при восстановлении связи.",
          );
          return;
        }
      }
      setSyncStatus("synced");
      setSyncMessage("Сохранённые попытки синхронизированы.");
      await refreshData();
    },
    [refreshData],
  );

  useEffect(() => {
    let active = true;
    void backendClient
      .restoreSession()
      .then((restoredUser) => {
        if (!active) return;
        if (!restoredUser) {
          setSessionStatus("guest");
          return;
        }
        setUser(restoredUser);
        setSessionStatus("authenticated");
        void (async () => {
          try {
            await refreshData();
            if (active) await flushOutbox(restoredUser);
          } catch (error) {
            if (
              active &&
              !(error instanceof BackendError && error.status === 401)
            )
              setSessionError(
                "Сессия восстановлена, но историю пока не удалось загрузить.",
              );
          }
        })();
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setSessionStatus("guest");
        setSessionError(connectionMessage);
      });
    return () => {
      active = false;
    };
  }, [flushOutbox, refreshData]);

  useEffect(() => {
    if (!user) return;
    const retry = () => void flushOutbox(user);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [flushOutbox, user]);

  const finishAuthentication = useCallback(
    async (authenticatedUser: AccountUser) => {
      setUser(authenticatedUser);
      setSessionStatus("authenticated");
      setSessionError(null);
      setSyncStatus("idle");
      setSyncMessage(null);
      try {
        await refreshData();
        await flushOutbox(authenticatedUser);
      } catch (error) {
        if (error instanceof BackendError && error.status === 401) throw error;
        setSessionError("Вход выполнен, но историю пока не удалось загрузить.");
      }
    },
    [flushOutbox, refreshData],
  );

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      await finishAuthentication(await backendClient.login(input));
    },
    [finishAuthentication],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      display_name: string;
    }) => {
      await finishAuthentication(await backendClient.register(input));
    },
    [finishAuthentication],
  );

  const logout = useCallback(async () => {
    try {
      await backendClient.logout();
      setSessionError(null);
    } catch {
      setSessionError(
        "Локальный сеанс завершён, но backend не подтвердил отзыв refresh-сессии.",
      );
    } finally {
      setUser(null);
      setSessionStatus("guest");
      setSummary(null);
      setAttempts([]);
      setTimeline([]);
      setHistoryTotal(0);
      setSyncStatus("idle");
      setSyncMessage(null);
    }
  }, []);

  const recordAttempt = useCallback(
    async (attemptId: string, report: Report) => {
      if (!user) return;
      const payload = toAttemptPayload(attemptId, report);
      setSyncStatus("syncing");
      setSyncMessage("Сохраняем попытку в аккаунте…");
      try {
        await backendClient.createAttempt(payload);
        removeQueuedAttempt(user.id, attemptId);
        setSyncStatus("synced");
        setSyncMessage("Попытка сохранена в аккаунте.");
        await refreshData();
      } catch (error) {
        if (error instanceof BackendError && error.status < 500) {
          if (error.status === 401) {
            setUser(null);
            setSessionStatus("guest");
            setSessionError("Сессия истекла. Войдите снова.");
          }
          setSyncStatus("error");
          setSyncMessage(
            "Backend отклонил отчёт. Локальный результат сохранён.",
          );
          return;
        }
        const queued = queueAttempt(user.id, payload);
        setSyncStatus(queued ? "queued" : "error");
        setSyncMessage(
          queued
            ? "Backend недоступен. Попытка сохранена локально и будет отправлена позже."
            : "Не удалось сохранить попытку в backend или локальную очередь.",
        );
      }
    },
    [refreshData, user],
  );

  const deleteAttempt = useCallback(
    async (attemptId: string) => {
      await backendClient.deleteAttempt(attemptId);
      await refreshData();
    },
    [refreshData],
  );

  const clearHistory = useCallback(async () => {
    await backendClient.clearAttempts();
    await refreshData();
  }, [refreshData]);

  const value = useMemo<AccountContextValue>(
    () => ({
      sessionStatus,
      user,
      summary,
      attempts,
      timeline,
      historyTotal,
      dataLoading,
      sessionError,
      syncStatus,
      syncMessage,
      login,
      register,
      logout,
      refreshData,
      recordAttempt,
      deleteAttempt,
      clearHistory,
    }),
    [
      attempts,
      clearHistory,
      dataLoading,
      deleteAttempt,
      historyTotal,
      login,
      logout,
      recordAttempt,
      refreshData,
      register,
      sessionError,
      sessionStatus,
      summary,
      syncMessage,
      syncStatus,
      timeline,
      user,
    ],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside AccountProvider");
  return value;
}
