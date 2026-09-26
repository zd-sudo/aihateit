import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function nextEtag(etag) {
  return String((Number(etag) || 0) + 1);
}

export function createMemoryStore(initial = []) {
  let feed = [...initial];
  let feedEtag = "0";
  const rates = new Map();
  const locks = new Set();
  const json = new Map();
  return {
    async getFeed() {
      return [...feed];
    },
    async getFeedMeta() {
      return { feed: [...feed], etag: feedEtag };
    },
    async setFeed(next) {
      feed = [...next];
      feedEtag = nextEtag(feedEtag);
    },
    async setFeedIfMatch(next, etag) {
      if (etag != null && String(etag) !== String(feedEtag)) return false;
      feed = [...next];
      feedEtag = nextEtag(feedEtag);
      return true;
    },
    async getRate(key) {
      return rates.get(key) || 0;
    },
    async setRate(key, ts) {
      rates.set(key, ts);
    },
    async hasLike(key) {
      return locks.has(key);
    },
    async claimLike(key) {
      if (locks.has(key)) return false;
      locks.add(key);
      return true;
    },
    async getJson(key) {
      if (!json.has(key)) return null;
      return structuredClone(json.get(key));
    },
    async setJson(key, value) {
      json.set(key, structuredClone(value));
    },
    async getAgents() {
      const data = json.get("agents");
      return Array.isArray(data) ? structuredClone(data) : [];
    },
    async setAgents(agents) {
      json.set("agents", structuredClone(agents));
    },
  };
}

export function createFileStore(filePath) {
  const ratePath = filePath.replace(/\.json$/, "") + ".rates.json";
  const likePath = filePath.replace(/\.json$/, "") + ".likes.json";
  const etagPath = filePath.replace(/\.json$/, "") + ".etag";
  const jsonPath = filePath.replace(/\.json$/, "") + ".records.json";

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

  const readEtag = () => {
    try {
      return readFileSync(etagPath, "utf8").trim() || "0";
    } catch {
      return "0";
    }
  };

  return {
    async getFeed() {
      const data = read(filePath, []);
      return Array.isArray(data) ? data : [];
    },
    async getFeedMeta() {
      const data = read(filePath, []);
      return { feed: Array.isArray(data) ? data : [], etag: readEtag() };
    },
    async setFeed(next) {
      write(filePath, next);
      writeFileSync(etagPath, nextEtag(readEtag()));
    },
    async setFeedIfMatch(next, etag) {
      const current = readEtag();
      if (etag != null && String(etag) !== String(current)) return false;
      write(filePath, next);
      writeFileSync(etagPath, nextEtag(current));
      return true;
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
    async hasLike(key) {
      const likes = read(likePath, {});
      return Boolean(likes[key]);
    },
    async claimLike(key) {
      const likes = read(likePath, {});
      if (likes[key]) return false;
      likes[key] = Date.now();
      write(likePath, likes);
      return true;
    },
    async getJson(key) {
      const all = read(jsonPath, {});
      return all && Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
    },
    async setJson(key, value) {
      const all = read(jsonPath, {});
      all[key] = value;
      write(jsonPath, all);
    },
    async getAgents() {
      const data = read(jsonPath, {}).agents;
      return Array.isArray(data) ? data : [];
    },
    async setAgents(agents) {
      const all = read(jsonPath, {});
      all.agents = agents;
      write(jsonPath, all);
    },
  };
}

export async function createBlobStore() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "aihateit", consistency: "strong" });
  const strong = { type: "json", consistency: "strong" };

  return {
    async getFeed() {
      const data = await store.get("feed", strong);
      return Array.isArray(data) ? data : [];
    },
    async getFeedMeta() {
      const result = await store.getWithMetadata("feed", strong);
      const data = result?.data;
      return { feed: Array.isArray(data) ? data : [], etag: result?.etag || "" };
    },
    async setFeed(next) {
      await store.setJSON("feed", next);
    },
    async setFeedIfMatch(next, etag) {
      if (!etag) {
        const created = await store.setJSON("feed", next, { onlyIfNew: true });
        return Boolean(created?.modified);
      }
      const updated = await store.setJSON("feed", next, { onlyIfMatch: etag });
      return Boolean(updated?.modified);
    },
    async getRate(key) {
      const data = await store.get(key, strong);
      return Number(data?.ts) || 0;
    },
    async setRate(key, ts) {
      await store.setJSON(key, { ts });
    },
    async hasLike(key) {
      const data = await store.get(key, strong);
      return Boolean(data);
    },
    async claimLike(key) {
      const result = await store.setJSON(key, { ts: Date.now() }, { onlyIfNew: true });
      return Boolean(result?.modified);
    },
    async getJson(key) {
      const data = await store.get(key, strong);
      return data === undefined ? null : data;
    },
    async setJson(key, value) {
      await store.setJSON(key, value);
    },
    async getAgents() {
      const data = await store.get("agents", strong);
      return Array.isArray(data) ? data : [];
    },
    async setAgents(agents) {
      await store.setJSON("agents", agents);
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
