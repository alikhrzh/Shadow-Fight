# Architecture and decisions

The application is a React/Vite client with an optional Vercel NVIDIA NIM endpoint.
There is one inference instance per
active camera session, entirely inside a dedicated classic Web Worker. Main thread
owns getUserMedia, video, canvas and controls. Only one transferred ImageBitmap is
in flight; pending frames are not queued. Every bitmap is closed by the worker.

## Data flow

Camera → new video frame → transferable bitmap → MediaPipe Full → raw image/world
landmarks → AttemptController → StreamCoach → final report. Landmarks return to the main thread for
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
an explicit label; it clears when a new countdown starts. It is not a claim
that the user's present pose repeats the previous error.

Only the current report stays in memory. LocalStorage stores aggregate progress per
move, score, date and up to three allowed error codes. No frames, coordinates or AI
responses are persisted. No account or analytics was added.

## Educational flow

`trainingMachine.ts` defines accepted events and transitions. Selection → lesson →
camera request → setup → hands-up → countdown → guard calibration → one capture →
local analysis → optional AI explanation → result. Buttons provide alternatives.
Every countdown creates a local UUID. Frame messages echo their UUID and capture
mode; the reducer rejects late worker/AI events. The camera stays mounted through
results for gestures, but the worker no longer feeds frames to StreamCoach.

`AttemptController` wraps the existing core without changing scoring or handedness.
Observe mode never grades; calibration accepts only visible guard poses, requiring
the existing core's baseline. Capture continues that baseline until one final
report, after which a latch blocks further grading. Countdown arm lowering is not
in the baseline. Preparation times out after 10 seconds; missing movement after 8.

Gestures reuse the core's visibility checks and aspect-corrected shoulder scale.
Hands must be above the nose by a head margin, with elbows above shoulders. A cross
requires wrists near opposite shoulders and strict forearm-segment intersection.
Temporal holds accumulate only observed positive time (950/1350 ms), tolerate 160 ms
missing observations, reset on long gaps, use geometric hysteresis and a 1800 ms
cooldown/release latch. Exit gestures are disabled from countdown through AI wait.

Exit, hidden document and errors revoke attempt identity. Cleanup terminates the
worker, stops all tracks, cancels callbacks/timers, clears canvas and removes
listeners. Late camera-permission resolution stops the newly acquired tracks.
AI requests have AbortController cancellation plus an 18-second client deadline;
the server has a shared 14-second deadline covering its single format-repair retry.

## NVIDIA boundary

Browser → allowlisted aggregate payload → same-origin `/api/coach-feedback` → NVIDIA
NIM chat completions. The server revalidates, reconstructs error texts from core
codes, strips unknown data and chooses its own system prompt/model/base URL.
Seven Russian text fields are checked for exact keys, types and length on both
boundaries. The model cannot set the displayed score. JSON validation does not prove
semantic correctness of generated advice; the local report remains visible.

The endpoint limits JSON to 12 KB, requires POST and matching Origin, and uses a
bounded in-memory 8-per-minute IP limiter. This is per warm instance, not a global
quota or authentication boundary. Use deployment-level rate limiting for a public
high-traffic service. No request bodies, model responses or secrets are logged.
Missing key/provider errors/invalid JSON all use existing local core feedback.
