# Architecture and decisions

The application is a static React/Vite site. There is one inference instance per
active camera session, entirely inside a dedicated classic Web Worker. Main thread
owns getUserMedia, video, canvas and controls. Only one transferred ImageBitmap is
in flight; pending frames are not queued. Every bitmap is closed by the worker.

## Data flow

Camera → new video frame → transferable bitmap → MediaPipe Full → raw image/world
landmarks → StreamCoach → final report. Landmarks return to the main thread for
rendering; raw pixels and coordinates are never sent to a server.

`requestVideoFrameCallback` is preferred, with rAF + video.currentTime de-duplication
fallback. Timestamps follow the media timeline. There is a timeout for initialization
and inference, cleanup on stop/unmount, and camera shutdown on hidden document.

The MediaPipe 0.10.14 loader uses `importScripts`. Therefore `scripts/assets.mjs`
bundles the worker with esbuild as IIFE, consistently for development/production.
Module-worker loading is not assumed to work. WASM comes from the same pinned npm
package. Model and WASM use same-origin URLs, not CDN URLs.

## Geometry and reference parity

The core ports Python 0.1.2 normalization, temporal EMA, hand calibration, peak
selection, features, validators, scoring and feedback ordering. Source image and
world coordinates remain separate. Scale is fixed from initial shoulder samples.
Hook peak uses the frozen anatomical shoulder axis and centered median plateau,
never a peak selected to maximize score. Python ties-to-even rounding is preserved.

`shared/config/defaults.json` is the runtime source of thresholds. Reference export
loads it through Python's existing validated configuration loader (JSON is valid
YAML). Frozen Python defaults remain as historical reference, not a second runtime
settings file. The TypeScript inputs are internal validated model outputs; do not
expose an unvalidated external input API around them.

## Presence is not available in Web Tasks

Both the installed `NormalizedLandmark` and `Landmark` interfaces provide x/y/z
and visibility, not per-joint presence. The adapter marks this unavailable without
inventing a numeric value. Only that explicit marker enables visibility-only
checking. Missing unmarked presence is rejected. Explicit low presence is rejected
even if the marker exists. Live reports are marked `visibility_only_web`.
This is a real input-quality difference from Python, so end-to-end outputs are not
promised to match Python's model run. The 142 parity cases compare identical inputs.

References: [NormalizedLandmark](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.normalizedlandmark),
[Landmark](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.landmark).

## Live segmentation

An idle pre-roll retains 700 ms, requires at least 500 ms of context and a valid
compact wrist calibration. Movement onset is independent of the hook peak, so the
wind-up can start an attempt before medial motion exists. The attempt finishes
after a confirmed return plus 100 ms, or a 1.8 s movement timeout plus 100 ms.
Only then is the bounded attempt evaluated by the ported reference algorithm.

Lost joints, multiple people, timestamps gaps >120 ms, or dimension changes reset
calibration; an already active attempt is reported unreliable instead of receiving
technique errors. Duplicate/nonmonotonic frames do not advance the state machine.
A 512-frame safety cap bounds memory. Pausing discards an unfinished attempt, it
does not fabricate a completion or a missing-return violation.

The live preparatory context differs from manually cut video. A clip ending before
return/timeout produces no final live event. This is not the same as the batch
analyzer receiving an explicit end-of-file.

## UI

Video and skeleton use the identical object-fit: contain geometry and mirroring.
Anatomical handedness is not mirrored in analysis. Weak points are not drawn.
Orange highlighting refers only to joints from the last completed report, with
an explicit label; it clears on a new punch or after 2.2 seconds. It is not a claim
that the user's present pose repeats the previous error.

Only derived reports are retained (last 50 details + aggregate counts). Export
contains no raw frame coordinates or camera images. No account, analytics or
automatic data collection was added.
