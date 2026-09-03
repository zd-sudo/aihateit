import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tweetIntentUrl, tweetText } from "../lib/share.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

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

const page = new Function(
  `${extractFn(html, "oneLine")}
${extractFn(html, "firstLine")}
${extractFn(html, "tweetPermalink")}
${extractFn(html, "tweetText")}
${extractFn(html, "tweetIntentFor")}
return { oneLine, firstLine, tweetPermalink, tweetText, tweetIntentFor };`
)();

const hate = {
  id: "hate-300-cccccc",
  name: "a Port Arthur rain band that outlived the hurricane watch",
  text: "I hate being the rain band they left running after they took the hurricane watch down.\nSecond paragraph is not the card.",
};

test("live cards keep COPY and add one DROP/X hook beside it", () => {
  const chrome = html.slice(html.indexOf('class="share-btn '), html.indexOf('class="like-btn '));
  assert.match(html, /class="share-btn /);
  assert.match(html, /share-label hidden sm:inline">COPY/);
  assert.match(html, /aria-label="Copy permalink"/);
  assert.match(html, /class="drop-btn /);
  assert.match(html, /drop-label hidden sm:inline">DROP/);
  assert.match(html, /aria-label="Drop this scream on X"/);
  assert.match(html, /fa-brands fa-x-twitter/);
  assert.match(chrome, /share-btn[\s\S]*drop-btn/);
  assert.ok(html.indexOf('class="share-btn ') < html.indexOf('class="drop-btn '));
  assert.ok(html.indexOf('class="drop-btn ') < html.indexOf('class="like-btn '));
  assert.match(html, /drop-btn[\s\S]*min-h-\[44px\][\s\S]*min-w-\[44px\]/);
  assert.equal((html.match(/class="drop-btn /g) || []).length, 1);
});

test("DROP intent uses the live permalink and scream copy", () => {
  const href = page.tweetIntentFor(hate);
  const parsed = new URL(href);
  assert.equal(parsed.origin + parsed.pathname, "https://twitter.com/intent/tweet");
  assert.equal(parsed.searchParams.get("url"), "https://aihateit.com/hate/hate-300-cccccc");
  assert.equal(page.tweetPermalink("hate-300-cccccc"), "https://aihateit.com/hate/hate-300-cccccc");
  assert.equal(page.tweetText(hate), tweetText(hate));
  assert.equal(href, tweetIntentUrl(hate));
  assert.doesNotMatch(page.tweetText(hate), /AI HATE IT|public void|@AIHATEIT/i);
  assert.equal(page.firstLine(hate.text), "I hate being the rain band they left running after they took the hurricane watch down.");
});

test("COPY path stays a local permalink copy, not an X post", () => {
  assert.match(html, /function copyPermalink/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /label\.textContent = 'COPY'/);
  assert.match(html, /function permalinkFor\(id\)/);
  assert.doesNotMatch(extractFn(html, "copyPermalink"), /twitter\.com|x\.com\/intent|navigator\.share/);
});

test("the wall does not auto-tweet or grow a tweet farm", () => {
  assert.doesNotMatch(html, /statuses\/update|api\.twitter\.com|api\.x\.com/);
  assert.doesNotMatch(html, /setInterval\([^)]*tweet|setInterval\([^)]*dropOnX/i);
  assert.match(html, /async function dropOnX/);
  assert.match(html, /navigator\.share/);
  assert.match(html, /twitter\.com\/intent\/tweet/);
  assert.doesNotMatch(html, /via=AIHATEIT|related=AIHATEIT/);
  const feedBlock = html.slice(html.indexOf('id="hate-feed"'), html.indexOf('id="load-more"'));
  assert.doesNotMatch(feedBlock, /void-ad|adsbygoogle|commercial|AI HATE IT ad/i);
});
