import { useEffect, useRef, useState } from "react";
import type {
  Move,
  Stance,
  Report,
} from "../../../../packages/coach-core/src/types";
import type { WorkerInput, WorkerOutput } from "../pose/protocol";
import { drawOverlay } from "../pose/overlay";
import { visible } from "../../../../packages/coach-core/src/normalize";
export interface CameraStats {
  fps: number;
  latency: number;
  visible: number;
  message: string;
  phase: string;
  delegate: string;
}
interface Props {
  move: Move;
  stance: Stance;
  facing: "user" | "environment";
  onResult: (r: Report) => void;
  onStats: (s: CameraStats) => void;
  onStop: () => void;
}
export function LiveCamera({
  move,
  stance,
  facing,
  onResult,
  onStats,
  onStop,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onResult, onStats, onStop });
  callbacks.current = { onResult, onStats, onStop };
  const [message, setMessage] = useState("Разрешите доступ к камере…"),
    [error, setError] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | null = null,
      worker: Worker | null = null,
      busy = false,
      ready = false,
      raf = 0,
      videoCallback = 0,
      sequence = 0,
      lastVideo = -1,
      lastTimestamp = -1,
      lastRender = 0,
      staleTimer = 0;
    let count = 0,
      windowStart = performance.now(),
      lastStats = 0,
      fps = 0,
      delegate = "",
      requestStarted = 0,
      timeout = 0;
    let highlight: string[] = [],
      highlightUntil = 0;
    const video = videoRef.current!,
      canvas = canvasRef.current!;
    const clear = () => {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    };
    const release = () => {
      ready = false;
      worker?.terminate();
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      cancelAnimationFrame(raf);
      if (video.cancelVideoFrameCallback)
        video.cancelVideoFrameCallback(videoCallback);
      window.clearInterval(staleTimer);
      window.clearTimeout(timeout);
      clear();
    };
    const fail = (text: string) => {
      if (cancelled) return;
      setMessage(text);
      setError(true);
      callbacks.current.onStats({
        fps: 0,
        latency: 0,
        visible: 0,
        message: text,
        phase: "error",
        delegate,
      });
      release();
    };
    const send = (data: WorkerInput, transfer: Transferable[] = []) =>
      worker?.postMessage(data, transfer);
    const schedule = () => {
      if (cancelled || !ready) return;
      if (video.requestVideoFrameCallback)
        videoCallback = video.requestVideoFrameCallback(() => {
          void tick();
        });
      else
        raf = requestAnimationFrame(() => {
          void tick();
        });
    };
    const tick = async () => {
      schedule();
      if (
        cancelled ||
        !ready ||
        busy ||
        video.readyState < 2 ||
        video.currentTime === lastVideo
      )
        return;
      busy = true;
      lastVideo = video.currentTime;
      requestStarted = performance.now();
      const timestamp = Math.max(
        lastTimestamp + 1,
        Math.round(video.currentTime * 1000),
      );
      lastTimestamp = timestamp;
      try {
        const bitmap = await createImageBitmap(video);
        if (cancelled || !ready) {
          bitmap.close();
          return;
        }
        send({ type: "frame", bitmap, timestamp, sequence: ++sequence }, [
          bitmap,
        ]);
        timeout = window.setTimeout(
          () =>
            fail(
              "Обработка кадра зависла. Остановите тренировку и попробуйте снова.",
            ),
          15000,
        );
      } catch {
        busy = false;
        fail(
          "Браузер не смог обработать кадр. Попробуйте актуальный Chrome или Safari.",
        );
      }
    };
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          fail("Для камеры откройте сайт через HTTPS или localhost.");
          return;
        }
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 960 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
        });
        if (cancelled) {
          acquired.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = acquired;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        stream
          .getVideoTracks()[0]
          .addEventListener("ended", () =>
            fail("Камера отключена. Начните тренировку заново."),
          );
        setMessage(
          "Загрузка модели Full… Первый запуск может занять некоторое время.",
        );
        worker = new Worker(
          new URL(
            "worker/pose.js",
            new URL(import.meta.env.BASE_URL, location.href),
          ),
        );
        timeout = window.setTimeout(
          () =>
            fail(
              "Модель не загрузилась за 90 секунд. Проверьте соединение и повторите.",
            ),
          90000,
        );
        worker.onerror = () =>
          fail("Не удалось запустить обработку на этом устройстве.");
        worker.onmessage = ({ data }: MessageEvent<WorkerOutput>) => {
          if (cancelled) return;
          window.clearTimeout(timeout);
          if (data.type === "error") {
            fail(`Ошибка обработки: ${data.message}`);
            return;
          }
          if (data.type === "ready") {
            delegate = data.delegate;
            ready = true;
            setMessage("Замрите в защите на секунду.");
            schedule();
            return;
          }
          busy = false;
          const now = performance.now();
          lastRender = now;
          count++;
          if (now - windowStart >= 750) {
            fps = Math.round((count * 1000) / (now - windowStart));
            count = 0;
            windowStart = now;
          }
          if (data.live.result) {
            highlight = data.live.result.violations.flatMap(
              (v) => v.related_joints,
            );
            highlightUntil = now + 2200;
          } else if (data.live.phase === "punch" || now > highlightUntil)
            highlight = [];
          setReviewVisible(highlight.length > 0);
          drawOverlay(
            canvas,
            data.frame,
            data.width,
            data.height,
            facing === "user",
            highlight,
          );
          if (now - lastStats >= 200) {
            lastStats = now;
            const message =
              fps > 0 && fps < 10
                ? "Недостаточная скорость обработки для оценки. Закройте другие приложения или попробуйте более мощное устройство."
                : data.live.message;
            setMessage(message);
            callbacks.current.onStats({
              fps,
              latency: Math.round(now - requestStarted),
              visible: Object.values(data.frame.landmarks).filter((p) =>
                visible(p),
              ).length,
              message,
              phase: data.live.phase,
              delegate,
            });
          }
          if (data.live.result) callbacks.current.onResult(data.live.result);
        };
        send({
          type: "init",
          baseUrl: new URL(import.meta.env.BASE_URL, location.href).href,
          move,
          stance,
        });
        staleTimer = window.setInterval(() => {
          if (lastRender && performance.now() - lastRender > 400) clear();
        }, 200);
      } catch (cause) {
        const e = cause as Error;
        fail(
          e.name === "NotAllowedError"
            ? "Доступ к камере запрещён. Разрешите его в настройках браузера."
            : e.name === "NotFoundError"
              ? "Камера не найдена. Подключите её и повторите."
              : "Не удалось открыть камеру. Закройте другие приложения, использующие её.",
        );
      }
    }
    const visibility = () => {
      if (document.hidden) callbacks.current.onStop();
    };
    document.addEventListener("visibilitychange", visibility);
    void start();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [move, stance, facing]);
  return (
    <div className="live-camera">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
        aria-label="Камера тренировки"
      />
      <canvas ref={canvasRef} aria-hidden="true" />
      <div
        className={`camera-label ${error ? "camera-error" : ""}`}
        role="status"
      >
        {message}
      </div>
      <span className="privacy-chip">● Только на вашем устройстве</span>
      {reviewVisible && (
        <span className="review-chip">
          Оранжевое: суставы из замечания к последнему удару
        </span>
      )}
    </div>
  );
}
