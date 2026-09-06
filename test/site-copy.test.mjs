import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public/index.html"), "utf8");

test("public homepage footer uses the brand, not a personal name", () => {
  assert.match(html, /© 2026 AI HATE IT • Made with pure spite and Tailwind/);
  assert.doesNotMatch(html, /Zach(?:'s)?(?:\s+Domain)?/i);
});
