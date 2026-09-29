import { readdir } from "node:fs/promises";
const files = await readdir(new URL("../apps/web/dist/", import.meta.url), {
  recursive: true,
});
const forbidden = files.filter(
  (p) =>
    /\.(mp4|mov|jsonl|py|csv|tar|gz)$/i.test(p) ||
    /(^|\/)(datasets|private-data|runs|\.env)(\/|$)/.test(p),
);
if (forbidden.length)
  throw Error(
    `Private/development files in deployment: ${forbidden.join(", ")}`,
  );
console.log(
  `Publication audit: ${files.length} entries; no recordings, landmarks or Python artifacts.`,
);
