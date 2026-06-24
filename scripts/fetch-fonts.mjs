// Downloads the self-hosted woff2 fonts into ui/fonts/ (offline-capable app).
// Uses Fontsource CDN (stable paths). Non-fatal: if a download fails, the
// CSS fallback stack (Georgia / system-ui / ui-monospace) is used instead.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "ui", "fonts");
await mkdir(dir, { recursive: true });

const base = "https://cdn.jsdelivr.net/fontsource/fonts";
const files = [
  ["jetbrains-mono@latest/latin-400-normal.woff2", "jbmono-400.woff2"],
  ["jetbrains-mono@latest/latin-600-normal.woff2", "jbmono-600.woff2"],
  ["hanken-grotesk@latest/latin-500-normal.woff2", "hanken-500.woff2"],
  ["hanken-grotesk@latest/latin-600-normal.woff2", "hanken-600.woff2"],
  // Fraunces is variable; fontsource ships static instances. Try italic 600.
  ["fraunces@latest/latin-600-italic.woff2", "fraunces-italic.woff2"],
];

let ok = 0;
for (const [src, dest] of files) {
  try {
    const res = await fetch(`${base}/${src}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(dir, dest), buf);
    console.log(`  ✓ ${dest} (${(buf.length / 1024).toFixed(0)} KB)`);
    ok++;
  } catch (e) {
    console.warn(`  ✗ ${dest} — ${e.message} (CSS fallback will apply)`);
  }
}
console.log(`fonts: ${ok}/${files.length} downloaded`);
