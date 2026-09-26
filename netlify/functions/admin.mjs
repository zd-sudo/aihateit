import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAdmin } from "../../lib/admin.mjs";
import { openStore } from "../../lib/store.mjs";

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
  const store = await openStore();
  return handleAdmin(request, store, {
    statsKey: statsKeyFromEnv(),
    notFoundHtml,
  });
};
