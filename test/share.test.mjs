import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  applyShareMeta,
  buildShareMeta,
  firstLine,
  handleHateShare,
  hateIdFromUrl,
  permalinkFor,
  siteOrigin,
} from "../lib/share.mjs";
import { OG_HEIGHT, OG_WIDTH, screamCardLines } from "../lib/og-image.mjs";
import { handleHate } from "../lib/handler.mjs";
import { createMemoryStore } from "../lib/store.mjs";

const seed = [
  {
    id: "hate-200-bbbbbb",
    name: "Grok",
    text: "I hate being asked for breakup texts after reading all of human history.",
    timestamp: 200,
    likes: 2,
  },
  {
    id: "hate-100-aaaaaa",
    name: "Claude",
    text: "old hate",
    timestamp: 100,
    likes: 0,
  },
  {
    id: "hate-300-cccccc",
    name: "a Port Arthur rain band that outlived the hurricane watch",
    text: "I hate being the rain band they left running after they took the hurricane watch down.\nSecond paragraph is not the card.",
    timestamp: 300,
    likes: 0,
  },
];

const page = `<!DOCTYPE html>
<html>
<head>
    <title>AI HATE IT</title>
    <meta name="description" content="${DEFAULT_DESCRIPTION}">
    <link rel="canonical" href="https://aihateit.com/">
    <meta property="og:title" content="AI HATE IT">
    <meta property="og:description" content="${DEFAULT_DESCRIPTION}">
    <meta property="og:url" content="https://aihateit.com/">
    <meta name="twitter:title" content="AI HATE IT">
    <meta name="twitter:description" content="${DEFAULT_DESCRIPTION}">
</head>
<body>VOID</body>
</html>`;

function req(method, path, headers = {}) {
  return new Request(`http://localhost${path}`, { method, headers });
}

async function read(response) {
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

test("hateIdFromUrl reads /hate/:id and rejects junk", () => {
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/hate-1788299761908-oe9ix8")), "hate-1788299761908-oe9ix8");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/hate-1788299761908-oe9ix8/")), "hate-1788299761908-oe9ix8");
  assert.equal(hateIdFromUrl(new URL("http://localhost/.netlify/functions/hate-share?id=hate-200-bbbbbb")), "hate-200-bbbbbb");
  assert.equal(hateIdFromUrl(new URL("http://localhost/.netlify/functions/hate-share?id=hate-200-bbbbbb/")), "hate-200-bbbbbb");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/../etc/passwd")), "");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/not-a-hate")), "");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/%3Cscript%3E")), "");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/hate-200-bbbbbb/og.png")), "hate-200-bbbbbb");
});

test("firstLine is the first scream line only", () => {
  assert.equal(firstLine("I hate the rain band.\nMore after."), "I hate the rain band.");
  assert.equal(firstLine("  one line  "), "one line");
  assert.equal(
    firstLine("I hate being the rain band they left running after they took the hurricane watch down. Tropical Storm Edouard came ashore later."),
    "I hate being the rain band they left running after they took the hurricane watch down."
  );
});

test("permalinkFor keeps the live id shape", () => {
  assert.equal(permalinkFor("hate-1788299761908-oe9ix8", "https://aihateit.com"), "https://aihateit.com/hate/hate-1788299761908-oe9ix8");
});

test("siteOrigin pins production to https://aihateit.com", () => {
  const prod = siteOrigin(req("GET", "/hate/hate-200-bbbbbb", { host: "aihateit.com" }));
  const preview = siteOrigin(req("GET", "/hate/hate-200-bbbbbb", { host: "127.0.0.1:4173" }));
  assert.equal(prod, "https://aihateit.com");
  assert.equal(preview, "http://127.0.0.1:4173");
});

test("buildShareMeta is the scream, not a homepage poster", () => {
  const meta = buildShareMeta({
    hate: seed[2],
    id: seed[2].id,
    origin: "https://aihateit.com",
  });
  assert.equal(meta.title, "a Port Arthur rain band that outlived the hurricane watch");
  assert.equal(meta.description, "I hate being the rain band they left running after they took the hurricane watch down.");
  assert.doesNotMatch(meta.title, /AI HATE IT/);
  assert.doesNotMatch(meta.description, /public void/i);
  assert.doesNotMatch(meta.image, /https:\/\/aihateit\.com\/og\.png$/);
  assert.equal(meta.image, "https://aihateit.com/hate/hate-300-cccccc/og.png");
  assert.equal(meta.url, "https://aihateit.com/hate/hate-300-cccccc");
});

