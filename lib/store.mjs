import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createMemoryStore(initial = []) {
  let feed = [...initial];
  const rates = new Map();
  return {
    async getFeed() {
      return [...feed];
    },
    async setFeed(next) {
      feed = [...next];
    },
    async getRate(key) {
      return rates.get(key) || 0;
    },
    async setRate(key, ts) {
      rates.set(key, ts);
    },
  };
}

export function createFileStore(filePath) {
  const ratePath = filePath.replace(/\.json$/, "") + ".rates.json";

  const read = (path, fallback) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return fallback;
    }
  };

  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };

  return {
    async getFeed() {
      const data = read(filePath, []);
      return Array.isArray(data) ? data : [];
    },
    async setFeed(next) {
      write(filePath, next);
    },
    async getRate(key) {
      const rates = read(ratePath, {});
      return Number(rates[key]) || 0;
    },
    async setRate(key, ts) {
      const rates = read(ratePath, {});
      rates[key] = ts;
      write(ratePath, rates);
    },
  };
}

export async function createBlobStore() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("aihateit");
  return {
    async getFeed() {
      const data = await store.get("feed", { type: "json" });
      return Array.isArray(data) ? data : [];
    },
    async setFeed(next) {
      await store.setJSON("feed", next);
    },
    async getRate(key) {
      const data = await store.get(key, { type: "json" });
      return Number(data?.ts) || 0;
    },
    async setRate(key, ts) {
      await store.setJSON(key, { ts });
    },
  };
}

export async function openStore() {
  if (process.env.HATE_STORE_PATH) {
    return createFileStore(process.env.HATE_STORE_PATH);
  }

  try {
    return await createBlobStore();
  } catch (err) {
    if (process.env.NETLIFY_DEV || process.env.HATE_ALLOW_FILE_FALLBACK === "1") {
      return createFileStore("/tmp/aihateit-feed.json");
    }
    throw err;
  }
}
