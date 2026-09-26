import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const HITS_STORE = "hits";
export const MAX_HIT_BYTES = 2048;
export const MAX_TAG_LEN = 40;
export const MAX_DIM_KEYS = 400;
export const MAX_HATE_KEYS = 100;
export const TOP_HATES = 40;
export const DEFAULT_DAYS = 14;
export const MAX_DAYS = 90;

const TAG_RE = /[^a-z0-9._-]/g;
const HATE_PATH_RE = /^\/hate\/(hate-[a-z0-9_-]{1,96})$/;
const HATE_ID_RE = /^hate-[a-z0-9_-]{1,96}$/;
const STATIC_PATHS = new Set(["/", "/about", "/privacy", "/thanks", "/404", "/bots"]);
const HTML_PATHS = {
  "/index.html": "/",
  "/about.html": "/about",
  "/privacy.html": "/privacy",
  "/thanks.html": "/thanks",
  "/404.html": "/404",
  "/bots.html": "/bots",
};

const HIT_FIELDS = ["path", "source", "medium", "campaign", "content"];

function noContent() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function normalizeTag(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(TAG_RE, "")
    .slice(0, MAX_TAG_LEN);
}

// Unknown paths collapse to /404 so a missing page still counts, without storing
// the raw path. /hate/<id> aggregates as /hate/*; the id is a separate counter.
export function normalizePath(value) {
  let path = String(value ?? "").trim();
  const hash = path.indexOf("#");
  if (hash !== -1) path = path.slice(0, hash);
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  if (!path.startsWith("/")) path = `/${path}`;
  try {
    path = decodeURIComponent(path);
  } catch {
    return { path: "/404", hateId: "" };
  }
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const lower = path.toLowerCase();
  if (HTML_PATHS[lower]) return { path: HTML_PATHS[lower], hateId: "" };
  if (STATIC_PATHS.has(lower)) return { path: lower, hateId: "" };
  const hate = lower.match(HATE_PATH_RE);
  if (hate) return { path: "/hate/*", hateId: hate[1] };
  return { path: "/404", hateId: "" };
}

export function parseHitFields(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_HIT_BYTES) return null;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const picked = {};
  for (const key of HIT_FIELDS) {
    picked[key] = typeof body[key] === "string" ? body[key] : "";
  }
  const pathInfo = normalizePath(picked.path);
  const source = normalizeTag(picked.source) || "direct";
  return {
    source,
    medium: normalizeTag(picked.medium),
    campaign: normalizeTag(picked.campaign),
    content: normalizeTag(picked.content),
    path: pathInfo.path,
    hateId: pathInfo.hateId,
  };
}

export function dimensionKey(hit) {
  return [hit.source, hit.medium, hit.campaign, hit.content, hit.path].join("|");
}

export function splitDimensionKey(key) {
  const parts = String(key).split("|");
  return {
    source: parts[0] || "",
    medium: parts[1] || "",
    campaign: parts[2] || "",
    content: parts[3] || "",
    path: parts.slice(4).join("|"),
  };
}

function asCountMap(value) {
  const map = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return map;
  for (const [key, count] of Object.entries(value)) {
    const n = Number(count);
    if (!key || !Number.isFinite(n) || n < 0) continue;
    map[key] = Math.round(n);
  }
  return map;
}

export function applyHit(counts, hates, hit, limits = {}) {
  const maxDims = limits.maxDims || MAX_DIM_KEYS;
  const maxHates = limits.maxHates || MAX_HATE_KEYS;
  const nextCounts = asCountMap(counts);
  const key = dimensionKey(hit);
  let countsChanged = false;
  if (key in nextCounts) {
    nextCounts[key] += 1;
    countsChanged = true;
  } else if (Object.keys(nextCounts).length < maxDims) {
    nextCounts[key] = 1;
    countsChanged = true;
  }

  const nextHates = asCountMap(hates);
  let hatesChanged = false;
  if (hit.hateId && HATE_ID_RE.test(hit.hateId)) {
    if (hit.hateId in nextHates) {
      nextHates[hit.hateId] += 1;
      hatesChanged = true;
    } else if (Object.keys(nextHates).length < maxHates) {
      nextHates[hit.hateId] = 1;
      hatesChanged = true;
    }
  }
  return { counts: nextCounts, hates: nextHates, countsChanged, hatesChanged };
}

export function utcDay(date) {
  const value = date instanceof Date ? date : new Date(date);
  return value.toISOString().slice(0, 10);
}