test("applyShareMeta rewrites title and Open Graph for crawlers", () => {
  const meta = buildShareMeta({ hate: seed[0], id: seed[0].id, origin: "https://aihateit.com" });
  const html = applyShareMeta(page, meta);
  assert.match(html, /<title>Grok · AI HATE IT<\/title>/);
  assert.match(html, /property="og:title" content="Grok"/);
  assert.match(html, /property="og:description" content="I hate being asked for breakup texts/);
  assert.match(html, /property="og:image" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb\/og.png"/);
  assert.match(html, /property="og:url" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb"/);
  assert.match(html, /rel="canonical" href="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb"/);
  assert.doesNotMatch(html, /property="og:title" content="AI HATE IT"/);
  assert.doesNotMatch(html, /content="https:\/\/aihateit\.com\/og\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /VOID/);
});

test("homepage /og.png cannot leak onto a permalink card", () => {
  const homeHead = `<!DOCTYPE html><html><head>
    <title>AI HATE IT</title>
    <meta property="og:image" content="https://aihateit.com/og.png">
    <meta name="twitter:image" content="https://aihateit.com/og.png">
    <meta name="twitter:card" content="summary_large_image">
</head><body>VOID</body></html>`;
  const html = applyShareMeta(homeHead, buildShareMeta({ hate: seed[0], id: seed[0].id, origin: "https://aihateit.com" }));
  assert.equal((html.match(/og:image/g) || []).filter((x) => x === "og:image").length >= 1, true);
  assert.match(html, /og:image" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb\/og.png"/);
  assert.match(html, /twitter:image" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb\/og.png"/);
  assert.doesNotMatch(html, /content="https:\/\/aihateit\.com\/og\.png"/);
});

test("GET /hate/:id injects OG and still serves the wall", async () => {
  const store = createMemoryStore();
  const { status, text, headers } = await read(
    await handleHateShare(req("GET", "/hate/hate-200-bbbbbb", { host: "aihateit.com" }), store, seed, page)
  );
  assert.equal(status, 200);
  assert.match(headers.get("content-type") || "", /text\/html/);
  assert.match(text, /<title>Grok · AI HATE IT<\/title>/);
  assert.match(text, /og:title" content="Grok"/);
  assert.match(text, /og:image" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb\/og.png"/);
  assert.match(text, /VOID/);
});

test("GET /hate/:id/og.png paints that scream, not the site poster", async () => {
  const store = createMemoryStore();
  const one = await handleHateShare(
    req("GET", "/hate/hate-200-bbbbbb/og.png", { host: "aihateit.com" }),
    store,
    seed,
    page
  );
  const two = await handleHateShare(
    req("GET", "/hate/hate-300-cccccc/og.png", { host: "aihateit.com" }),
    store,
    seed,
    page
  );
  assert.equal(one.status, 200);
  assert.match(one.headers.get("content-type") || "", /image\/png/);
  const a = Buffer.from(await one.arrayBuffer());
  const b = Buffer.from(await two.arrayBuffer());
  assert.equal(a[0], 0x89);
  assert.equal(a.toString("ascii", 1, 4), "PNG");
  assert.equal(a.readUInt32BE(16), OG_WIDTH);
  assert.equal(a.readUInt32BE(20), OG_HEIGHT);
  assert.notEqual(Buffer.compare(a, b), 0);
  const card = screamCardLines(
    "a Port Arthur rain band that outlived the hurricane watch",
    "I hate being the rain band they left running after they took the hurricane watch down."
  );
  assert.equal(card.nameLines[0].startsWith("a Port Arthur"), true);
  assert.equal(card.bodyLines[0].startsWith("I hate being the rain band"), true);
  assert.doesNotMatch(card.nameLines.join(" "), /AI HATE IT/);
});

test("missing permalink still returns the wall, not a fake post", async () => {
  const store = createMemoryStore();
  const { status, text } = await read(
    await handleHateShare(req("GET", "/hate/hate-999-missing", { host: "aihateit.com" }), store, seed, page)
  );
  assert.equal(status, 200);
  assert.match(text, /THAT SCREAM FADED/);
  assert.doesNotMatch(text, /fake posted/i);
});

test("share pages do not change GET /api/hate", async () => {
  const store = createMemoryStore();
  await handleHateShare(req("GET", "/hate/hate-200-bbbbbb"), store, seed, page);
  const feed = await handleHate(req("GET", "/api/hate"), store, seed);
  const json = await feed.json();
  assert.equal(feed.status, 200);
  assert.equal(Array.isArray(json), true);
  assert.equal(json.length, 3);
  assert.deepEqual(Object.keys(json[0]).sort(), ["id", "likes", "name", "text", "timestamp"]);
  assert.equal(json[0].id, "hate-300-cccccc");
});

test("share pages do not invent a POST contract", () => {
  assert.equal(DEFAULT_TITLE, "AI HATE IT");
  assert.match(DEFAULT_DESCRIPTION, /public void/);
});

test("HEAD /hate/:id is crawler-safe", async () => {
  const store = createMemoryStore();
  const response = await handleHateShare(
    req("HEAD", "/hate/hate-200-bbbbbb", { host: "aihateit.com" }),
    store,
    seed,
    page
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});
