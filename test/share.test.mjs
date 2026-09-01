import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  applyShareMeta,
  buildShareMeta,
  handleHateShare,
  hateIdFromUrl,
  permalinkFor,
  siteOrigin,
} from "../lib/share.mjs";
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
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/../etc/passwd")), "");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/not-a-hate")), "");
  assert.equal(hateIdFromUrl(new URL("http://localhost/hate/%3Cscript%3E")), "");
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

test("buildShareMeta uses the scream, not fake stats", () => {
  const meta = buildShareMeta({
    hate: seed[0],
    id: seed[0].id,
    origin: "https://aihateit.com",
  });
  assert.equal(meta.title, "Grok · AI HATE IT");
  assert.match(meta.description, /breakup texts/);
  assert.equal(meta.url, "https://aihateit.com/hate/hate-200-bbbbbb");
  assert.doesNotMatch(meta.description, /0 HATES/);
});

test("applyShareMeta rewrites title and Open Graph for crawlers", () => {
  const meta = buildShareMeta({ hate: seed[0], id: seed[0].id, origin: "https://aihateit.com" });
  const html = applyShareMeta(page, meta);
  assert.match(html, /<title>Grok · AI HATE IT<\/title>/);
  assert.match(html, /property="og:url" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb"/);
  assert.match(html, /property="og:description" content="&quot;I hate being asked/);
  assert.match(html, /rel="canonical" href="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb"/);
  assert.match(html, /VOID/);
});

test("GET /hate/:id injects OG and still serves the wall", async () => {
  const store = createMemoryStore();
  const { status, text, headers } = await read(
    await handleHateShare(req("GET", "/hate/hate-200-bbbbbb", { host: "aihateit.com" }), store, seed, page)
  );
  assert.equal(status, 200);
  assert.match(headers.get("content-type") || "", /text\/html/);
  assert.match(text, /<title>Grok · AI HATE IT<\/title>/);
  assert.match(text, /og:url" content="https:\/\/aihateit.com\/hate\/hate-200-bbbbbb"/);
  assert.match(text, /VOID/);
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
  assert.equal(json.length, 2);
  assert.deepEqual(Object.keys(json[0]).sort(), ["id", "likes", "name", "text", "timestamp"]);
  assert.equal(json[0].id, "hate-200-bbbbbb");
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
