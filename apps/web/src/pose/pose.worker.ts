import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  names,
  type Frame,
  type Point,
} from "../../../../packages/coach-core/src/types";
import { AttemptController } from "../training/attemptController";
import type { WorkerInput, WorkerOutput } from "./protocol";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
  postMessage: (data: WorkerOutput) => void;
};
let model: PoseLandmarker | null = null,
  coach: AttemptController | null = null,
  index = 0;
scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      model?.close();
      coach = new AttemptController(data.move, data.stance);
      index = 0;
      const files = await FilesetResolver.forVisionTasks(
        new URL("wasm/", data.baseUrl).href,
      );
      const options = {
        baseOptions: {
          modelAssetPath: new URL(
            "models/pose_landmarker_full.task",
            data.baseUrl,
          ).href,
        },
        runningMode: "VIDEO" as const,
        numPoses: 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      };
      let delegate = "GPU";
      try {
        model = await PoseLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "GPU" },
        });
      } catch {
        delegate = "CPU";
        model = await PoseLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" },
        });
      }
      scope.postMessage({ type: "ready", delegate });
      return;
    }
    if (data.type === "reset") {
      coach?.reset();
      return;
    }
    const bitmap = data.bitmap;
    try {
      if (!model || !coach) throw Error("Модель ещё не готова.");
      const started = performance.now(),
        result = model.detectForVideo(bitmap, data.timestamp);
      const map = (points: Point[] | undefined) =>
        Object.fromEntries(
          (points ?? []).map((p, i) => [
            names[i],
            {
              x: p.x,
              y: p.y,
              z: p.z,
              visibility: p.visibility ?? 0,
              ...(p.presence === undefined
                ? { presence_unavailable: true as const }
                : { presence: p.presence }),
            },
          ]),
        );
      const frame: Frame = {
        frame: index++,
        timestamp_ms: data.timestamp,
        pose_count: result.landmarks.length,
        landmarks: map(result.landmarks[0]),
        world_landmarks: map(result.worldLandmarks[0]),
      };
      const live = coach.push(
        frame,
        bitmap.width,
        bitmap.height,
        data.mode ?? "observe",
        data.attemptId ?? null,
      );
      scope.postMessage({
        type: "result",
        frame,
        live,
        width: bitmap.width,
        height: bitmap.height,
        duration: performance.now() - started,
        sequence: data.sequence,
        attemptId: data.attemptId ?? null,
        mode: data.mode ?? "observe",
      });
    } finally {
      bitmap.close();
    }
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
