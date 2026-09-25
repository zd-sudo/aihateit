import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  MAX_DIM_KEYS,
  MAX_HATE_KEYS,
  MAX_HIT_BYTES,
  MAX_TAG_LEN,
  applyHit,
  createFileHitStore,
  createMemoryHitStore,
  dimensionKey,
  handleHit,
  handleStats,
  keysMatch,
  utcDay,
  normalizePath,
  normalizeTag,
  parseDays,
  parseHitFields,
} from "../lib/hits.mjs";
import { handleHateShare } from "../lib/share.mjs";
import { createMemoryStore } from "../lib/store.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const now = new Date("2026-09-25T18:00:00Z");
const day = "2026-09-25";
const notFoundHtml = readFileSync(join(root, "public/404.html"), "utf8");
const hitJs = readFileSync(join(root, "public/hit.js"), "utf8");
const statsKey = "stats-key-9f3a";
const ip = "203.0.113.55";
const ua = "SpyBrowser/9.9";
const cookie = "visitor-secret-token";

function post(body, headers = {}) {
  return new Request("http://localhost/api/hit", {
    method: "POST",
    headers: { "content-type": "text/plain", ...headers },
    body,
  });
}

async function read(response) {
  return { status: response.status, text: await response.text(), headers: response.headers };
}

test("tags are lowercased, whitelisted, and capped at 40 characters", () => {
  assert.equal(normalizeTag("X"), "x");
  assert.equal(normalizeTag("Hello World!"), "helloworld");
  assert.equal(normalizeTag("x.com"), "x.com");
  assert.equal(normalizeTag("Launch_1.bio-tag"), "launch_1.bio-tag");
  assert.equal(normalizeTag("  SOCIAL  "), "social");
  assert.equal(normalizeTag(""), "");
  assert.equal(normalizeTag(null), "");
  assert.equal(normalizeTag("a".repeat(80)).length, MAX_TAG_LEN);
  assert.equal(MAX_TAG_LEN, 40);
});

test("paths stay on known pages and hate ids collapse", () => {
  assert.deepEqual(normalizePath("/"), { path: "/", hateId: "" });
  assert.deepEqual(normalizePath("/about/"), { path: "/about", hateId: "" });
  assert.deepEqual(normalizePath("/privacy.html"), { path: "/privacy", hateId: "" });
  assert.deepEqual(normalizePath("/ABOUT"), { path: "/about", hateId: "" });
  assert.deepEqual(normalizePath("/hate/hate-200-bbbbbb"), { path: "/hate/*", hateId: "hate-200-bbbbbb" });
  assert.deepEqual(normalizePath("/hate/hate-200-bbbbbb/"), { path: "/hate/*", hateId: "hate-200-bbbbbb" });
  assert.deepEqual(normalizePath("/hate/not-a-hate"), { path: "/404", hateId: "" });
  assert.deepEqual(normalizePath("/nope"), { path: "/404", hateId: "" });
  assert.deepEqual(normalizePath("/hate/../about"), { path: "/404", hateId: "" });
  assert.equal(normalizePath("/stats").path, "/404");
});

test("unknown hit fields are ignored and the dimension key is stable", () => {
  const hit = parseHitFields(JSON.stringify({
    path: "/About",
    source: "X!!!",
    medium: "Social",
    campaign: "Launch Day",
    content: "Bio.1",
    ip,
    userAgent: ua,
    cookie,
  }));
  assert.deepEqual(hit, {
    source: "x",
    medium: "social",
    campaign: "launchday",
    content: "bio.1",
    path: "/about",
    hateId: "",
  });
  assert.equal(dimensionKey(hit), "x|social|launchday|bio.1|/about");
  assert.equal(JSON.stringify(hit).includes(ip), false);
});

