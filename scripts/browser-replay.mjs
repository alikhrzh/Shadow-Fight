// Local-only browser inference on supplied MP4s. No recording is published.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const run = process.argv[2];
if (!run)
  throw Error("Usage: node scripts/browser-replay.mjs ABSOLUTE_BASELINE_RUN");
const dataset =
  process.argv[3] && !process.argv[3].startsWith("--")
    ? process.argv[3]
    : path.resolve(run, "../../../datasets/untitled_2026-09-29");
const rows = JSON.parse(await readFile(path.join(run, "results.json"), "utf8"));
const selected = process.argv.includes("--all")
  ? rows
  : rows.filter(
      (r) =>
        r.primary_run &&
        [
          "jab_001",
          "jab_007",
          "hook_001",
          "hook_002",
          "hook_006",
          "no_punch_001",
          "no_punch_002",
          "no_punch_003",
        ].includes(r.clip_id),
    );
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal"],
});
const results = [];
try {
  for (const row of selected) {
    const input = path.join(
      dataset,
      ...row.input.split("/datasets/untitled_2026-09-29/").slice(1),
    );
    const report = JSON.parse(
      await readFile(path.join(run, row.output, "report.json"), "utf8"),
    );
    const bytes = await readFile(input);
    const page = await browser.newPage();
    await page.route("**/local-replay.mp4", (route) => {
      const range = route.request().headers().range,
        match = range?.match(/bytes=(\d+)-(\d*)/);
      if (!match)
        return route.fulfill({
          body: bytes,
          contentType: "video/mp4",
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(bytes.length),
          },
        });
      const start = Number(match[1]),
        end = match[2]
          ? Math.min(Number(match[2]), bytes.length - 1)
          : bytes.length - 1;
      return route.fulfill({
        status: 206,
        body: bytes.subarray(start, end + 1),
        contentType: "video/mp4",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": String(end - start + 1),
        },
      });
    });
    await page.goto("http://127.0.0.1:5173/");
    const result = await page.evaluate(
      async ({ info, move, stance }) => {
        const worker = new Worker("/worker/pose.js");
        let reply;
        const receive = () =>
          new Promise((resolve, reject) => {
            reply = { resolve, reject };
          });
        worker.onmessage = ({ data }) =>
          data.type === "error"
            ? reply?.reject(Error(data.message))
            : reply?.resolve(data);
        worker.onerror = (e) => reply?.reject(Error(e.message));
        let pending = receive();
        worker.postMessage({
          type: "init",
          baseUrl: location.origin + "/",
          move,
          stance,
        });
        const initialized = await pending;
        const video = document.createElement("video");
        video.muted = true;
        video.src = "/local-replay.mp4";
        video.preload = "auto";
        document.body.append(video);
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = reject;
        });
        const results = [],
          rawFrames = [];
        let maxDuration = 0,
          totalDuration = 0;
        try {
          for (let i = 0; i < info.frame_count; i++) {
            const time = (i + 0.1) / info.fps;
            await new Promise((resolve) => {
              video.onseeked = resolve;
              video.currentTime = Math.min(time, video.duration - 0.001);
            });
            if (Math.abs(video.currentTime - time) > 0.1)
              throw Error(
                `Video did not seek: ${video.currentTime} vs ${time}`,
              );
            const bitmap = await createImageBitmap(video);
            pending = receive();
            worker.postMessage(
              {
                type: "frame",
                bitmap,
                timestamp: Math.round((i * 1000) / info.fps),
                sequence: i,
              },
              [bitmap],
            );
            const data = await pending;
            rawFrames.push(data.frame);
            maxDuration = Math.max(maxDuration, data.duration);
            totalDuration += data.duration;
            if (data.live.result) results.push(data.live.result);
          }
        } finally {
          worker.terminate();
          video.remove();
        }
        return {
          delegate: initialized.delegate,
          results,
          rawFrames,
          frames: info.frame_count,
          meanProcessingMs: totalDuration / info.frame_count,
          maxProcessingMs: maxDuration,
        };
      },
      { info: report.video_info, move: row.expected_move, stance: "orthodox" },
    );
    results.push({
      id: row.run_id,
      move: row.expected_move,
      info: report.video_info,
      ...result,
    });
    await writeFile(
      "private-data/browser-replay.json",
      JSON.stringify(results),
    );
    console.log(
      JSON.stringify({
        id: row.run_id,
        frames: result.frames,
        meanMs: Math.round(result.meanProcessingMs),
        statuses: result.results.map((r) => r.status),
      }),
    );
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile("private-data/browser-replay.json", JSON.stringify(results));
}
