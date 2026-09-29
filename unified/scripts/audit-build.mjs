import { readdir, readFile } from "node:fs/promises";
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
const root = new URL("../", import.meta.url);
const secrets = [process.env.NVIDIA_API_KEY].filter(Boolean);
// Read only to compare in memory. Never print keys, env values or source snippets.
for (const name of await readdir(root)) {
  if (!name.startsWith(".env") || name.endsWith(".example")) continue;
  const source = await readFile(new URL(name, root), "utf8");
  for (const line of source.split("\n")) {
    const match = line.match(
      /^\s*(?:export\s+)?(?:NVIDIA_API_KEY|.*SECRET.*|.*TOKEN.*|.*PASSWORD.*)\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/i,
    );
    if (match && match[1].length >= 8) secrets.push(match[1]);
  }
}
for (const name of files.filter((p) => /\.(js|css|html|map|json)$/i.test(p))) {
  const source = await readFile(new URL(`apps/web/dist/${name}`, root), "utf8");
  if (
    /NVIDIA_API_KEY|NVIDIA_BASE_URL|NVIDIA_MODEL|mock-only-value|nvapi-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9_-]{12,}/.test(
      source,
    ) ||
    secrets.some((s) => source.includes(s))
  )
    throw Error(`Server configuration or secret found in public file: ${name}`);
}
console.log(
  `Publication audit: ${files.length} entries; no recordings, landmarks, Python artifacts, server configuration or known secrets.`,
);
