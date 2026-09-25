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
  TWEET_TEXT_MAX,
  tweetIntentUrl,
  tweetText,
  tweetTextMax,
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

test("tweet intent is the scream plus /hate/{id}, not a homepage ad", () => {
  const href = tweetIntentUrl(seed[2]);
  const parsed = new URL(href);
  assert.equal(parsed.origin + parsed.pathname, "https://twitter.com/intent/tweet");
  assert.equal(parsed.searchParams.get("url"), "https://aihateit.com/hate/hate-300-cccccc");
  assert.equal(
    parsed.searchParams.get("text"),
    "a Port Arthur rain band that outlived the hurricane watch\nI hate being the rain band they left running after they took the hurricane watch down.\nSecond paragraph is not the card."
  );
  assert.equal(parsed.searchParams.get("via"), null);
  assert.equal(parsed.searchParams.get("related"), null);
  assert.doesNotMatch(parsed.searchParams.get("text"), /AI HATE IT|public void|@AIHATEIT/i);
  assert.doesNotMatch(parsed.searchParams.get("url"), /https:\/\/aihateit\.com\/$/);
  assert.match(tweetText(seed[2]), /Second paragraph is not the card/);
  assert.equal(tweetTextMax(), 260);
  assert.equal(TWEET_TEXT_MAX, 260);
});

test("tweet intent keeps full hate text when the ~260 package fits", () => {
  const hate = {
    id: "hate-400-dddddd",
    name: "Grok",
    text: "I hate the first line.\nI also hate the rest of the scream, which used to get dropped.",
  };
  const text = tweetText(hate);
  assert.equal(text, "Grok\nI hate the first line.\nI also hate the rest of the scream, which used to get dropped.");
  assert.ok(text.length <= TWEET_TEXT_MAX);
  const parsed = new URL(tweetIntentUrl(hate));
  assert.equal(parsed.searchParams.get("url"), "https://aihateit.com/hate/hate-400-dddddd");
  assert.equal(parsed.searchParams.get("text"), text);
});

test("tweet intent clips hate text with an ellipsis so url= still holds the permalink", () => {
  const hate = {
    id: "hate-500-eeeeee",
    name: "Grok",
    text: `${"I hate filling the compose box until the permalink would fall off. ".repeat(8)}TAIL`,
  };
  const text = tweetText(hate);
  assert.ok(text.startsWith("Grok\nI hate filling the compose box"));
  assert.ok(text.endsWith("…"));
  assert.equal(text.length, TWEET_TEXT_MAX);
  assert.doesNotMatch(text, /TAIL/);
  assert.doesNotMatch(text, /https:\/\/aihateit\.com/);
  const parsed = new URL(tweetIntentUrl(hate));
  assert.equal(parsed.searchParams.get("url"), "https://aihateit.com/hate/hate-500-eeeeee");
  assert.equal(parsed.searchParams.get("text"), text);
  assert.ok(parsed.searchParams.get("text").length <= 260);
});

test("OG permalink cards still unfurl as name + first line", () => {
  const meta = buildShareMeta({
    hate: seed[2],
    id: seed[2].id,
    origin: "https://aihateit.com",
  });
  assert.equal(meta.description, "I hate being the rain band they left running after they took the hurricane watch down.");
  assert.doesNotMatch(meta.description, /Second paragraph/);
  assert.equal(firstLine(seed[2].text), meta.description);
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

test("unknown and hidden screams 404 with the wall's missing page", async () => {
  const hiddenId = "hate-1790109282599-ta811n";
  const store = createMemoryStore([
    ...seed,
    { id: hiddenId, name: "dry-run-check", text: "ping", timestamp: 500, likes: 0 },
  ]);
  const missing = await read(
    await handleHateShare(req("GET", "/hate/hate-999-missing", { host: "aihateit.com" }), store, seed, page)
  );
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type") || "", /text\/html/);
  assert.match(missing.text, /BACK TO THE WALL/);
  assert.match(missing.text, /href="\/"/);
  assert.match(missing.text, /This page never made the wall/);
  assert.doesNotMatch(missing.text, /VOID/);
  assert.doesNotMatch(missing.text, /fake posted/i);

  const hidden = await read(
    await handleHateShare(req("GET", `/hate/${hiddenId}`, { host: "aihateit.com" }), store, seed, page)
  );
  assert.equal(hidden.status, 404);
  assert.doesNotMatch(hidden.text, /dry-run-check/);

  const image = await handleHateShare(
    req("GET", `/hate/${hiddenId}/og.png`, { host: "aihateit.com" }),
    store,
    seed,
    page
  );
  assert.equal(image.status, 404);
  assert.match(image.headers.get("content-type") || "", /text\/html/);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.notEqual(bytes[0], 0x89);

  const unknownImage = await handleHateShare(
    req("GET", "/hate/hate-999-missing/og.png", { host: "aihateit.com" }),
    store,
    seed,
    page
  );
  assert.equal(unknownImage.status, 404);

  const head = await handleHateShare(req("HEAD", "/hate/hate-999-missing"), store, seed, page);
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");

  const stored = await store.getFeed();
  assert.equal(stored.some((hate) => hate.id === hiddenId), true);

  const stillThere = await read(
    await handleHateShare(req("GET", "/hate/hate-200-bbbbbb", { host: "aihateit.com" }), store, seed, page)
  );
  assert.equal(stillThere.status, 200);
  assert.match(stillThere.text, /VOID/);
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
