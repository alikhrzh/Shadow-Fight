import { useEffect, useRef, useState } from "react";
import type { Move, Stance } from "../../../../packages/coach-core/src/types";
import type { WorkerInput, WorkerOutput } from "../pose/protocol";
import type { CaptureMode } from "../training/attemptController";
import { drawOverlay } from "../pose/overlay";
export type CameraFrame = Extract<WorkerOutput, { type: "result" }> & {
  fps: number;
  dark: boolean;
};
interface Props {
  move: Move;
  stance: Stance;
  facing: "user" | "environment";
  mode: CaptureMode;
  attemptId: string | null;
  highlights: string[];
  onFrame: (frame: CameraFrame) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onStop: () => void;
}
export function LiveCamera(props: Props) {
  const videoRef = useRef<HTMLVideoElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [message, setMessage] = useState("Разрешите доступ к камере…");
  const { move, stance, facing } = props;
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | null = null,
      worker: Worker | null = null;
    let ready = false,
      busy = false,
      raf = 0,
      videoCallback = 0,
      sequence = 0,
      lastVideo = -1;
    let lastTimestamp = -1,
      lastRender = 0,
      staleTimer = 0,
      timeout = 0,
      startup = 0;
    let count = 0,
      windowStart = 0,
      fps = 0,
      dark = false,
      lastLight = 0;
    const video = videoRef.current!,
      canvas = canvasRef.current!;
    const light = document.createElement("canvas");
    light.width = 16;
    light.height = 12;
    const lightContext = light.getContext("2d", { willReadFrequently: true });
    const clear = () =>
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    const ended = () => fail("Камера отключена. Откройте её заново.");
    const release = () => {
      ready = false;
      worker?.terminate();
      worker = null;
      stream?.getTracks().forEach((t) => {
        t.removeEventListener("ended", ended);
        t.stop();
      });
      video.srcObject = null;
      cancelAnimationFrame(raf);
      video.cancelVideoFrameCallback?.(videoCallback);
      window.clearInterval(staleTimer);
      window.clearTimeout(timeout);
      window.clearTimeout(startup);
      clear();
    };
    const fail = (text: string) => {
      if (cancelled) return;
      cancelled = true;
      release();
      latest.current.onError(text);
    };
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
      const timestamp = Math.max(
        lastTimestamp + 1,
        Math.round(video.currentTime * 1000),
      );
      lastTimestamp = timestamp;
      let bitmap: ImageBitmap | null = null;
      try {
        if (performance.now() - lastLight > 750 && lightContext) {
          lastLight = performance.now();
          lightContext.drawImage(video, 0, 0, 16, 12);
          const pixels = lightContext.getImageData(0, 0, 16, 12).data;
          let brightness = 0;
          for (let i = 0; i < pixels.length; i += 4)
            brightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          dark = brightness / (16 * 12) < 24;
        }
        bitmap = await createImageBitmap(video);
        if (cancelled || !ready || !worker) {
          bitmap.close();
          return;
        }
        const current = latest.current;
        const data: WorkerInput = {
          type: "frame",
          bitmap,
          timestamp,
          sequence: ++sequence,
          mode: current.mode,
          attemptId: current.attemptId,
        };
        worker.postMessage(data, [bitmap]);
        bitmap = null;
        timeout = window.setTimeout(
          () =>
            fail(
              "Обработка кадров слишком медленная. Повторите на другом устройстве.",
            ),
          15000,
        );
      } catch {
        bitmap?.close();
        busy = false;
        fail(
          "Браузер не смог обработать кадр. Попробуйте актуальный Chrome или Safari.",
        );
      }
    };
    async function start() {
      try {
        if (cancelled) return;
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          return fail("Для камеры откройте сайт через HTTPS или localhost.");
        timeout = window.setTimeout(
          () =>
            fail(
              "Разрешение камеры не получено. Проверьте настройки браузера и повторите.",
            ),
          30000,
        );
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
        window.clearTimeout(timeout);
        stream = acquired;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        stream.getTracks().forEach((t) => t.addEventListener("ended", ended));
        setMessage(
          "Готовим распознавание движений… Первый запуск может занять до минуты.",
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
              "Распознавание не загрузилось. Проверьте соединение и повторите.",
            ),
          90000,
        );
        worker.onerror = () =>
          fail("Не удалось запустить обработку на этом устройстве.");
        worker.onmessage = ({ data }: MessageEvent<WorkerOutput>) => {
          if (cancelled) return;
          window.clearTimeout(timeout);
          if (data.type === "error")
            return fail(
              "Не удалось обработать движение. Перезапустите камеру.",
            );
          if (data.type === "ready") {
            ready = true;
            windowStart = performance.now();
            setMessage("");
            latest.current.onReady();
            schedule();
            return;
          }
          busy = false;
          const now = performance.now();
          lastRender = now;
          count++;
          if (now - windowStart >= 1000) {
            fps = Math.round((count * 1000) / (now - windowStart));
            count = 0;
            windowStart = now;
          }
          drawOverlay(
            canvas,
            data.frame,
            data.width,
            data.height,
            facing === "user",
            latest.current.highlights,
          );
          latest.current.onFrame({ ...data, fps, dark });
        };
        worker.postMessage({
          type: "init",
          baseUrl: new URL(import.meta.env.BASE_URL, location.href).href,
          move,
          stance,
        } satisfies WorkerInput);
        staleTimer = window.setInterval(() => {
          if (lastRender && performance.now() - lastRender > 400) clear();
        }, 200);
      } catch (cause) {
        const name = (cause as Error).name;
        fail(
          name === "NotAllowedError"
            ? "Доступ к камере запрещён. Разрешите его в настройках браузера."
            : name === "NotFoundError"
              ? "Камера не найдена. Подключите её и повторите."
              : "Не удалось открыть камеру. Закройте другие приложения, использующие её.",
        );
      }
    }
    const visibility = () => {
      if (document.hidden) {
        cancelled = true;
        release();
        latest.current.onStop();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    // StrictMode may clean up its first effect before re-running setup. Defer
    // permission acquisition so the discarded effect never requests a stream.
    startup = window.setTimeout(() => {
      void start();
    }, 0);
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
      {message && (
        <div className="camera-label" role="status">
          {message}
        </div>
      )}
      <span className="privacy-chip">● Видео на устройстве</span>
    </div>
  );
}
