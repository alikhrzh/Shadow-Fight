import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const url =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const target = new URL(
  "../apps/web/public/models/pose_landmarker_full.task",
  import.meta.url,
);
const expected =
  "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1";
let data;
try {
  data = await readFile(target);
} catch {}
if (data && createHash("sha256").update(data).digest("hex") === expected) {
  console.log("Model already verified.");
  process.exit(0);
}
const response = await fetch(url);
if (!response.ok) throw Error(`Model download failed: ${response.status}`);
data = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(data).digest("hex") !== expected)
  throw Error("Unexpected model checksum; refusing to install.");
await mkdir(new URL(".", target), { recursive: true });
await writeFile(target, data);
console.log("Official Full model downloaded and verified.");