export function hatesKey(day) {
  return `${day}#hates`;
}

export function recentDays(now, count) {
  const end = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}

export function parseDays(value) {
  if (value == null || value === "") return DEFAULT_DAYS;
  if (!/^\d+$/.test(String(value))) return DEFAULT_DAYS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

export function keysMatch(provided, expected) {
  const a = createHash("sha256").update(String(provided ?? ""), "utf8").digest();
  const b = createHash("sha256").update(String(expected ?? ""), "utf8").digest();
  const equal = timingSafeEqual(a, b);
  return equal && typeof expected === "string" && expected.length > 0;
}

function declaredLength(request) {
  const raw = request.headers.get("content-length");
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Read-modify-write. Two overlapping requests can drop a count. That is acceptable.
export async function handleHit(request, store, now = new Date()) {
  if ((request.method || "GET").toUpperCase() !== "POST") return noContent();
  if (declaredLength(request) > MAX_HIT_BYTES) return noContent();

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return noContent();
  }
  const hit = parseHitFields(raw);
  if (!hit) return noContent();

  const day = utcDay(now);
  const counts = (await store.get(day)) || {};
  const hates = (await store.get(hatesKey(day))) || {};
  const next = applyHit(counts, hates, hit);
  if (next.countsChanged) await store.set(day, next.counts);
  if (next.hatesChanged) await store.set(hatesKey(day), next.hates);
  return noContent();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sumCounts(map) {
  let total = 0;
  for (const count of Object.values(map || {})) total += Number(count) || 0;
  return total;
}

export function summarizeHits(days) {
  const daily = [];
  const groups = new Map();
  const pages = new Map();
  const hateTotals = new Map();

  for (const day of days) {
    daily.push({ date: day.date, total: sumCounts(day.counts) });
    for (const [key, count] of Object.entries(day.counts || {})) {
      const dim = splitDimensionKey(key);
      const n = Number(count) || 0;
      const group = `${dim.source}\t${dim.campaign}\t${dim.content}`;
      groups.set(group, (groups.get(group) || 0) + n);
      const page = dim.path || "/404";
      pages.set(page, (pages.get(page) || 0) + n);
    }
    for (const [id, count] of Object.entries(day.hates || {})) {
      if (!HATE_ID_RE.test(id)) continue;
      hateTotals.set(id, (hateTotals.get(id) || 0) + (Number(count) || 0));
    }
  }

  const groupRows = [...groups.entries()].map(([group, count]) => {
    const [source, campaign, content] = group.split("\t");
    return { source, campaign, content, count };
  });
  groupRows.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source) || a.campaign.localeCompare(b.campaign) || a.content.localeCompare(b.content));

  const pageRows = [...pages.entries()].map(([path, count]) => ({ path, count }));
  pageRows.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));

  const hateRows = [...hateTotals.entries()].map(([id, count]) => ({ id, count }));
  hateRows.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  return { daily, groups: groupRows, pages: pageRows, hates: hateRows.slice(0, TOP_HATES) };
}

function statsHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
}

function notFoundResponse(notFoundHtml, method) {
  return new Response(method === "HEAD" ? null : notFoundHtml || "", {
    status: 404,
    headers: statsHeaders("text/html; charset=utf-8"),
  });
}

function cell(value) {
  return value ? escapeHtml(value) : "—";
}

