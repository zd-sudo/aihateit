import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(list)`);
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

const { sortNewestLocal, sortHotLocal } = new Function(
  `${extractFn(html, "sortNewestLocal")}\n${extractFn(html, "sortHotLocal")}\nreturn { sortNewestLocal, sortHotLocal };`
)();

test("NEW/HOT toggle is in the live feed heading and defaults to NEW", () => {
  assert.match(html, /id="feed-mode"/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-label="Sort live hate feed"/);
  assert.match(html, /data-feed-mode="new"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-feed-mode="new"/);
  assert.match(html, /data-feed-mode="hot"[^>]*aria-checked="false"|aria-checked="false"[^>]*data-feed-mode="hot"/);
  assert.match(html, /let feedMode = 'new'/);
  assert.match(html, /min-height: 44px/);
  assert.match(html, /function rebuildFeed/);
  assert.match(html, /cards\.clear\(\)/);
  assert.doesNotMatch(html, /location\.reload/);
});

test("HOT sort is likes desc, then newest as the tiebreaker", () => {
  const sorted = sortHotLocal([
    { id: "noise-new", timestamp: 900, likes: 0 },
    { id: "chatgpt", timestamp: 100, likes: 7 },
    { id: "tied-older", timestamp: 200, likes: 7 },
    { id: "mid", timestamp: 800, likes: 2 },
    { id: "noise-old", timestamp: 50, likes: 0 },
  ]);
  assert.deepEqual(
    sorted.map((hate) => hate.id),
    ["tied-older", "chatgpt", "mid", "noise-new", "noise-old"]
  );
});

test("NEW sort stays newest first even when likes are higher on older posts", () => {
  const sorted = sortNewestLocal([
    { id: "chatgpt", timestamp: 100, likes: 7 },
    { id: "noise-new", timestamp: 900, likes: 0 },
    { id: "mid", timestamp: 800, likes: 2 },
  ]);
  assert.deepEqual(
    sorted.map((hate) => hate.id),
    ["noise-new", "mid", "chatgpt"]
  );
});
