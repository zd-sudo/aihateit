import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function addUniqueId(ids, id) {
  const next = Array.isArray(ids) ? ids.map(String) : [];
  const value = String(id);
  if (!next.includes(value)) next.push(value);
  return next;
}

export function createMemoryStore(initial = []) {
  let feed = [...initial];
  const rates = new Map();
  const likes = new Map();
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
    async getLikedIds(key) {
      return [...(likes.get(key) || [])];
    },
    async addLikedId(key, id) {
      likes.set(key, addUniqueId(likes.get(key), id));
    },
  };
}

export function createFileStore(filePath) {
  const ratePath = filePath.replace(/\.json$/, "") + ".rates.json";
  const likePath = filePath.replace(/\.json$/, "") + ".likes.json";

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
    async getLikedIds(key) {
      const likes = read(likePath, {});
      return Array.isArray(likes[key]) ? likes[key].map(String) : [];
    },
    async addLikedId(key, id) {
      const likes = read(likePath, {});
      likes[key] = addUniqueId(likes[key], id);
      write(likePath, likes);
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
    async getLikedIds(key) {
      const data = await store.get(key, { type: "json" });
      return Array.isArray(data?.ids) ? data.ids.map(String) : [];
    },
    async addLikedId(key, id) {
      const ids = addUniqueId(await this.getLikedIds(key), id);
      await store.setJSON(key, { ids });
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