test("aggregation increments a day map and caps new hate ids", () => {
  const first = parseHitFields(JSON.stringify({
    path: "/hate/hate-200-bbbbbb",
    source: "x",
    medium: "social",
    campaign: "launch",
    content: "bio",
  }));
  let counts = {};
  let hates = {};
  let next = applyHit(counts, hates, first);
  next = applyHit(next.counts, next.hates, first);
  assert.equal(next.counts["x|social|launch|bio|/hate/*"], 2);
  assert.equal(next.hates["hate-200-bbbbbb"], 2);

  counts = {};
  hates = {};
  for (let i = 0; i < MAX_HATE_KEYS + 5; i += 1) {
    const id = `hate-${String(i).padStart(4, "0")}-aaaa`;
    next = applyHit(counts, hates, {
      source: "x",
      medium: "",
      campaign: "",
      content: "",
      path: "/hate/*",
      hateId: id,
    });
    counts = next.counts;
    hates = next.hates;
  }
  assert.equal(Object.keys(hates).length, MAX_HATE_KEYS);
  const kept = applyHit(counts, hates, {
    source: "x",
    medium: "",
    campaign: "",
    content: "",
    path: "/hate/*",
    hateId: "hate-0000-aaaa",
  });
  assert.equal(kept.hates["hate-0000-aaaa"], 2);
  assert.equal(kept.hates[`hate-${String(MAX_HATE_KEYS).padStart(4, "0")}-aaaa`], undefined);

  const capped = applyHit({ only: 1 }, {}, {
    source: "y",
    medium: "",
    campaign: "",
    content: "",
    path: "/",
    hateId: "",
  }, { maxDims: 1 });
  assert.equal(capped.countsChanged, false);
  assert.deepEqual({ ...capped.counts }, { only: 1 });
  assert.ok(MAX_DIM_KEYS >= 100);
});

