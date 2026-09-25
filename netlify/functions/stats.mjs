import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleStats, openHitStore } from "../../lib/hits.mjs";

function loadNotFoundHtml() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../public/404.html"),
    join(process.cwd(), "public/404.html"),
    join(here, "public/404.html"),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // try the next location
    }
  }
  return "";
}

const notFoundHtml = loadNotFoundHtml();

function statsKeyFromEnv() {
  if (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function") {
    const value = Netlify.env.get("STATS_KEY");
    if (typeof value === "string" && value.length > 0) return value;
  }
  return process.env.STATS_KEY || "";
}

export default async (request) => {
  let store;
  const lazy = {
    async get(key) {
      store = store || (await openHitStore());
      return store.get(key);
    },
    async set(key, value) {
      store = store || (await openHitStore());
      return store.set(key, value);
    },
  };
  return handleStats(request, lazy, {
    statsKey: statsKeyFromEnv(),
    notFoundHtml,
  });
};
