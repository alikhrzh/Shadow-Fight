import { useEffect, useRef, useState, type FormEvent } from "react";
import { Cloud, LogIn, LogOut, RefreshCw, Trash2, User } from "lucide-react";
import { messages } from "../../../../packages/coach-core/src/evaluate";
import type { Move } from "../../../../packages/coach-core/src/types";
import { useAccount } from "./AccountContext";
import { BackendError } from "./backendClient";

export type AuthMode = "login" | "register";

const moveNames: Record<Move, string> = {
  jab: "Джеб",
  cross: "Кросс",
  hook: "Передний боковой",
};

function authError(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.status === 401) return "Неверный email или пароль.";
    if (error.status === 409) return "Аккаунт с таким email уже существует.";
    if (error.status === 422)
      return "Проверьте поля. Пароль должен содержать не менее 10 символов.";
    return `Backend вернул ошибку: ${error.message}`;
  }
  return "Не удалось связаться с backend. Проверьте, что Docker API запущен.";
}

export function AccountControls({
  onOpenAuth,
}: {
  onOpenAuth(mode: AuthMode): void;
}) {
  const account = useAccount();
  if (account.sessionStatus === "restoring")
    return <span className="account-restoring">Проверяем сессию…</span>;
  if (!account.user)
    return (
      <button className="account-button" onClick={() => onOpenAuth("login")}>
        <LogIn size={16} /> Войти
      </button>
    );
  return (
    <div className="account-controls">
      <span className="account-identity" title={account.user.email}>
        <User size={15} /> {account.user.display_name}
      </span>
      <button
        className="account-button account-logout"
        onClick={account.logout}
      >
        <LogOut size={15} /> Выйти
      </button>
    </div>
  );
}

export function AuthDialog({
  initialMode,
  onClose,
}: {
  initialMode: AuthMode;
  onClose(): void;
}) {
  const account = useAccount();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "register")
        await account.register({
          email,
          password,
          display_name: String(form.get("display_name") ?? "").trim(),
        });
      else await account.login({ email, password });
      onClose();
    } catch (submitError) {
      setError(authError(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="auth-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="auth-close"
          aria-label="Закрыть"
          onClick={onClose}
          disabled={busy}
        >
          ×
        </button>
        <div className="eyebrow">
          <span /> АККАУНТ SHADOWCOACH
        </div>
        <h2 id="auth-title">
          {mode === "login" ? "С возвращением" : "Сохраняйте свой прогресс"}
        </h2>
        <p>
          Доступ к истории защищён. Access-токен хранится только в памяти
          страницы, refresh-токен — в HttpOnly cookie.
        </p>
        <div
          className="auth-tabs"
          role="tablist"
          aria-label="Режим авторизации"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            Регистрация
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Имя
              <input
                name="display_name"
                autoComplete="name"
                minLength={1}
                maxLength={80}
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              ref={emailRef}
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={mode === "register" ? 10 : 1}
              maxLength={128}
              required
            />
            {mode === "register" && <small>Минимум 10 символов.</small>}
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy
              ? "Подождите…"
              : mode === "login"
                ? "Войти"
                : "Создать аккаунт"}
          </button>
        </form>
      </section>
    </div>
  );
}

