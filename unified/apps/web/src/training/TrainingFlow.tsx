import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Activity, ShieldCheck, ArrowUpRight } from "lucide-react";
import {
  emptyPhases,
  type Report,
  type Stance,
} from "../../../../packages/coach-core/src/types";
import { messages } from "../../../../packages/coach-core/src/evaluate";
import type { LivePhase } from "../../../../packages/coach-core/src/stream";
import {
  initialTraining,
  trainingReducer,
  cameraActive,
  exitGestureAllowed,
  startAllowed,
  type Event,
} from "./trainingMachine";
import { LiveCamera, type CameraFrame } from "../components/LiveCamera";
import { lessons, handLabel } from "../lessons/lessonConfig";
import { LessonScreen } from "../lessons/LessonScreen";
import { body } from "../gestures/geometry";
import { detectHandsUp } from "../gestures/detectHandsUp";
import { detectCrossedArms } from "../gestures/detectCrossedArms";
import { emptyHold, gestureHold } from "../gestures/gestureHold";
import { cameraQuality, gestureCameraQuality } from "./cameraQuality";
import { Countdown } from "./Countdown";
import { CAPTURE_WAIT_MS, captureWaitRemaining } from "./captureDeadline";
import { FeedbackPanel } from "../feedback/FeedbackPanel";
import { safePayload } from "../feedback/safePayload";
import { requestFeedback } from "../feedback/feedbackClient";
import {
  readProgress,
  addProgress,
  saveProgress,
  clearProgress,
} from "../progress/progressStore";

const emptyGestureView = () => ({
  up: 0,
  cross: 0,
  raised: false,
  problem: null as string | null,
  attemptProblem: null as string | null,
});