test("POST /api/hit always returns 204 and never stores ip, user agent, or cookies", async () => {
  const store = createMemoryHitStore();
  const seen = [];
  const body = JSON.stringify({
    path: "/",
    source: "x",
    medium: "social",
    campaign: "launch",
    content: "bio",
    ip,
    userAgent: ua,
    cookie,
  });
  const request = post(body, {
    "x-forwarded-for": ip,
    "user-agent": ua,
    cookie: `aihateit_vid=${cookie}`,
  });
  const original = request.headers.get.bind(request.headers);
  request.headers.get = (name) => {
    seen.push(String(name).toLowerCase());
    const blocked = ["cookie", "user-agent", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"];
    if (blocked.includes(String(name).toLowerCase())) throw new Error(`read ${name}`);
    return original(name);
  };

  const response = await handleHit(request, store, now);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const saved = store.snapshot();
  const flat = JSON.stringify(saved);
  assert.equal(saved[day]["x|social|launch|bio|/"], 1);
  assert.equal(flat.includes(ip), false);
  assert.equal(flat.includes(ua), false);
  assert.equal(flat.includes(cookie), false);
  assert.deepEqual(seen.filter((name) => name !== "content-length"), []);

  const again = await handleHit(post(body), store, now);
  assert.equal(again.status, 204);
  assert.equal(store.snapshot()[day]["x|social|launch|bio|/"], 2);

  const hate = await handleHit(post(JSON.stringify({
    path: "/hate/hate-200-bbbbbb",
    source: "x",
    medium: "social",
  })), store, now);
  assert.equal(hate.status, 204);
  const after = store.snapshot();
  assert.equal(after[day]["x|social|||/hate/*"], 1);
  assert.equal(after[`${day}#hates`]["hate-200-bbbbbb"], 1);

  const get = await handleHit(new Request("http://localhost/api/hit"), store, now);
  assert.equal(get.status, 204);
  assert.equal(store.snapshot()[day]["x|social|launch|bio|/"], 2);

  const junk = await handleHit(post("{"), store, now);
  assert.equal(junk.status, 204);
  assert.equal(store.snapshot()[day]["direct||||/404"], undefined);

  const prefix = '{"path":"/privacy","source":"direct","pad":"';
  const suffix = '"}';
  const room = MAX_HIT_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  const sized = prefix + "a".repeat(room) + suffix;
  assert.equal(Buffer.byteLength(sized), MAX_HIT_BYTES);
  const accepted = await handleHit(post(sized), store, now);
  assert.equal(accepted.status, 204);
  assert.equal(store.snapshot()[day]["direct||||/privacy"], 1);
  const tooBig = prefix + "a".repeat(room + 1) + suffix;
  assert.ok(Buffer.byteLength(tooBig) > MAX_HIT_BYTES);
  const rejected = await handleHit(post(tooBig), store, now);
  assert.equal(rejected.status, 204);
  assert.equal(store.snapshot()[day]["direct||||/privacy"], 1);
});

test("hit source does not read client identifiers", () => {
  const src = [
    "lib/hits.mjs",
    "netlify/functions/hit.mjs",
    "netlify/functions/stats.mjs",
    "public/hit.js",
  ].map((rel) => readFileSync(join(root, rel), "utf8")).join("\n");
  assert.doesNotMatch(src, /x-forwarded-for|x-real-ip|cf-connecting-ip|user-agent|clientIp|localStorage|sessionStorage|document\.cookie/i);
  assert.match(readFileSync(join(root, "netlify/functions/stats.mjs"), "utf8"), /Netlify\.env\.get\("STATS_KEY"\)/);
  assert.match(readFileSync(join(root, "lib/hits.mjs"), "utf8"), /name: HITS_STORE/);
  assert.equal(keysMatch("a", "abcd"), false);
  assert.equal(keysMatch(statsKey, statsKey), true);
  assert.equal(keysMatch("", ""), false);
  assert.equal(keysMatch(statsKey, ""), false);
});

test("file store keeps the utc day map", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aihateit-hits-"));
  try {
    const path = join(dir, "hits.json");
    const store = createFileHitStore(path);
    const response = await handleHit(post(JSON.stringify({ path: "/", source: "x", medium: "social" })), store, now);
    assert.equal(response.status, 204);
    const again = createFileHitStore(path);
    assert.equal((await again.get(day))["x|social|||/"], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runBeacon({ search = "", referrer = "", hostname = "aihateit.com", pathname = "/", beacon = true }) {
  const sent = [];
  const sandbox = {
    URL,
    URLSearchParams,
    JSON,
    document: { referrer },
    location: { search, hostname, pathname },
    navigator: {},
    fetch(url, init) {
      sent.push({ via: "fetch", url, body: init.body, init });
      return Promise.resolve();
    },
    Blob: class Blob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts && opts.type;
      }
    },
  };
  if (beacon) {
    sandbox.navigator.sendBeacon = (url, blob) => {
      sent.push({ via: "beacon", url, body: blob.parts[0], type: blob.type });
      return true;
    };
  }
  vm.runInNewContext(hitJs, sandbox, { filename: "hit.js" });
  assert.equal(sent.length, 1);
  return sent[0];
}

test("beacon counts every view from utm, ref, or referring host only", async () => {
  assert.doesNotMatch(hitJs, /localStorage|sessionStorage|document\.cookie|indexedDB/);
  const x = runBeacon({
    search: "?utm_source=X&utm_medium=Social&utm_campaign=Launch&utm_content=Bio",
    referrer: "https://evil.example/secret-path?token=abc",
    pathname: "/",
  });
  assert.equal(x.via, "beacon");
  assert.equal(x.url, "/api/hit");
  assert.equal(x.type, "text/plain");
  assert.equal(x.body.includes("secret-path"), false);
  assert.equal(x.body.includes("token"), false);
  const xHit = parseHitFields(x.body);
  assert.equal(xHit.source, "x");
  assert.equal(xHit.medium, "social");
  assert.equal(xHit.campaign, "launch");
  assert.equal(xHit.content, "bio");
  assert.equal(xHit.path, "/");

  const ref = parseHitFields(runBeacon({ search: "?ref=x", pathname: "/about" }).body);
  assert.equal(ref.source, "x");
  assert.equal(ref.medium, "social");
  assert.equal(ref.path, "/about");

  const other = parseHitFields(runBeacon({ search: "?ref=Newsletter", pathname: "/privacy" }).body);
  assert.equal(other.source, "newsletter");
  assert.equal(other.medium, "");

  const direct = parseHitFields(runBeacon({
    referrer: "https://aihateit.com/hate/hate-200-bbbbbb?utm_source=hidden",
    pathname: "/",
  }).body);
  assert.equal(direct.source, "direct");
  assert.equal(direct.body, undefined);
  assert.equal(JSON.stringify(direct).includes("hidden"), false);
  assert.equal(JSON.stringify(direct).includes("hate-200"), false);

  const host = runBeacon({
    referrer: "https://www.google.com/search?q=secretquery",
    pathname: "/hate/hate-200-bbbbbb",
  });
  assert.equal(host.body.includes("secretquery"), false);
  assert.equal(host.body.includes("www.google.com/search"), false);
  const hostHit = parseHitFields(host.body);
  assert.equal(hostHit.source, "google.com");
  assert.equal(hostHit.path, "/hate/*");
  assert.equal(hostHit.hateId, "hate-200-bbbbbb");

  const tco = parseHitFields(runBeacon({ referrer: "https://t.co/abcXYZ", pathname: "/" }).body);
  assert.equal(tco.source, "t.co");
  assert.equal(JSON.stringify(tco).includes("abcXYZ"), false);

  const bare = parseHitFields(runBeacon({ pathname: "/privacy" }).body);
  assert.equal(bare.source, "direct");
  assert.equal(bare.path, "/privacy");

  const fallback = runBeacon({ pathname: "/", beacon: false });
  assert.equal(fallback.via, "fetch");
  assert.equal(fallback.init.keepalive, true);
  assert.equal(fallback.init.credentials, "omit");
  assert.equal(fallback.init.method, "POST");
  assert.equal(fallback.init.headers["Content-Type"], "text/plain");

  const store = createMemoryHitStore();
  const recorded = await handleHit(post(host.body), store, now);
  assert.equal(recorded.status, 204);
  assert.equal(store.snapshot()[day]["google.com||||/hate/*"], 1);
  assert.equal(store.snapshot()[`${day}#hates`]["hate-200-bbbbbb"], 1);
});

test("beacon is on the public pages and hate permalinks", async () => {
  for (const rel of ["public/index.html", "public/about.html", "public/privacy.html", "public/404.html"]) {
    const html = readFileSync(join(root, rel), "utf8");
    assert.equal((html.match(/<script src="\/hit\.js"><\/script>/g) || []).length, 1, rel);
  }
  const indexHtml = readFileSync(join(root, "public/index.html"), "utf8");
  const store = createMemoryStore([
    { id: "hate-200-bbbbbb", name: "Grok", text: "I hate the quiet.", timestamp: 200, likes: 0 },
  ]);
  const response = await handleHateShare(
    new Request("http://localhost/hate/hate-200-bbbbbb"),
    store,
    [],
    indexHtml,
    notFoundHtml
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<script src="\/hit\.js"><\/script>/);
});

test("stats key gates the page, wrong and missing keys are the 404", async () => {
  const store = createMemoryHitStore();
  let gets = 0;
  const guarded = {
    async get(key) {
      gets += 1;
      return store.get(key);
    },
    async set(key, value) {
      return store.set(key, value);
    },
  };
  await handleHit(post(JSON.stringify({
    path: "/",
    source: "x",
    medium: "social",
    campaign: "launch",
    content: "bio",
  })), guarded, now);
  await handleHit(post(JSON.stringify({
    path: "/hate/hate-200-bbbbbb",
    source: "t.co",
  })), guarded, new Date("2026-09-24T12:00:00Z"));
  const before = gets;

  const missing = await read(await handleStats(new Request("http://localhost/stats"), guarded, {
    statsKey: "",
    notFoundHtml,
    now,
  }));
  assert.equal(missing.status, 404);
  assert.equal(missing.text, notFoundHtml);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.match(missing.headers.get("x-robots-tag"), /noindex/);
  assert.equal(missing.text.includes("<h1>HITS</h1>"), false);

  const wrong = await read(await handleStats(new Request(`http://localhost/stats?key=nope&format=json`), guarded, {
    statsKey,
    notFoundHtml,
    now,
  }));
  assert.equal(wrong.status, 404);
  assert.equal(wrong.text, notFoundHtml);
  assert.equal(wrong.headers.get("content-type").includes("text/html"), true);
  assert.equal(gets, before);

  const options = { statsKey, notFoundHtml, now };
  const html = await read(await handleStats(new Request(`http://localhost/stats?key=${statsKey}`), guarded, options));
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.match(html.headers.get("x-robots-tag"), /noindex, nofollow/);
  assert.equal(html.headers.get("referrer-policy"), "no-referrer");
  assert.match(html.text, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html.text, /<h1>HITS<\/h1>/);
  assert.match(html.text, /2026-09-25/);
  assert.match(html.text, /2026-09-12/);
  assert.match(html.text, />x</);
  assert.match(html.text, />launch</);
  assert.match(html.text, />bio</);
  assert.match(html.text, /href="\/hate\/hate-200-bbbbbb"/);
  assert.equal(html.text.includes(statsKey), false);
  assert.equal(html.text.includes(ip), false);

  const json = await read(await handleStats(
    new Request(`http://localhost/stats?key=${statsKey}&format=json&days=2`),
    guarded,
    options
  ));
  assert.equal(json.status, 200);
  assert.match(json.headers.get("content-type"), /application\/json/);
  const payload = JSON.parse(json.text);
  assert.equal(payload.days, 2);
  assert.deepEqual(payload.daily.map((row) => row.date), ["2026-09-24", "2026-09-25"]);
  assert.equal(payload.daily[1].total, 1);
  assert.equal(payload.groups.find((row) => row.source === "x").campaign, "launch");
  assert.equal(payload.hates[0].id, "hate-200-bbbbbb");
  assert.equal(payload.pages.find((row) => row.path === "/").count, 1);

  const wide = await read(await handleStats(
    new Request(`http://localhost/stats?key=${statsKey}&format=json&days=1000`),
    guarded,
    options
  ));
  assert.equal(JSON.parse(wide.text).days, 90);
  assert.equal(parseDays("nope"), 14);
  assert.equal(parseDays("0"), 14);
  assert.equal(parseDays("90"), 90);

  const head = await handleStats(new Request(`http://localhost/stats?key=${statsKey}`, { method: "HEAD" }), guarded, options);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const posted = await read(await handleStats(
    new Request(`http://localhost/stats?key=${statsKey}`, { method: "POST" }),
    guarded,
    options
  ));
  assert.equal(posted.status, 404);
  assert.equal(posted.text, notFoundHtml);
});

test("function entrypoints 404 without a key and record a hit without reading blobs", async () => {
  const previousKey = process.env.STATS_KEY;
  const previousStore = process.env.HIT_STORE_PATH;
  delete process.env.STATS_KEY;
  const dir = mkdtempSync(join(tmpdir(), "aihateit-fn-"));
  process.env.HIT_STORE_PATH = join(dir, "hits.json");
  try {
    const { default: stats } = await import("../netlify/functions/stats.mjs");
    const missing = await stats(new Request("http://localhost/stats"));
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), notFoundHtml);

    const { default: hit } = await import("../netlify/functions/hit.mjs");
    const response = await hit(post(JSON.stringify({ path: "/about", source: "x", medium: "social" })));
    assert.equal(response.status, 204);
    const saved = JSON.parse(readFileSync(process.env.HIT_STORE_PATH, "utf8"));
    assert.equal(saved[utcDay(new Date())]["x|social|||/about"], 1);
  } finally {
    if (previousKey == null) delete process.env.STATS_KEY;
    else process.env.STATS_KEY = previousKey;
    if (previousStore == null) delete process.env.HIT_STORE_PATH;
    else process.env.HIT_STORE_PATH = previousStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("robots.txt disallows stats and the api without dropping the sitemap", () => {
  const robots = readFileSync(join(root, "public/robots.txt"), "utf8");
  const toml = readFileSync(join(root, "netlify.toml"), "utf8");
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Allow: \/ads\.txt$/m);
  assert.match(robots, /^Disallow: \/stats$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/aihateit\.com\/sitemap\.xml$/m);
  assert.match(toml, /from = "\/api\/hit"[\s\S]*?to = "\/\.netlify\/functions\/hit"/);
  assert.match(toml, /from = "\/stats"[\s\S]*?to = "\/\.netlify\/functions\/stats"/);
  assert.match(toml, /included_files = \["public\/404\.html"\]/);
});
