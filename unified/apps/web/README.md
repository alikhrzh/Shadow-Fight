# ShadowCoach

ShadowCoach is a browser-based boxing technique coach. The current foundation includes a Vite + React 18 application, strict TypeScript, Tailwind CSS, webcam lifecycle management, and local pose tracking with MediaPipe Tasks Vision.

## Getting started

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, allow camera access, and keep your upper body visible. Camera access requires `localhost` or HTTPS.

## Available scripts

- `npm run dev` — start the development server
- `npm run typecheck` — run strict TypeScript checks
- `npm run build` — typecheck and create a production build
- `npm run preview` — serve the production build locally

## Current scope

- MediaPipe Pose Landmarker initialization using the lite pose model
- `requestAnimationFrame` video inference loop with duplicate-frame protection
- Exponential moving-average landmark smoothing
- Shoulder-width coordinate normalization
- Mirrored, device-pixel-ratio-aware skeleton canvas overlay
- Camera permission, initialization, tracking-loss, and recovery states

The punch state machine, validators, workout engine, persistence layer, and backend API are the next implementation phase.
