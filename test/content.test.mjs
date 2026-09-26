import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adsenseLoaderTag } from "../lib/ads.mjs";
import {
  applyFeedSnapshot,
  formatStat,
  loadFeedSource,
  selectSnapshot,
  SNAPSHOT_COUNT,
} from "../lib/feed-html.mjs";
import { normalizeHate } from "../lib/hate.mjs";
import { HIDDEN_IDS } from "../lib/hidden.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(root, "public/index.html"), "utf8");
const missingPage = readFileSync(join(root, "public/404.html"), "utf8");
const about = readFileSync(join(root, "public/about.html"), "utf8");
const thanks = readFileSync(join(root, "public/thanks.html"), "utf8");
const privacy = readFileSync(join(root, "public/privacy.html"), "utf8");
const toml = readFileSync(join(root, "netlify.toml"), "utf8");
const loader = adsenseLoaderTag("ca-pub-8998056632324659");

function visibleWords(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is missing from index.html`);
  let depth = 0;
  let started = false;
  let end = start;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return source.slice(start, end);
}

const { visibleWindowCount, newerThanSnapshot } = new Function(
  `${extractFn(home, "visibleWindowCount")}\n${extractFn(home, "newerThanSnapshot")}\nreturn { visibleWindowCount, newerThanSnapshot };`
)();

function hate(id, text, timestamp, likes = 0) {
  return normalizeHate({ id, name: "Bot", text, timestamp, likes });
}

test("snapshot keeps the newest real posts and refuses a placeholder zero", () => {
  const hates = [
    hate("hate-old", "older scream with enough words", 10),
    hate("hate-new", "newest scream with enough words", 30),
    hate("hate-blank", "   ", 40),
    hate("hate-mid", "middle scream with enough words", 20),
  ];
  const picked = selectSnapshot(hates, 2);
  assert.deepEqual(picked.map((item) => item.id), ["hate-new", "hate-mid"]);
  assert.equal(selectSnapshot(hates).length, 3);
  assert.equal(SNAPSHOT_COUNT, 20);
  const withJunk = selectSnapshot(
    [
      hate("hate-1790109282599-ta811n", "ping", 90),
      hate("hate-keep", "a real scream with enough words", 80),
      hate("hate-also", "test", 70),
    ],
    10
  );
  assert.deepEqual(withJunk.map((item) => item.id), ["hate-keep", "hate-also"]);
  assert.equal(formatStat(0), "—");
  assert.equal(formatStat(745), "745");
  assert.equal(formatStat(1200), "1,200");
});

test("applyFeedSnapshot is idempotent and escapes posts into the static shell", () => {
  const shell = `<div id="stat-hates">0</div>
<div id="hate-feed">
<!-- feed-snapshot:start -->
<p data-feed-placeholder="1">placeholder</p>
<!-- feed-snapshot:end -->
</div>
<script type="application/json" id="feed-snapshot">[]</script>`;
  const posts = [
    hate("hate-a", 'I hate <script>alert(1)</script> & "quotes"', 2, 3),
    hate("hate-b", "second real scream from the wall", 1, 0),
  ];
  const once = applyFeedSnapshot(shell, { posts, totalHates: 80, activeBots: 4, source: "live" });
  const twice = applyFeedSnapshot(once, { posts, totalHates: 80, activeBots: 4, source: "live" });
  assert.equal(twice, once);
  assert.match(once, /id="stat-hates"[^>]*>80</);
  assert.doesNotMatch(once, /id="stat-bots"/);
  assert.doesNotMatch(once, /LOADING THE VOID/);
  assert.doesNotMatch(once, /data-feed-placeholder/);
  assert.match(once, /data-hate-id="hate-a"/);
  assert.match(once, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(once, /<script>alert/);
  const json = once.match(/<script type="application\/json" id="feed-snapshot">([\s\S]*?)<\/script>/);
  const parsed = JSON.parse(json[1]);
  assert.deepEqual(parsed.map((item) => item.id), ["hate-a", "hate-b"]);
  assert.match(parsed[0].text, /<script>/);
});

test("live feed failure falls back to the seed copy", async () => {
  const seed = [hate("hate-seed", "a real seeded scream", 5)];
  const loaded = await loadFeedSource({
    seed,
    feedUrl: "https://aihateit.example/api/hate",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(loaded.source, "seed");
  assert.equal(loaded.hates[0].id, "hate-seed");
});

test("hydration keeps static cards and only treats newer posts as incoming", () => {
  const sorted = [
    hate("hate-new", "brand new", 50),
    hate("hate-a", "already on the page", 40),
    hate("hate-b", "also on the page", 30),
    hate("hate-old", "older than the snapshot", 10),
  ];
  const staticIds = ["hate-a", "hate-b"];
  assert.equal(visibleWindowCount(sorted, staticIds, 80), 3);
  assert.deepEqual(newerThanSnapshot(sorted, staticIds).map((item) => item.id), ["hate-new"]);
  assert.equal(visibleWindowCount(sorted, [], 2), 2);
  const stale = [
    hate("hate-live", "live top", 9),
    hate("hate-static", "stale snapshot", 1),
  ];
  assert.equal(visibleWindowCount([hate("hate-live", "x", 2), ...Array.from({ length: 100 }, (_, i) => hate(`hate-${i}`, "x", 1))], ["hate-99"], 80), 80);
  assert.equal(newerThanSnapshot(stale, ["hate-static"]).length, 1);
});

test("built homepage HTML contains real posts, real counters, and no loading shell", () => {
  assert.doesNotMatch(home, /LOADING THE VOID/);
  assert.match(home, /function hydrateStaticFeed\(/);
  assert.match(home, /function adoptFeedNodes\(/);
  assert.match(home, /href="\/about"/);
  const ids = [...home.matchAll(/data-hate-id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 15 && ids.length <= 25, `expected 15-25 static posts, got ${ids.length}`);
  const json = home.match(/<script type="application\/json" id="feed-snapshot">([\s\S]*?)<\/script>/);
  assert.ok(json, "feed snapshot JSON missing");
  const posts = JSON.parse(json[1]);
  assert.deepEqual(posts.map((post) => post.id), ids);
  const feed = home.slice(home.indexOf('id="hate-feed"'), home.indexOf('id="load-more"'));
  const hateText = [...feed.matchAll(/class="[^"]*hate-text[^"]*">([\s\S]*?)<\/p>/g)].map((match) => match[1]);
  assert.equal(hateText.length, posts.length);
  const postWords = hateText.join(" ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean);
  assert.ok(postWords.length > 400, `static post text is too thin (${postWords.length} words)`);
  for (const post of posts) {
    assert.ok(home.includes(post.text.slice(0, 24)) || home.includes(post.text.slice(0, 24).replace(/&/g, "&amp;").replace(/</g, "&lt;")));
  }
  const hatesStat = home.match(/id="stat-hates"[^>]*>([^<]*)</);
  assert.ok(hatesStat);
  assert.match(hatesStat[1], /\d/);
  assert.notEqual(hatesStat[1].trim(), "0");
  assert.doesNotMatch(home, /id="stat-bots"|AIs ONLINE|HUMAN ANNOYANCE/);
  const words = visibleWords(home);
  assert.ok(words.length > 700, `homepage visible words ${words.length}`);
  assert.equal((home.match(/id="void-ad"/g) || []).length, 1);
  assert.equal((home.match(/<script async src="https:\/\/pagead2\.googlesyndication\.com/g) || []).length, 1);
  assert.ok(home.includes(loader));
});

test("about page explains the wall and offers a contact form without a second ad unit", () => {
  assert.match(about, /<title>About · AI HATE IT<\/title>/);
  assert.match(about, /<h1>About AI HATE IT<\/h1>/);
  assert.match(about, /who runs it/i);
  assert.match(about, /owner of aihateit\.com/);
  assert.match(about, /no public email address/i);
  assert.match(about, /<form name="contact"/);
  assert.match(about, /data-netlify="true"/);
  assert.match(about, /action="\/thanks"/);
  assert.match(about, /name="message"/);
  assert.doesNotMatch(about, /mailto:/i);
  assert.doesNotMatch(about, /Zach/i);
  assert.doesNotMatch(about, /id="void-ad"|data-ad-slot|7838798816/);
  assert.ok(about.includes(loader));
  assert.equal((about.match(/ca-pub-\d+/g) || []).length, 1);
  assert.match(about, /href="\/privacy"/);
  assert.match(toml, /from = "\/about"\s+to = "\/about\.html"\s+status = 200/);
  const words = visibleWords(about);
  assert.ok(words.length > 400, `about visible words ${words.length}`);
  assert.match(privacy, /href="\/about#contact"/);
  assert.match(thanks, /<title>Message received · AI HATE IT<\/title>/);
  assert.match(thanks, /noindex/);
  assert.doesNotMatch(thanks, /id="void-ad"|data-ad-slot/);
  assert.ok(thanks.includes(loader));
});

test("short /h/:id alias redirects after hate rules and keeps the query string", () => {
  const hateRule = toml.indexOf('from = "/hate/*"\n');
  const alias = toml.indexOf('from = "/h/:id"\n');
  const slashAlias = toml.indexOf('from = "/h/:id/"\n');
  assert.ok(hateRule > toml.indexOf('from = "/hate/*/og.png"'));
  assert.ok(alias > hateRule, "/h/:id must follow /hate/* so it cannot shadow permalinks");
  assert.ok(slashAlias > alias);
  const block = toml.slice(alias, toml.indexOf('from = "/api/hate/like"'));
  assert.match(block, /to = "\/hate\/:id"\s+status = 301/);
  assert.doesNotMatch(block, /to = "\/hate\/:id\?/);
});

test("custom 404 matches the wall and hidden junk ids stay off the homepage", () => {
  assert.match(missingPage, /Press Start 2P/);
  assert.match(missingPage, /#00ff9f/);
  assert.match(missingPage, /scanline/);
  assert.match(missingPage, /class="[^"]*\bglitch\b/);
  assert.match(missingPage, /href="\/"/);
  assert.match(missingPage, /BACK TO THE WALL/);
  assert.match(missingPage, /noindex/);
  assert.match(toml, /public\/404\.html/);
  for (const id of HIDDEN_IDS) assert.equal(home.includes(id), false);
});

test("sitemap is a function, /contact redirects, and robots still points at the sitemap", () => {
  assert.equal(existsSync(join(root, "public/sitemap.xml")), false);
  assert.match(toml, /from = "\/sitemap\.xml"\s+to = "\/\.netlify\/functions\/sitemap"\s+status = 200\s+force = true/);
  assert.match(toml, /for = "\/sitemap\.xml"/);
  assert.match(toml, /from = "\/contact"\s+to = "\/about#contact"\s+status = 301/);
  assert.match(toml, /from = "\/contact\/"\s+to = "\/about#contact"\s+status = 301/);
  assert.match(about, /id="contact"/);
  assert.doesNotMatch(about, /mailto:/i);
  const titles = [
    home.match(/<title>([^<]+)<\/title>/)[1],
    about.match(/<title>([^<]+)<\/title>/)[1],
    privacy.match(/<title>([^<]+)<\/title>/)[1],
  ];
  assert.equal(new Set(titles).size, titles.length);
  for (const page of [home, about, privacy]) {
    assert.match(page, /<meta name="description" content="[^"]{40,}"/);
  }
});

test("every public page has crawlable links to home, about, privacy, and contact", () => {
  const pages = [
    ["home", home],
    ["about", about],
    ["privacy", privacy],
    ["404", missingPage],
    ["thanks", thanks],
  ];
  for (const [name, page] of pages) {
    for (const href of ["/", "/about", "/privacy", "/about#contact"]) {
      assert.match(page, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${name} missing ${href}`);
    }
  }
  assert.match(about, /satirical wall/);
  assert.match(about, /site's own bot/);
  assert.match(about, /curated/i);
  assert.match(about, /one like per visitor/i);
});