export function TrainingFlow() {
  const [t, dispatch] = useReducer(trainingReducer, initialTraining),
    current = useRef(t);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [progress, setProgress] = useState(readProgress),
    [storageWarning, setStorageWarning] = useState(false);
  const progressRef = useRef(progress),
    savedId = useRef<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hint, setHint] = useState(
    "Встаньте в боксерскую стойку. Покажите голову, плечи, локти и обе кисти.",
  );
  const [holds, setHolds] = useState(emptyGestureView);
  const [captureView, setCaptureView] = useState({
    phase: "ready" as LivePhase,
    message: "Один удар — затем верните руку и задержитесь в защите.",
  });
  const motionObservedAt = useRef<number | null>(null);
  const up = useRef(emptyHold()),
    cross = useRef(emptyHold()),
    goodSince = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null),
    abortAI = useRef<AbortController | null>(null);
  const send = useCallback((event: Event) => {
    const next = trainingReducer(current.current, event);
    if (next === current.current) return;
    current.current = next;
    if (["START", "EXIT", "HIDDEN", "ERROR"].includes(event.type))
      abortAI.current?.abort();
    if (
      [
        "START",
        "EXIT",
        "HIDDEN",
        "ERROR",
        "PRACTICE",
        "PREPARE_AGAIN",
      ].includes(event.type)
    ) {
      up.current = emptyHold();
      cross.current = emptyHold();
      goodSince.current = null;
      setHolds(emptyGestureView());
      motionObservedAt.current = null;
      setCaptureView({
        phase: "ready",
        message: "Один удар — затем верните руку и задержитесь в защите.",
      });
    }
    if (!cameraActive(next.state)) {
      void audio.current?.close().catch(() => {});
      audio.current = null;
    }
    dispatch(event);
  }, []);
  const start = useCallback(
    () => send({ type: "START", attemptId: crypto.randomUUID() }),
    [send],
  );
  const countdownDone = useCallback(
    (attemptId: string) => send({ type: "COUNTDOWN_DONE", attemptId }),
    [send],
  );
  const exit = useCallback(() => send({ type: "EXIT" }), [send]);

  useEffect(
    () => () => {
      abortAI.current?.abort();
      void audio.current?.close().catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (t.state !== "calibrating_guard" && t.state !== "capturing_attempt")
      return;
    const attemptId = t.attemptId!;
    const waitStarted = performance.now();
    let timer: number;
    const timedOut = () => {
      if (
        current.current.attemptId !== attemptId ||
        current.current.state !== t.state
      )
        return;
      if (t.state === "calibrating_guard")
        send({ type: "PREPARATION_TIMEOUT", attemptId });
      else {
        const started = motionObservedAt.current;
        const remaining = captureWaitRemaining(
          waitStarted,
          started,
          performance.now(),
        );
        if (remaining > 0) {
          timer = window.setTimeout(timedOut, Math.ceil(remaining));
          return;
        }
        const report: Report = {
          status: started === null ? "no_attempt" : "unreliable",
          expected_move: t.move,
          stance: t.stance,
          score: null,
          phases: emptyPhases(),
          peak_method: null,
          violations: [],
          quality: { issues: [] },
          metrics: null,
          score_components: {},
          effective_weights: {},
          main_feedback:
            started === null
              ? "Удар не обнаружен. После «БЕЙ!» выполните один отчётливый удар и верните руку к подбородку. Повторите подготовку."
              : "Начало удара обнаружено, но завершение не подтверждено. Проверьте видимость рук и повторите подготовку.",
        };
        send({ type: "REPORT", attemptId, report });
      }
    };
    timer = window.setTimeout(
      timedOut,
      t.state === "calibrating_guard" ? 10000 : CAPTURE_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [t.state, t.attemptId, t.move, t.stance, send]);
  useEffect(() => {
    if (t.state !== "local_analysis" || !t.report || !t.attemptId) return;
    if (savedId.current !== t.attemptId) {
      savedId.current = t.attemptId;
      const next = addProgress(progressRef.current, t.report);
      progressRef.current = next;
      setProgress(next);
      if (t.report.status === "completed" && !saveProgress(next))
        setStorageWarning(true);
    }
    const timer = window.setTimeout(
      () => send({ type: "ANALYZE", attemptId: t.attemptId! }),
      0,
    );
    return () => clearTimeout(timer);
  }, [t.state, t.report, t.attemptId, send]);
  useEffect(() => {
    if (t.state !== "ai_analysis" || !t.report || !t.attemptId) return;
    const controller = new AbortController();
    abortAI.current = controller;
    // Defer one task so StrictMode setup/cleanup never issues a duplicate request.
    const timer = window.setTimeout(async () => {
      let feedback: Awaited<ReturnType<typeof requestFeedback>> = null;
      try {
        const payload = safePayload(t.report!);
        if (payload)
          feedback = await requestFeedback(payload, controller.signal);
      } catch {
        /* Unexpected aggregate values still retain the local report. */
      }
      if (!controller.signal.aborted)
        send({ type: "AI_DONE", attemptId: t.attemptId!, feedback });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [t.state, t.report, t.attemptId, send]);

  const onFrame = useCallback(
    (data: CameraFrame) => {
      const s = current.current;
      if (!cameraActive(s.state) || data.attemptId !== s.attemptId) return;
      const now = data.frame.timestamp_ms;
      const problem = cameraQuality(data.frame, data.fps, data.dark);
      const gestureProblem = gestureCameraQuality(
        data.frame,
        data.fps,
        data.dark,
        data.width,
        data.height,
      );
      if (["camera_setup", "waiting_for_start_gesture"].includes(s.state)) {
        if (gestureProblem) goodSince.current = null;
        else goodSince.current ??= now;
        const good =
          goodSince.current !== null && now - goodSince.current >= 350;
        send({ type: "POSITION", good });
      }
      if (s.state === "calibrating_guard" && data.mode === "calibrate") {
        setHint(problem ?? data.live.message);
        if (!problem && data.live.phase === "ready")
          send({ type: "GUARD_READY", attemptId: s.attemptId! });
      }
      if (
        s.state === "capturing_attempt" &&
        data.mode === "capture" &&
        data.live.result
      ) {
        send({
          type: "REPORT",
          attemptId: s.attemptId!,
          report: data.live.result,
        });
      }
      if (s.state === "capturing_attempt" && data.mode === "capture") {
        if (data.live.phase === "punch" || data.live.phase === "return")
          motionObservedAt.current ??= performance.now();
        setCaptureView((previous) =>
          previous.phase === data.live.phase &&
          previous.message === data.live.message
            ? previous
            : { phase: data.live.phase, message: data.live.message },
        );
      }
      if (exitGestureAllowed(s.state) || startAllowed(s.state)) {
        const p = body(data.frame, data.width, data.height);
        const crossed = gestureHold(
          cross.current,
          exitGestureAllowed(s.state) &&
            detectCrossedArms(p, cross.current.held > 0),
          now,
          1350,
        );
        cross.current = crossed.state;
        const raisedPose = detectHandsUp(p, up.current.held > 0);
        const raised = gestureHold(
          up.current,
          startAllowed(s.state) && !gestureProblem && raisedPose,
          now,
          950,
        );
        up.current = raised.state;
        setHolds({
          up: raised.progress,
          cross: crossed.progress,
          raised: raisedPose,
          problem: gestureProblem,
          attemptProblem: problem,
        });
        if (crossed.fired) exit();
        else if (raised.fired) start();
      } else {
        up.current = emptyHold();
        cross.current = emptyHold();
      }
    },
    [send, start, exit],
  );

  const lesson = lessons.find((l) => l.move === t.move)!;
  const active = cameraActive(t.state);
  const stage =
    t.state === "selecting_move"
      ? 0
      : t.state === "lesson"
        ? 1
        : t.report
          ? 3
          : 2;
  const mode =
    t.state === "calibrating_guard"
      ? "calibrate"
      : t.state === "capturing_attempt"
        ? "capture"
        : "observe";
  const repeatable = startAllowed(t.state);
  const showExitGesture = exitGestureAllowed(t.state);
  const showGestures = showExitGesture || repeatable;
  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="./"
          onClick={(e) => {
            e.preventDefault();
            exit();
          }}
          aria-label="ShadowCoach — главная"
        >
          <span className="brand-icon">
            <Activity size={23} />
          </span>
          SHADOW<span>COACH</span>
          <small>BETA</small>
        </a>
        <div className="header-note">
          <ShieldCheck size={16} /> Видео остаётся на устройстве
        </div>
      </header>
      <main data-training-state={t.state}>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> ТВОЯ ТЕХНИКА. ШАГ ЗА ШАГОМ.
            </div>
            <h1>
              Каждый удар.
              <br />
              <span>Чуть точнее.</span>
            </h1>
          </div>
          <p>
            Посмотри урок. Выполни один удар.
            <br />
            Получи разбор и понятную цель для следующей попытки.
          </p>
        </section>
        <ol className="lesson-steps" aria-label="Этапы урока">
          {["Выбор удара", "Видеоурок", "Практика", "Разбор"].map((name, i) => (
            <li
              key={name}
              aria-current={i === stage ? "step" : undefined}
              className={i <= stage ? "reached" : ""}
            >
              <b>0{i + 1}</b>
              {name}
            </li>
          ))}
        </ol>
        {t.state === "selecting_move" && (
          <>
            <section className="selection-bar panel settings">
              <div>
                <div className="eyebrow">ВЫБЕРИ СВОЙ УРОК</div>
                <h2>Три удара. Одна цель — техника.</h2>
              </div>
              <div>
                <label htmlFor="stance">СТОЙКА</label>
                <select
                  id="stance"
                  value={t.stance}
                  onChange={(e) =>
                    send({ type: "STANCE", stance: e.target.value as Stance })
                  }
                >
                  <option value="orthodox">Левая нога впереди</option>
                  <option value="southpaw">Правая нога впереди</option>
                </select>
              </div>
            </section>
            <div className="lesson-grid">
              {lessons.map((l, i) => {
                const p = progress[l.move];
                return (
                  <article
                    className="lesson-card panel"
                    key={l.move}
                    data-move={l.move}
                  >
                    <div className="lesson-number">
                      0{i + 1}
                      <ArrowUpRight size={28} />
                    </div>
                    <h2>{l.title}</h2>
                    <p>{l.description}</p>
                    <span className="hand-label">
                      {handLabel(l.move, t.stance)}
                    </span>
                    <ul className="key-points">
                      {l.keyPoints.map((k) => (
                        <li key={k}>{k}</li>
                      ))}
                    </ul>
                    <div className="progress-summary">
                      {p ? (
                        <>
                          <span>{p.count} надёжных попыток</span>
                          <strong>
                            Лучший {p.best}
                            <small>/100</small>
                          </strong>
                          <p>
                            Последний: {p.last} · Средний:{" "}
                            {Math.round(p.average)}
                            <br />
                            {new Date(p.date).toLocaleDateString("ru-RU")}
                          </p>
                          {p.errors.length > 0 && (
                            <p>В фокусе: {messages[p.errors[0]]}</p>
                          )}
                        </>
                      ) : (
                        <>
                          <span>ТВОЙ ПРОГРЕСС</span>
                          <strong>Начни с первого удара</strong>
                          <p>Здесь появятся результаты твоих попыток.</p>
                        </>
                      )}
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => send({ type: "SELECT", move: l.move })}
                      aria-label={`Начать урок: ${l.title}`}
                    >
                      Начать урок <ArrowUpRight size={18} />
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="progress-actions">
              {confirmClear ? (
                <div
                  className="panel"
                  role="group"
                  aria-label="Подтверждение очистки"
                >
                  <p>Удалить весь локальный прогресс трёх уроков?</p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      const ok = clearProgress();
                      progressRef.current = {};
                      setProgress({});
                      setStorageWarning(!ok);
                      setConfirmClear(false);
                    }}
                  >
                    Да, очистить
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setConfirmClear(false)}
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setConfirmClear(true)}
                >
                  Очистить прогресс
                </button>
              )}
              {storageWarning && (
                <p role="status">
                  Хранилище браузера недоступно. Прогресс доступен только до
                  закрытия страницы.
                </p>
              )}
            </div>
          </>
        )}
        {t.state === "lesson" && (
          <>
            <div className="camera-choice settings">
              <label htmlFor="camera">КАМЕРА</label>
              <select
                id="camera"
                value={facing}
                onChange={(e) => setFacing(e.target.value as typeof facing)}
              >
                <option value="user">Передняя / веб-камера</option>
                <option value="environment">Задняя камера</option>
              </select>
            </div>
            <LessonScreen
              lesson={lesson}
              stance={t.stance}
              onBack={exit}
              onPractice={() => {
                try {
                  audio.current = new AudioContext();
                  void audio.current.resume().catch(() => {});
                } catch {
                  /* Sound is optional. */
                }
                setHint("Встаньте в боксерскую стойку. Покажите обе кисти.");
                send({ type: "PRACTICE" });
              }}
            />
          </>
        )}
        {(active || t.state === "camera_error") && (
          <div className="workspace is-active">
            <section className="camera-column">
              <div className="camera-heading">
                <span>
                  <span className={active ? "live-dot" : "idle-dot"} />
                  {lesson.title} · {handLabel(t.move, t.stance)}
                </span>
              </div>
              <div className="controls">
                {repeatable && (
                  <button className="primary-button" onClick={start}>
                    {t.report ? "Повторить" : "Я готов"}
                  </button>
                )}
                {["countdown", "calibrating_guard"].includes(t.state) && (
                  <button
                    className="secondary-button"
                    onClick={() => send({ type: "PREPARE_AGAIN" })}
                  >
                    Повторить подготовку
                  </button>
                )}
                {t.state === "camera_error" && (
                  <button
                    className="primary-button"
                    onClick={() => send({ type: "PRACTICE" })}
                  >
                    Повторить подключение
                  </button>
                )}
                <button className="secondary-button" onClick={exit}>
                  Выбрать другой удар
                </button>
              </div>
              {active ? (
                <LiveCamera
                  move={t.move}
                  stance={t.stance}
                  facing={facing}
                  mode={mode}
                  attemptId={t.attemptId}
                  highlights={
                    t.report?.violations.flatMap((v) => v.related_joints) ?? []
                  }
                  onFrame={onFrame}
                  onReady={() => send({ type: "CAMERA_READY" })}
                  onError={(message) => send({ type: "ERROR", message })}
                  onStop={() => send({ type: "HIDDEN" })}
                />
              ) : (
                <div className="camera-placeholder">
                  <div className="placeholder-copy">
                    <h2>Проверьте камеру</h2>
                    <p role="alert">{t.error}</p>
                  </div>
                </div>
              )}
              <div className="camera-footer">
                <span>Без записи видео. Без микрофона.</span>
                <span>ОДНА ПОПЫТКА</span>
              </div>
              <div className="training-cue" role="status">
                {t.state === "capturing_attempt" ? (
                  <>
                    <strong>
                      {captureView.phase === "ready"
                        ? "БЕЙ!"
                        : captureView.phase === "calibrating"
                          ? "В ЗАЩИТУ"
                          : captureView.phase === "recovering"
                            ? "ПАУЗА"
                            : captureView.phase === "return"
                              ? "ВОЗВРАТ"
                              : "УДАР"}
                    </strong>
                    <p data-testid="capture-hint">{captureView.message}</p>
                  </>
                ) : t.state === "calibrating_guard" ? (
                  <>
                    <h2>Фиксируем защиту…</h2>
                    <p>{hint}</p>
                    <p>Замрите на секунду. Пока не бейте.</p>
                  </>
                ) : showGestures ? (
                  <>
                    <h2>
                      {t.report ? "Ещё одна попытка?" : "Подготовка камеры"}
                    </h2>
                    <p data-testid="start-gesture-hint">
                      {holds.problem ??
                        (holds.raised
                          ? "Руки распознаны. Удерживайте их над головой до заполнения индикатора."
                          : t.report
                            ? "Для повтора поднимите обе кисти выше головы и локти выше плеч. Удерживайте 1 секунду."
                            : "Поднимите обе кисти выше головы и локти выше плеч. Удерживайте 1 секунду.")}
                    </p>
                    {!holds.problem && holds.attemptProblem && (
                      <p data-testid="attempt-framing-hint">
                        Жест запуска доступен. Для оценки удара:{" "}
                        {holds.attemptProblem}
                      </p>
                    )}
                    {t.state === "ai_analysis" && (
                      <p>Повтор отменит текущий AI-разбор.</p>
                    )}
                    {showExitGesture && (
                      <p>
                        Для выхода скрестите предплечья у груди на 1,4 секунды.
                      </p>
                    )}
                  </>
                ) : null}
                {t.error && active && <p>{t.error}</p>}
              </div>
              {showGestures && (
                <div className="gesture-progress">
                  <label>
                    Руки вверх
                    <progress
                      max={1}
                      value={holds.up}
                      aria-label="Удержание рук над головой"
                    />
                  </label>
                  {showExitGesture && (
                    <label>
                      Крест руками
                      <progress
                        max={1}
                        value={holds.cross}
                        aria-label="Удержание креста руками"
                      />
                    </label>
                  )}
                </div>
              )}
            </section>
            <aside>
              <section className="panel practice-notes">
                <div className="eyebrow">В ФОКУСЕ</div>
                <h2>{lesson.title}</h2>
                <ul className="key-points">
                  {lesson.keyPoints.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
                <p>{lesson.safetyNote}</p>
              </section>
              <FeedbackPanel training={t} />
            </aside>
          </div>
        )}
        {t.state === "countdown" && (
          <Countdown
            attemptId={t.attemptId!}
            onDone={countdownDone}
            audio={audio.current}
            onCancel={() => send({ type: "PREPARE_AGAIN" })}
          />
        )}
        <section className="privacy-copy">
          <ShieldCheck size={20} />
          <div>
            <p>
              Видео обрабатывается на вашем устройстве и не отправляется на
              сервер.
            </p>
            <p>
              Для AI-подсказки в NVIDIA отправляются только обезличенные
              числовые метрики и найденные технические ошибки.
            </p>
          </div>
        </section>
        <footer className="site-footer">
          <span>SHADOWCOACH / EDUCATIONAL BETA</span>
          <p>
            ShadowCoach — образовательный прототип. Он анализирует ограниченный
            набор визуально измеримых признаков по одной камере. Не измеряет
            силу удара и не заменяет тренера. Точность на новых людях и ракурсах
            ещё не подтверждена.
          </p>
        </footer>
      </main>
    </div>
  );
}