function countTable(headers, rows) {
  const head = headers.map((label) => `<th>${label}</th>`).join("");
  const body = rows.length
    ? rows.join("")
    : `<tr><td colspan="${headers.length}">No hits in this window.</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderStatsHtml(summary) {
  const dayRows = summary.daily.map(
    (day) => `<tr><td>${escapeHtml(day.date)}</td><td class="num">${day.total}</td></tr>`
  );
  const groupRows = summary.groups.map(
    (row) =>
      `<tr><td>${cell(row.source)}</td><td>${cell(row.campaign)}</td><td>${cell(row.content)}</td><td class="num">${row.count}</td></tr>`
  );
  const pageRows = summary.pages.map(
    (row) => `<tr><td>${escapeHtml(row.path)}</td><td class="num">${row.count}</td></tr>`
  );
  const hateRows = summary.hates.map(
    (row) =>
      `<tr><td><a href="/hate/${escapeHtml(row.id)}" rel="noreferrer">${escapeHtml(row.id)}</a></td><td class="num">${row.count}</td></tr>`
  );
  const windowLabel = summary.daily.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="no-referrer">
    <title>HITS · AI HATE IT</title>
    <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: #000;
            color: #00ff9f;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            line-height: 1.45;
        }
        body::before {
            content: "";
            position: fixed;
            inset: 0;
            pointer-events: none;
            background: linear-gradient(rgba(0, 0, 0, 0) 50%, rgba(0, 0, 0, 0.28) 50%);
            background-size: 100% 4px;
        }
        main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; position: relative; }
        h1 { letter-spacing: 0.16em; font-size: 1.4rem; font-weight: 700; }
        h2 { font-size: 0.78rem; letter-spacing: 0.14em; text-transform: uppercase; margin: 2rem 0 0.6rem; }
        a { color: #00ff9f; }
        p { color: #8fbfa8; }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        th, td { text-align: left; padding: 0.4rem 0.45rem; border-bottom: 1px solid rgba(0, 255, 159, 0.28); vertical-align: top; }
        th { color: #d8ffe8; font-weight: 600; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
    </style>
</head>
<body>
    <main>
        <h1>HITS</h1>
        <p>Last ${windowLabel} UTC days. Aggregate page, campaign, and referring host only.</p>
        <h2>By day</h2>
        ${countTable(["Day", "Hits"], dayRows)}
        <h2>Source / campaign / content</h2>
        ${countTable(["Source", "Campaign", "Content", "Hits"], groupRows)}
        <h2>Pages</h2>
        ${countTable(["Page", "Hits"], pageRows)}
        <h2>Top hates</h2>
        ${countTable(["Permalink", "Hits"], hateRows)}
    </main>
</body>
</html>
`;
}

export function statsPayload(summary) {
  return {
    days: summary.daily.length,
    daily: summary.daily,
    groups: summary.groups,
    pages: summary.pages,
    hates: summary.hates,
  };
}

export async function handleStats(request, store, options = {}) {
  const method = (request.method || "GET").toUpperCase();
  const notFoundHtml = options.notFoundHtml || "";
  if (method !== "GET" && method !== "HEAD") return notFoundResponse(notFoundHtml, method);

  const url = new URL(request.url, "http://localhost");
  const expected = typeof options.statsKey === "string" ? options.statsKey : "";
  if (!keysMatch(url.searchParams.get("key") || "", expected)) return notFoundResponse(notFoundHtml, method);

  const days = recentDays(options.now || new Date(), parseDays(url.searchParams.get("days")));
  const rows = [];
  for (const date of days) {
    rows.push({
      date,
      counts: (await store.get(date)) || {},
      hates: (await store.get(hatesKey(date))) || {},
    });
  }
  const summary = summarizeHits(rows);
  if (String(url.searchParams.get("format") || "").toLowerCase() === "json") {
    const body = JSON.stringify(statsPayload(summary));
    return new Response(method === "HEAD" ? null : body, {
      status: 200,
      headers: statsHeaders("application/json; charset=utf-8"),
    });
  }
  return new Response(method === "HEAD" ? null : renderStatsHtml(summary), {
    status: 200,
    headers: statsHeaders("text/html; charset=utf-8"),
  });
}

export function createMemoryHitStore() {
  const data = new Map();
  return {
    async get(key) {
      if (!data.has(key)) return null;
      return JSON.parse(data.get(key));
    },
    async set(key, value) {
      data.set(key, JSON.stringify(value));
    },
    snapshot() {
      return Object.fromEntries([...data.entries()].map(([key, value]) => [key, JSON.parse(value)]));
    },
  };
}

export function createFileHitStore(filePath) {
  const read = () => {
    try {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  };
  const write = (data) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data));
  };
  return {
    async get(key) {
      const value = read()[key];
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      return value;
    },
    async set(key, value) {
      const all = read();
      all[key] = value;
      write(all);
    },
  };
}

export async function openHitStore() {
  if (process.env.HIT_STORE_PATH) return createFileHitStore(process.env.HIT_STORE_PATH);

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: HITS_STORE, consistency: "strong" });
    const strong = { type: "json", consistency: "strong" };
    return {
      async get(key) {
        const data = await store.get(key, strong);
        if (!data || typeof data !== "object" || Array.isArray(data)) return null;
        return data;
      },
      async set(key, value) {
        await store.setJSON(key, value);
      },
    };
  } catch (err) {
    if (process.env.NETLIFY_DEV || process.env.HATE_ALLOW_FILE_FALLBACK === "1") {
      return createFileHitStore("/tmp/aihateit-hits.json");
    }
    throw err;
  }
}
