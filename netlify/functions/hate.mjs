import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleHate } from "../../lib/handler.mjs";
import { openStore } from "../../lib/store.mjs";

function loadSeed() {
  try {
    const require = createRequire(import.meta.url);
    const bundled = require("../../data/seed.json");
    if (Array.isArray(bundled)) return bundled;
  } catch {
    // fall through to on-disk paths (included_files / local)
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../data/seed.json"),
    join(here, "data/seed.json"),
    join(process.cwd(), "data/seed.json"),
  ];
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next location
    }
  }
  return [];
}

const seed = loadSeed();

export default async (request) => {
  const store = await openStore();
  return handleHate(request, store, seed);
};