export function AccountOverview({
  onOpenAuth,
}: {
  onOpenAuth(mode: AuthMode): void;
}) {
  const account = useAccount();
  const [actionError, setActionError] = useState<string | null>(null);

  if (account.sessionStatus === "restoring")
    return (
      <section className="account-invite panel" aria-busy="true">
        <Cloud size={22} />
        <div>
          <strong>Подключаем историю тренировок…</strong>
          <p>Локальная тренировка уже доступна.</p>
        </div>
      </section>
    );

  if (!account.user)
    return (
      <section className="account-invite panel">
        <Cloud size={24} />
        <div>
          <strong>Сохраняйте попытки в аккаунте</strong>
          <p>
            Войдите, чтобы backend сохранял историю, лучшие результаты и
            прогресс на разных сессиях. Без аккаунта всё продолжит работать
            локально.
          </p>
          {account.sessionError && (
            <p className="account-warning" role="status">
              {account.sessionError}
            </p>
          )}
        </div>
        <div className="account-invite-actions">
          <button
            className="primary-button"
            onClick={() => onOpenAuth("register")}
          >
            Создать аккаунт
          </button>
          <button
            className="secondary-button"
            onClick={() => onOpenAuth("login")}
          >
            Войти
          </button>
        </div>
      </section>
    );

  const recentTimeline = account.timeline.slice(-8);
  return (
    <section className="account-dashboard panel">
      <div className="account-dashboard-heading">
        <div>
          <div className="eyebrow">
            <span /> BACKEND ПОДКЛЮЧЁН
          </div>
          <h2>История {account.user.display_name}</h2>
          <p>{account.user.email}</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => {
            setActionError(null);
            void account
              .refreshData()
              .catch(() =>
                setActionError("Не удалось обновить данные с backend."),
              );
          }}
          disabled={account.dataLoading}
        >
          <RefreshCw size={16} /> Обновить
        </button>
      </div>
      <div className="account-stats">
        <div>
          <span>НАДЁЖНЫЕ ПОПЫТКИ</span>
          <strong>{account.summary?.reliable_attempts ?? 0}</strong>
        </div>
        <div>
          <span>ВСЯ ИСТОРИЯ</span>
          <strong>{account.historyTotal}</strong>
        </div>
        <div>
          <span>СИНХРОНИЗАЦИЯ</span>
          <strong className={`sync-${account.syncStatus}`}>
            {account.syncStatus === "syncing"
              ? "Идёт"
              : account.syncStatus === "queued"
                ? "В очереди"
                : account.syncStatus === "error"
                  ? "Ошибка"
                  : "Готово"}
          </strong>
        </div>
      </div>
      {(account.syncMessage || account.sessionError || actionError) && (
        <p className="account-sync-message" role="status">
          {actionError ?? account.sessionError ?? account.syncMessage}
        </p>
      )}
      {recentTimeline.length > 0 && (
        <div className="score-timeline" aria-label="Последние результаты">
          <h3>Последние надёжные результаты</h3>
          <div>
            {recentTimeline.map((point) => (
              <span
                key={point.attempt_id}
                title={`${moveNames[point.move]}: ${point.score}`}
              >
                <i style={{ height: `${Math.max(8, point.score)}%` }} />
                <small>{point.score}</small>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="account-history">
        <h3>Недавние попытки</h3>
        {account.dataLoading && !account.attempts.length ? (
          <p>Загружаем историю…</p>
        ) : account.attempts.length ? (
          <ul>
            {account.attempts.map((attempt) => (
              <li key={attempt.id}>
                <div>
                  <strong>{moveNames[attempt.move]}</strong>
                  <span>
                    {new Date(attempt.occurred_at).toLocaleString("ru-RU")}
                  </span>
                  {attempt.violations[0] && (
                    <small>
                      {messages[attempt.violations[0].code] ??
                        attempt.main_feedback}
                    </small>
                  )}
                </div>
                <b>
                  {attempt.score === null
                    ? "Без балла"
                    : `${attempt.score}/100`}
                </b>
                <button
                  className="icon-button"
                  aria-label={`Удалить попытку: ${moveNames[attempt.move]}`}
                  title="Удалить попытку"
                  onClick={() => {
                    if (!window.confirm("Удалить эту попытку из истории?"))
                      return;
                    setActionError(null);
                    void account
                      .deleteAttempt(attempt.id)
                      .catch(() =>
                        setActionError("Не удалось удалить попытку."),
                      );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Завершите первую попытку — она появится здесь.</p>
        )}
      </div>
    </section>
  );
}
